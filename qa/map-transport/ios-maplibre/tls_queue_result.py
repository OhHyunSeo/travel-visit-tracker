"""Cross-check saved isolated SDK HTTPS queue evidence; no native test is run."""

import argparse
import json
from pathlib import Path
import re

from tls_result import EvidenceError, _certificate, _integer, _need, _origin, _same


def _native(value, label):
    _need(isinstance(value, dict), label + " is absent")
    keys = ("active", "pending", "maxActive", "maxPending", "cancelledActive",
            "cancelledPending", "released", "started", "blockedBeforeDispatch",
            "httpRequestSendsSettled", "receivedHTTPBytesSettled", "acceptedBodyBytes",
            "tlsVerifiedExchanges")
    for key in keys:
        _integer(value.get(key), label + "." + key)
    _need(value.get("transport") == "pinned-private-tls-http1-fixture"
          and value.get("ledgerOK") is True, label + " TLS transport or ledger differs")
    _need(value["maxActive"] == 4 and value["active"] <= value["maxActive"]
          and value["maxPending"] >= value["pending"] >= 0,
          label + " permit or pending peak differs")
    _need(value["started"] == value["active"] + value["released"],
          label + " permit releases differ")
    _need(all(value[key] == 0 for key in ("cancelledActive", "cancelledPending",
                                         "blockedBeforeDispatch")),
          label + " contains cancellation or denied work")
    _need(value["receivedHTTPBytesSettled"] >= value["acceptedBodyBytes"] > 0,
          label + " settled body observations differ")
    return value


def _ledger(native, label, certificate, origin, waiting=False):
    value = native.get("ledger")
    _need(isinstance(value, dict), label + " is absent")
    expected = {"schema": 1, "maxRequests": 32, "maxTiles": 16,
                "maxReservedBytes": 8192, "reservationBytes": 256,
                "requests": 5 if waiting else 7, "tiles": 4 if waiting else 6,
                "reservedBytes": 1280 if waiting else 1792}
    for key, count in expected.items():
        _need(_integer(value.get(key), label + "." + key) == count,
              label + " limits or charge differ")
    _need(value.get("origin") == origin, label + " origin differs")
    _certificate(value.get("fixtureTLSLeafDER"), certificate)
    unresolved = value.get("unresolved")
    _need(isinstance(unresolved, list)
          and all(type(item) is str and item for item in unresolved),
          label + " unresolved list differs")
    _need(len(unresolved) == len(set(unresolved)) == (4 if waiting else 0),
          label + " unresolved permits differ")
    return value


def validate(result, server, ledger, certificate, origin, pid):
    """Reject absent or contradictory saved observations; return a safe summary."""
    try:
        return _validate(result, server, ledger, certificate, origin, pid)
    except (KeyError, TypeError, IndexError, AttributeError, ValueError) as error:
        if isinstance(error, EvidenceError):
            raise
        raise EvidenceError("malformed evidence") from error


