"""Record or verify the isolated iPhone scene-signal trial from a Mac."""

import argparse
import json
import math
import os
from pathlib import Path
import re
import secrets
import subprocess
from tempfile import TemporaryDirectory
import time

from tls_result import EvidenceError, _integer, _need, _same


BUNDLE = "app.trippainting.maplibreqa"
EXECUTABLE_SUFFIX = "/MapLibreQA.app/MapLibreQA"
STAGE = "action-gate"
SIGNALS = ("cancel", "cancel", "reload")
PHASES = (10, 12, 12, 13)
SEQUENCES = (0, 1, 1, 2)
COUNTERS = ("active", "maxActive", "pending", "maxPending", "cancelledActive",
            "cancelledPending", "released", "blockedBeforeDispatch", "started",
            "httpRequestSendsSettled", "receivedHTTPBytesSettled",
            "tlsVerifiedExchanges", "acceptedBodyBytes")


class CoreDeviceError(EvidenceError):
    """A bounded CoreDevice operation did not complete successfully."""


def _unique_object(pairs):
    value = dict(pairs)
    _need(len(value) == len(pairs), "duplicate evidence keys")
    return value


def _json_object(data):
    try:
        value = json.loads(data, object_pairs_hook=_unique_object)
    except (UnicodeError, json.JSONDecodeError, RecursionError):
        raise EvidenceError("malformed evidence JSON") from None
    _need(isinstance(value, dict), "evidence must be an object")
    return value


def _read(path):
    with path.open("rb") as source:
        data = source.read(16_385)
    _need(len(data) <= 16_384, "evidence file exceeds 16 KiB")
    return _json_object(data)


def _save(folder, name, value):
    with (folder / name).open("x", encoding="utf-8") as target:
        json.dump(value, target, indent=2, sort_keys=True)
        target.write("\n")


def _pid(value):
    _need(1 <= _integer(value, "process identifier") <= 2**31 - 1,
          "process identifier is out of range")
    return value


def _attempts(step):
    return [{"accepted": index != 1, "phaseBefore": PHASES[index],
             "phaseAfter": PHASES[index + 1], "sequenceBefore": SEQUENCES[index],
             "sequenceAfter": SEQUENCES[index + 1]} for index in range(step)]


def _progress(value, run, pid, step):
    expected = {"kind": "fixture-action-progress", "stage": STAGE, "runID": run,
                "process": pid, "phase": PHASES[step], "sequence": SEQUENCES[step],
                "attempts": _attempts(step)}
    _need(_same(value, expected), f"scene progress differs at observation {step}")


def verify(folder):
    run = _read(folder / "run.json").get("runID")
    _need(type(run) is str and re.fullmatch(r"[A-Za-z0-9_-]{1,64}", run), "invalid run ID")
    pid = _pid(_read(folder / "launch.json").get("process"))
    for step in range(4):
        _progress(_read(folder / f"progress-{step}.json"), run, pid, step)
        if step:
            host = _read(folder / f"payload-{step}.json")
            _need(_same(host, {"process": pid, "signal": SIGNALS[step - 1]}),
                  f"host payload process or signal differs at step {step}")
    _need(_same(_read(folder / "process-after.json"), {"process": pid}),
          "the original process was not observed after the signals")

    final = _read(folder / "result.json")
    fields = {"complete": True, "pass": True, "stage": STAGE, "runID": run,
              "process": pid, "trialPhase": 13, "fixtureActionSequence": 2,
              "fixtureActionAttempts": _attempts(3), "mapCreated": False,
              "cancellationTrigger": "none", "delegateClass": "none", "transforms": 0,
              "rewrittenStyles": 0, "externalTileRequests": 0,
              "cases": [{"name": "run-bound fixture URL delivery", "pass": True,
                         "attempts": _attempts(3)}]}
    _need(_same({key: final.get(key) for key in fields}, fields), "final scene evidence differs")
    native = final.get("nativeAtFinish")
    _need(isinstance(native, dict) and _same({key: native.get(key) for key in COUNTERS},
          dict.fromkeys(COUNTERS, 0)) and native.get("ledger") == {},
          "unexpected native transport activity")
    return {"validated": True, "cases": 1, "scope": "isolated existing-scene URL delivery",
            "accepted": 2, "duplicateRejected": 1, "processPreserved": True}


def _device(device, command, arguments=(), *, deadline, document=False):
    remaining = min(8, deadline - time.monotonic())
    _need(remaining > 0, "scene observation deadline elapsed")
    args = ["xcrun", "devicectl", "device", *command, "--device", device,
            "--timeout", str(math.ceil(remaining))]
    if not document:
        args += ["--json-output", "-"]
    # CoreDevice forwards this prefix even when no launch environment is passed.
    env = {key: value for key, value in os.environ.items() if not key.startswith("DEVICECTL_CHILD_")}
    try:
        result = subprocess.run([*args, *arguments], capture_output=True, timeout=remaining, env=env)
    except subprocess.TimeoutExpired:
        raise CoreDeviceError("CoreDevice command timed out") from None
    label = " ".join(command)
    if result.returncode != 0:
        raise CoreDeviceError(f"CoreDevice {label} failed")
    if document:
        return None
    payload = _json_object(result.stdout)
    info, value = payload.get("info"), payload.get("result")
    _need(isinstance(info, dict) and info.get("outcome") == "success" and isinstance(value, dict),
          f"invalid CoreDevice {label} reply")
    return value


