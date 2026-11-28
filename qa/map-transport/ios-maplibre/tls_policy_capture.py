"""Compare a prepared iPhone policy trial with two independent HTTPS fixtures."""

import argparse
import base64
import json
from pathlib import Path
import re
import secrets
import time
from urllib.parse import urlsplit

import action_delivery as device_tools
from tls_cancel_capture import FixtureControl, _idle, _wait_server
from tls_result import EvidenceError, _certificate, _integer, _need, _origin, _same


EMPTY = {"active": 0, "maxActive": 0, "heldActive": 0, "heldReleased": False,
         "resourceCount": 0, "requests": []}
SOURCE_EMPTY = {**EMPTY, "policyDeniedPathArrivals": 0}


def _expect(value, fields, reason):
    _need(isinstance(value, dict) and _same({key: value.get(key) for key in fields}, fields), reason)


def _origins(source, target):
    source, target = _origin(source), _origin(target)
    _need(source != target and urlsplit(source).hostname == urlsplit(target).hostname,
          "policy fixtures must use different ports on the same address")
    return source, target


def verify(folder, origin, target, leaf):
    origin, target = _origins(origin, target)
    read = lambda name: device_tools._read(folder / f"{name}.json")
    _need(_same(read("source-initial"), SOURCE_EMPTY), "source fixture was not fresh")
    _need(_same(read("target-initial"), EMPTY) and _same(read("target-final"), EMPTY),
          "a resource reached the unapproved fixture")
    source = read("source-final")
    _expect(source, {"active": 0, "heldActive": 0, "heldReleased": False,
                     "policyDeniedPathArrivals": 0}, "source fixture was not idle or received a denied path")
    requests = source.get("requests")
    _need(isinstance(requests, list) and 2 <= len(requests) <= 9
          and _same(source.get("resourceCount"), len(requests)), "policy wire request count differs")
    peak = _integer(source.get("maxActive"), "server peak")
    _need(1 <= peak <= 4, "server concurrency outside the permit limit")
    for index, request in enumerate(requests):
        path, status = ("/resource/style/mixed", 200) if index == 0 else ("/resource/tile/m_2_0_0", 302)
        _expect(request, {"path": path, "status": status, "held": False, "finished": True,
                          "closedBeforeFinish": False, "ua": "TripPaintingMapTransportQA/1.0",
                          "receivedAuthHeader": False, "cookieHeader": False, "alpn": "http/1.1"},
                "unexpected policy wire request")
        _need(request.get("tlsProtocol") in ("TLSv1.2", "TLSv1.3"), "policy request was not TLS")
        body = _integer(request.get("bytes"), "policy response bytes")
        _need(_same(request.get("bytesWritten"), body) and (0 < body <= 1024 if index == 0 else body == 0),
              "policy response body differs")

    pid = device_tools._pid(read("launch").get("process"))
    _need(_same(read("process-after"), {"process": pid}), "policy process did not remain active")
    run_id = read("run").get("runID")
    _need(isinstance(run_id, str) and re.fullmatch(r"tlspolicy-[0-9a-f]{24}", run_id) is not None,
          "policy run identity is invalid")
    result = read("result")
    _expect(result, {"complete": True, "pass": True, "stage": "tls-policy", "trialPhase": 1,
                     "mapCreated": True, "runID": run_id, "process": pid,
                     "delegateClass": "MLRNTransformRequest"}, "policy trial identity differs")
    delegate = result.get("delegatePreserved")
    _need(delegate is True or type(delegate) is int and delegate == 1, "SDK delegate was not preserved")
    cases = result.get("cases")
    _need(isinstance(cases, list) and len(cases) == 1, "expected one policy case")
    case = cases[0]
    _expect(case, {"name": "SDK HTTPS policy refusal", "pass": True, "styleLoaded": True}, "policy SDK case did not pass")
    window = _integer(case.get("observationMs"), "SDK observation duration")
    _need(2500 <= window <= 30000, "SDK observation duration differs")
    attempts = case.get("attempts")
    _need(isinstance(attempts, dict) and _same(attempts, result.get("policyAttempts")), "SDK attempt evidence differs")
    counts = {name: _integer(attempts.get(name), name) for name in ("origin", "path", "redirectSource")}
    redirects = len(requests) - 1
    _need(counts["origin"] >= 1 and counts["path"] >= 1 and counts["redirectSource"] >= redirects,
          "SDK did not request all three policy probes")

    native = case.get("native")
    _need(_same(native, result.get("nativeAtFinish")), "final native snapshot differs")
    _expect(native, {"active": 0, "pending": 0, "started": len(requests), "released": len(requests),
                     "httpRequestSendsSettled": len(requests), "ledgerOK": True, "tlsVerifiedExchanges": 1,
                     "acceptedBodyBytes": requests[0]["bytes"], "transport": "pinned-private-tls-http1-fixture"},
            "native policy transport totals differ")
    _need(_integer(native.get("blockedBeforeDispatch"), "blocked requests") >= 2, "two pre-dispatch refusals are required")
    _expect(native.get("lastExchange"), {"finishCode": 6, "trustAccepted": True, "alpn": "http/1.1",
                                         "requestSends": 1}, "redirect was not refused by the HTTP parser")
    ledger = native.get("ledger")
    _expect(ledger, {"schema": 1, "origin": origin, "fixtureResourceProfile": "mixed-v1", "requests": len(requests),
                     "tiles": redirects, "reservedBytes": len(requests) * 1024, "reservationBytes": 1024,
                     "maxRequests": 16, "maxTiles": 8, "maxReservedBytes": 16384, "unresolved": []}, "policy ledger differs")
    _certificate(ledger.get("fixtureTLSLeafDER"), leaf)
    _need(_same(ledger, read("ledger")), "archived policy ledger differs")
    return {"validated": True, "wireRequests": len(requests), "redirectRequests": redirects,
            "sameProcessReissuesObserved": redirects - 1, "observationMs": window,
            "blockedBeforeDispatch": native["blockedBeforeDispatch"], "targetResources": 0,
            "reservedBytes": ledger["reservedBytes"]}