def _validate(result, server, archived, certificate, expected_origin, pid):
    expected_origin = _origin(expected_origin)
    _need(type(pid) is int and pid > 0, "expected process differs")
    _need(isinstance(result, dict) and result.get("complete") is True
          and result.get("pass") is True, "trial did not complete successfully")
    _need(result.get("stage") == "tls-queue"
          and _integer(result.get("trialPhase"), "trialPhase") == 2,
          "wrong trial stage or phase")
    _need(_integer(result.get("process"), "process") == pid, "process differs")
    preserved = result.get("delegatePreserved")
    _need((preserved is True or type(preserved) is int and preserved == 1)
          and result.get("delegateClass") == "MLRNTransformRequest",
          "native transform delegate differs")
    _need(_integer(result.get("transforms"), "transforms") >= 7
          and _integer(result.get("rewrittenStyles"), "rewrittenStyles") >= 1
          and _integer(result.get("externalTileRequests"), "externalTileRequests") == 0,
          "native transform observations differ")
    cases = result.get("cases")
    _need(isinstance(cases, list) and len(cases) == 1 and isinstance(cases[0], dict),
          "one successful HTTPS queue case is required")
    case = cases[0]
    _need(case.get("name") == "SDK pinned HTTPS fifth request waits"
          and case.get("pass") is True and case.get("styleLoaded") is True
          and case.get("fullyRendered") is True, "HTTPS queue/render evidence differs")
    final = _native(case.get("native"), "final native")
    _need(_same(final, result.get("nativeAtFinish")), "final native snapshots differ")
    _need(final["active"] == final["pending"] == 0 and 1 <= final["maxPending"] <= 2
          and all(final[key] == 7 for key in ("started", "released",
                                            "httpRequestSendsSettled", "tlsVerifiedExchanges")),
          "seven settled verified HTTPS exchanges are required")
    waiting = _native(case.get("waitingSnapshot"), "waiting native")
    _need(waiting["active"] == 4 and 1 <= waiting["pending"] <= 2
          and waiting["started"] == 5 and waiting["released"] == 1
          and waiting["httpRequestSendsSettled"] == waiting["tlsVerifiedExchanges"] == 1,
          "four active permits with a fifth request waiting are required")
    saved = _ledger(final, "final ledger", certificate, expected_origin)
    waiting_ledger = _ledger(waiting, "waiting ledger", certificate, expected_origin, waiting=True)
    counters = {"requests", "tiles", "reservedBytes", "unresolved"}
    identity = lambda value: {key: item for key, item in value.items() if key not in counters}
    _need(_same(identity(saved), identity(waiting_ledger)), "ledger identity changed while queued")
    _need(saved["reservedBytes"] >= waiting_ledger["reservedBytes"], "queue charge was refunded")
    _need(final["maxPending"] >= waiting["maxPending"]
          and final["acceptedBodyBytes"] >= waiting["acceptedBodyBytes"]
          and final["receivedHTTPBytesSettled"] >= waiting["receivedHTTPBytesSettled"],
          "native cumulative observations decreased")
    _need(isinstance(archived, dict) and _same(saved, archived), "archived ledger differs")
    _need(isinstance(server, dict), "server observation is absent")
    for key in ("active", "maxActive", "heldActive", "resourceCount"):
        _integer(server.get(key), "server." + key)
    _need(server["active"] == server["heldActive"] == 0 and server["maxActive"] == 4
          and server["resourceCount"] == 7 and server.get("heldReleased") is False,
          "server did not finish exactly seven resources with peak four")
    if "origin" in server:
        _need(server["origin"] == expected_origin, "server origin differs")
    entries = server.get("requests")
    _need(isinstance(entries, list) and len(entries) == 7, "server resource history differs")
    total, paths = 0, set()
    for index, entry in enumerate(entries):
        _need(isinstance(entry, dict), "server resource entry differs")
        path = entry.get("path")
        _need(type(path) is str and (path == "/resource/style/multi" if index == 0
              else re.fullmatch(r"/resource/tile/2_[0-3]_[0-3]", path) is not None),
              "SDK multi-style and tile sequence differs")
        _need(path not in paths, "server resource path was repeated")
        paths.add(path)
        size = _integer(entry.get("bytes"), "server entry.bytes")
        written = _integer(entry.get("bytesWritten"), "server entry.bytesWritten")
        _need(0 < size <= 256 and written == size, "server body is oversized or incomplete")
        _need(entry.get("finished") is True and entry.get("closedBeforeFinish") is False
              and entry.get("held") is False, "server response lifecycle differs")
        _need(entry.get("ua") == "TripPaintingMapTransportQA/1.0"
              and entry.get("receivedAuthHeader") is False and entry.get("cookieHeader") is False,
              "server credentials or User-Agent differ")
        _need(entry.get("alpn") == "http/1.1"
              and entry.get("tlsProtocol") in ("TLSv1.2", "TLSv1.3"),
              "server TLS protocol or ALPN differs")
        if index == 0:
            _need(waiting["acceptedBodyBytes"] == size,
                  "waiting settled body differs from the completed style")
        total += written
    _need(final["acceptedBodyBytes"] == total
          and final["receivedHTTPBytesSettled"] >= total, "native/server body totals differ")
    return {"validated": True, "cases": 1, "resources": 7,
            "verifiedHTTPSExchanges": 7, "acceptedBodyBytes": total,
            "nativeMaxActive": final["maxActive"], "serverMaxActive": server["maxActive"],
            "waitingActive": waiting["active"], "waitingPending": waiting["pending"],
            "scope": "saved isolated SDK pinned HTTPS peak and native waiting snapshot only; "
                     "not simultaneous TLS-socket count, cancellation, restart, HTTP2, product or OS-byte acceptance"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("result", type=Path)
    parser.add_argument("server", type=Path)
    parser.add_argument("--ledger", type=Path, required=True)
    parser.add_argument("--certificate", type=Path, required=True, help="expected public DER certificate")
    parser.add_argument("--origin", required=True, help="expected exact HTTPS fixture origin")
    parser.add_argument("--pid", type=int, required=True)
    args = parser.parse_args()
    try:
        value = validate(json.loads(args.result.read_text()), json.loads(args.server.read_text()),
                         json.loads(args.ledger.read_text()), args.certificate.read_bytes(),
                         args.origin, args.pid)
    except (EvidenceError, OSError, json.JSONDecodeError) as error:
        parser.exit(1, "Evidence rejected: " + str(error) + "\n")
    print(json.dumps(value, sort_keys=True))


if __name__ == "__main__":
    main()