def _is_qa_process(value):
    executable = value.get("executable")
    return type(executable) is str and executable.startswith("file:///") and executable.endswith(EXECUTABLE_SUFFIX)


def _processes(device, deadline):
    value = _device(device, ("info", "processes"), ("--search", "MapLibreQA"), deadline=deadline)
    rows = value.get("runningProcesses")
    _need(isinstance(rows, list) and all(isinstance(row, dict) for row in rows), "invalid process list")
    return [row for row in rows if _is_qa_process(row)]


def _launched(device, options, deadline):
    value = _device(device, ("process", "launch"), (*options, BUNDLE), deadline=deadline)
    process = value.get("process")
    _need(isinstance(process, dict) and _is_qa_process(process), "unexpected launched executable")
    return _pid(process.get("processIdentifier")), process["executable"]


def _copy(device, run, name, deadline):
    with TemporaryDirectory(prefix="tp-action-delivery-") as temporary:
        destination = Path(temporary) / name
        _device(device, ("copy", "from"), ("--domain-type", "appDataContainer",
                "--domain-identifier", BUNDLE, "--source", f"Documents/{run}/{name}",
                "--destination", str(destination)), deadline=deadline, document=True)
        return _read(destination)


def _wait_for_document(device, run, name, ready, deadline):
    end = min(deadline, time.monotonic() + 5)
    while time.monotonic() < end:
        try:
            value = _copy(device, run, name, end)
        except (CoreDeviceError, FileNotFoundError):
            pass
        else:
            if ready(value):
                return value
        time.sleep(min(0.15, max(0, end - time.monotonic())))
    raise EvidenceError(f"timed out waiting for {name}")


def _at_step(value, run, pid, step):
    attempts = value.get("attempts")
    _need(isinstance(attempts, list), "scene attempts are absent")
    if len(attempts) < step:
        _progress(value, run, pid, len(attempts))
        return False
    return True  # Preserve this observation before checking it against the expected step.


def _completed(value):
    complete = value.get("complete")
    _need(type(complete) is bool, "final completion flag is absent")
    return complete


def capture(device, folder):
    """Use a previously verified, installed, stopped QA app on an unlocked iPhone."""
    folder.mkdir(mode=0o700)
    deadline = time.monotonic() + 16
    lock = _device(device, ("info", "lockState"), deadline=deadline)
    _need(lock.get("passcodeRequired") is False and lock.get("unlockedSinceBoot") is True,
          "unlock the device before running the scene trial")
    _need(not _processes(device, deadline), "the QA app is already running")
    run = "action-" + secrets.token_hex(12)
    _save(folder, "run.json", {"runID": run})
    nonces = {signal: secrets.token_hex(32) for signal in ("cancel", "reload")}
    _need(nonces["cancel"] != nonces["reload"], "fixture nonce collision")
    environment = {"QA_STAGE": STAGE, "QA_RUN_ID": run,
                   "QA_FIXTURE_CANCEL_NONCE": nonces["cancel"],
                   "QA_FIXTURE_RELOAD_NONCE": nonces["reload"]}
    deadline = time.monotonic() + 43
    pid, executable = _launched(device, ("--environment-variables", json.dumps(environment)), deadline)
    _save(folder, "launch.json", {"process": pid})
    for step in range(4):
        if step:
            signal = SIGNALS[step - 1]
            url = f"trippainting-map-qa-control://{signal}?runID={run}&pid={pid}&nonce={nonces[signal]}"
            observed = _launched(device, ("--payload-url", url), deadline)
            _save(folder, f"payload-{step}.json", {"process": observed[0], "signal": signal})
            _need(observed == (pid, executable), "CoreDevice reported a different QA process")
        progress = _wait_for_document(device, run, "action-progress.json",
                                      lambda value: _at_step(value, run, pid, step), deadline)
        _save(folder, f"progress-{step}.json", progress)
        _progress(progress, run, pid, step)
    _save(folder, "result.json", _wait_for_document(device, run, "result.json", _completed, deadline))
    matching = [row for row in _processes(device, deadline) if row["executable"] == executable]
    _need(len(matching) == 1, "the launched QA executable was not observed once")
    _save(folder, "process-after.json", {"process": _pid(matching[0].get("processIdentifier"))})
    return verify(folder)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_subparsers(dest="mode", required=True)
    recorder = modes.add_parser("capture", help="run on an explicitly selected iPhone with the QA app installed")
    recorder.add_argument("--device", required=True)
    recorder.add_argument("evidence", type=Path, help="new private directory under docs/test-results")
    modes.add_parser("verify", help="replay recorded evidence locally").add_argument("evidence", type=Path)
    args = parser.parse_args()
    try:
        result = capture(args.device, args.evidence) if args.mode == "capture" else verify(args.evidence)
    except (EvidenceError, OSError, ValueError) as error:
        # Never print subprocess arguments or output, which may contain fixture nonces.
        parser.exit(1, f"Scene trial could not be verified: {error if isinstance(error, EvidenceError) else type(error).__name__}\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
