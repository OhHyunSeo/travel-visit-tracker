"""Capture one isolated RN map trial from a preinstalled physical iPhone app."""

import argparse
import base64
import json
from pathlib import Path
import secrets
from tempfile import TemporaryDirectory
import time
from urllib.parse import urlsplit
import uuid

from rn_evidence import BUNDLE, save, verify
from action_delivery import CoreDeviceError, _device, _pid, _read
from tls_cancel_capture import FixtureControl
from tls_result import EvidenceError, _need, _origin, _same


def copy_result(device, run, name, deadline):
    with TemporaryDirectory(prefix="tp-rn-device-") as temporary:
        destination = Path(temporary) / name
        _device(device, ("copy", "from"), ("--domain-type", "appDataContainer",
                "--domain-identifier", BUNDLE, "--source", f"Documents/{run}/{name}",
                "--destination", str(destination)), deadline=deadline, document=True)
        return _read(destination)


def capture(device, origin, certificate, output, *, initial_style="local-empty"):
    _need(initial_style in ("local-empty", "sdk-default"), "invalid initial style mode")
    _need(urlsplit(_origin(origin)).hostname != "127.0.0.1", "use the Mac's private LAN address")
    lock = _device(device, ("info", "lockState"), deadline=time.monotonic() + 8)
    _need(lock.get("passcodeRequired") is False and lock.get("unlockedSinceBoot") is True,
          "unlock the iPhone before starting the trial")
    control = FixtureControl(origin, certificate)
    initial = control.request("/stats", time.monotonic() + 3)
    _need(_same(initial, {"active": 0, "maxActive": 0, "heldActive": 0, "heldReleased": False,
                          "resourceCount": 0, "requests": []}), "fixture was not fresh")
    output.mkdir(mode=0o700)
    (output / "fixture.der").write_bytes(certificate)
    save(output, "server-initial", initial)

    run = "rn-device-" + secrets.token_hex(12)
    environment = {"QA_RUN_ID": run, "QA_SERVER_ORIGIN": origin,
                   "QA_INITIAL_STYLE": initial_style,
                   "QA_TLS_LEAF_DER_BASE64": base64.b64encode(certificate).decode("ascii")}
    launch = _device(device, ("process", "launch"),
                     ("--terminate-existing", "--environment-variables", json.dumps(environment), BUNDLE),
                     deadline=time.monotonic() + 8)
    process = launch["process"]
    pid = _pid(process.get("processIdentifier"))
    executable = process.get("executable")
    _need(isinstance(executable, str) and executable.startswith("file:///")
          and executable.endswith("/TripPainting.app/TripPainting"), "unexpected launched executable")
    save(output, "run", {"runID": run, "origin": origin, "process": pid})
    result = {}
    deadline = time.monotonic() + 38
    while time.monotonic() < deadline:
        try:
            result = copy_result(device, run, "result.json", deadline)
        except (CoreDeviceError, FileNotFoundError):
            pass
        if result.get("complete") is True:
            break
        time.sleep(0.2)
    save(output, "result", result)
    server = control.request("/stats", time.monotonic() + 3)
    save(output, "server", server)
    _need(result.get("complete") is True, "timed out waiting for the RN result")
    ledger = copy_result(device, run, "ledger.json", time.monotonic() + 8)
    save(output, "ledger", ledger)
    processes = _device(device, ("info", "processes"), ("--search", "TripPainting"),
                        deadline=time.monotonic() + 8).get("runningProcesses", [])
    matching = [row for row in processes if row.get("executable") == executable]
    _need(len(matching) == 1 and _pid(matching[0].get("processIdentifier")) == pid,
          "the original QA process was not observed at completion")
    save(output, "process-after", {"process": pid})
    return verify(result, ledger, server, origin, certificate, run, pid,
                  runtime="physical-iphone", initial_style=initial_style)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", required=True, type=uuid.UUID, help="CoreDevice identifier")
    parser.add_argument("--origin", required=True, help="exact private HTTPS fixture origin")
    parser.add_argument("--certificate", required=True, type=Path, help="the fixture's public DER certificate")
    parser.add_argument("--initial-style", choices=("local-empty", "sdk-default"), default="local-empty")
    parser.add_argument("evidence", type=Path, help="a new evidence directory")
    args = parser.parse_args()
    try:
        summary = capture(str(args.device).upper(), args.origin, args.certificate.read_bytes(), args.evidence,
                          initial_style=args.initial_style)
        save(args.evidence, "summary", summary)
    except (EvidenceError, OSError, KeyError) as error:
        parser.exit(1, f"Trial could not be verified: {error}\n")
    print(json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    main()
