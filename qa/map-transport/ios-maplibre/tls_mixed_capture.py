"""Capture the held and completed HTTPS mixed-resource trial on a prepared iPhone."""

import argparse
import base64
import json
from pathlib import Path
import secrets
import time

import action_delivery as device_tools
from tls_cancel_capture import FixtureControl, _idle, _wait_server, _waiting
from tls_mixed_result import validate_waiting, verify
from tls_result import EvidenceError, _need, _same


def capture(device, folder, origin, certificate, *, encoded_glyph=False):
    fixture = FixtureControl(origin, certificate)
    folder.mkdir(mode=0o700)
    deadline = time.monotonic() + 12
    lock = device_tools._device(device, ("info", "lockState"), deadline=deadline)
    _need(lock.get("passcodeRequired") is False and lock.get("unlockedSinceBoot") is True,
          "unlock the device before the mixed SDK trial")
    _need(not device_tools._processes(device, deadline), "the QA app is already running")
    initial = fixture.request("/stats", deadline)
    device_tools._save(folder, "server-initial.json", initial)
    _need(_same(initial, {"active": 0, "maxActive": 0, "heldActive": 0, "resourceCount": 0,
                         "heldReleased": False, "requests": []}), "fixture was not fresh")

    run = "tlsmixed-" + secrets.token_hex(12)
    device_tools._save(folder, "run.json", {"runID": run})
    environment = {"QA_STAGE": "tls-mixed", "QA_RUN_ID": run, "QA_SERVER_ORIGIN": origin,
                   "QA_TLS_LEAF_DER_BASE64": base64.b64encode(certificate).decode("ascii")}
    deadline = time.monotonic() + 29
    pid, executable = device_tools._launched(device, ("--environment-variables", json.dumps(environment)), deadline)
    device_tools._save(folder, "launch.json", {"process": pid})

    waiting = device_tools._wait_for_document(device, run, "mixed-waiting.json", bool, deadline)
    device_tools._save(folder, "waiting.json", waiting)
    _need(waiting.get("kind") == "mixed-waiting" and waiting.get("runID") == run
          and device_tools._pid(waiting.get("process")) == pid, "mixed waiting identity differs")
    before = _wait_server(fixture, folder, "server-before.json", _waiting, deadline)
    validate_waiting(waiting.get("native"), before, origin, certificate, encoded_glyph=encoded_glyph)
    release = fixture.request("/release-held", deadline)
    device_tools._save(folder, "release.json", release)
    _need(_same(release, {"heldReleased": True, "releasedOpenBodies": 4}),
          "fixture did not release exactly four mixed bodies")

    result = device_tools._wait_for_document(device, run, "result.json", device_tools._completed, deadline)
    device_tools._save(folder, "result.json", result)
    device_tools._save(folder, "ledger.json", device_tools._copy(device, run, "tls-ledger.json", deadline))
    _wait_server(fixture, folder, "server-final.json", _idle, deadline)
    matching = [row for row in device_tools._processes(device, deadline) if row["executable"] == executable]
    _need(len(matching) == 1 and device_tools._pid(matching[0].get("processIdentifier")) == pid,
          "the original mixed trial process was not observed at completion")
    device_tools._save(folder, "process-after.json", {"process": pid})
    return verify(folder, origin, certificate, encoded_glyph=encoded_glyph)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", required=True)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--certificate", required=True, type=Path)
    parser.add_argument("evidence", type=Path, help="new private directory under docs/test-results")
    parser.add_argument("--encoded-glyph", action="store_true", help="require the encoded Noto Sans fixture path")
    args = parser.parse_args()
    try:
        with args.certificate.open("rb") as source:
            leaf = source.read(16_385)
        result = capture(args.device, args.evidence, args.origin, leaf, encoded_glyph=args.encoded_glyph)
    except (EvidenceError, OSError, ValueError) as error:
        detail = str(error) if isinstance(error, EvidenceError) else type(error).__name__
        parser.exit(1, f"Mixed SDK trial could not be verified: {detail}\n")
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