def capture(device, folder, origin, target, leaf):
    origin, target = _origins(origin, target)
    folder.mkdir(mode=0o700)
    deadline = time.monotonic() + 12
    lock = device_tools._device(device, ("info", "lockState"), deadline=deadline)
    _need(lock.get("passcodeRequired") is False and lock.get("unlockedSinceBoot") is True,
          "unlock the device before the policy trial")
    _need(not device_tools._processes(device, deadline), "the QA app is already running")
    source, alternate = FixtureControl(origin, leaf), FixtureControl(target, leaf)
    save = lambda name, value: device_tools._save(folder, f"{name}.json", value)
    for name, fixture, expected in (("source", source, SOURCE_EMPTY), ("target", alternate, EMPTY)):
        initial = fixture.request("/stats", deadline)
        save(f"{name}-initial", initial)
        _need(_same(initial, expected), f"{name} fixture was not fresh")
    run = "tlspolicy-" + secrets.token_hex(12)
    save("run", {"runID": run})
    environment = {"QA_STAGE": "tls-policy", "QA_RUN_ID": run, "QA_SERVER_ORIGIN": origin,
                   "QA_POLICY_TARGET": target, "QA_TLS_LEAF_DER_BASE64": base64.b64encode(leaf).decode("ascii")}
    deadline = time.monotonic() + 34
    pid, executable = device_tools._launched(device, ("--environment-variables", json.dumps(environment)), deadline)
    save("launch", {"process": pid})
    # The SDK observes retry activity for 2.5 seconds after all probes appear.
    # Keep the host polling beyond that window without launching the app again.
    while time.monotonic() < deadline:
        try:
            result = device_tools._copy(device, run, "result.json", deadline)
        except (device_tools.CoreDeviceError, FileNotFoundError):
            pass
        else:
            if device_tools._completed(result):
                break
        time.sleep(0.2)
    else:
        raise EvidenceError("timed out waiting for the policy result")
    save("result", result)
    save("ledger", device_tools._copy(device, run, "tls-ledger.json", deadline))
    _wait_server(source, folder, "source-final.json", _idle, deadline)
    save("target-final", alternate.request("/stats", deadline))
    matching = [row for row in device_tools._processes(device, deadline) if row["executable"] == executable]
    _need(len(matching) == 1 and device_tools._pid(matching[0].get("processIdentifier")) == pid,
          "policy process was not observed at completion")
    save("process-after", {"process": pid})
    return verify(folder, origin, target, leaf)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", required=True)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--certificate", required=True, type=Path)
    parser.add_argument("evidence", type=Path)
    args = parser.parse_args()
    try:
        with args.certificate.open("rb") as source:
            leaf = source.read(16385)
        result = capture(args.device, args.evidence, args.origin, args.target, leaf)
    except (EvidenceError, OSError, ValueError) as error:
        detail = str(error) if isinstance(error, EvidenceError) else type(error).__name__
        parser.exit(1, f"SDK policy trial could not be verified: {detail}\n")
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
