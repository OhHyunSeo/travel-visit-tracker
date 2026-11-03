"""Cross-check saved isolated SDK HTTPS evidence; no device or trust test is run."""

import argparse
import base64
import binascii
import ipaddress
import json
from pathlib import Path
from urllib.parse import urlsplit


class EvidenceError(ValueError):
    """Independent observations are absent, malformed, or contradictory."""


def _need(condition, message):
    if not condition:
        raise EvidenceError(message)


def _integer(value, label):
    _need(type(value) is int and value >= 0, label + " must be an unsigned integer")
    return value


def _same(left, right):
    # JSON equality must distinguish true from 1, including in archived evidence.
    options = {"sort_keys": True, "separators": (",", ":"), "allow_nan": False}
    return json.dumps(left, **options) == json.dumps(right, **options)


def _origin(value):
    _need(type(value) is str, "expected origin must be a string")
    try:
        parsed = urlsplit(value)
        address = ipaddress.IPv4Address(parsed.hostname)
        allowed = address == ipaddress.IPv4Address("127.0.0.1") or any(
            address in ipaddress.ip_network(network)
            for network in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
        )
        _need(allowed and parsed.scheme == "https" and parsed.port is not None
              and 1 <= parsed.port <= 65535
              and value == f"https://{address}:{parsed.port}",
              "expected origin is not a canonical private HTTPS fixture origin")
    except (ValueError, TypeError):
        raise EvidenceError("expected origin is not a canonical private HTTPS fixture origin") from None
    return value


def _certificate(value, expected):
    _need(type(expected) is bytes and 0 < len(expected) <= 16384,
          "expected public DER size differs")
    _need(type(value) is str and 0 < len(value) <= 21848,
          "ledger public DER encoding differs")
    try:
        decoded = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error):
        raise EvidenceError("ledger public DER encoding differs") from None
    _need(base64.b64encode(decoded).decode("ascii") == value and decoded == expected,
          "ledger public DER differs from supplied certificate")
    # Byte binding only: this report checker does not evaluate certificate trust.


def validate(result, server, ledger, certificate, origin, pid):
    """Reject contradictory evidence and return a small, non-sensitive summary."""
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
    _need(result.get("stage") == "tls-render"
          and _integer(result.get("trialPhase"), "trialPhase") == 1, "wrong trial stage or phase")
    _need(_integer(result.get("process"), "process") == pid, "process differs")
    preserved = result.get("delegatePreserved")
    _need((preserved is True or type(preserved) is int and preserved == 1)
          and result.get("delegateClass") == "MLRNTransformRequest",
          "native transform delegate differs")
    _need(_integer(result.get("transforms"), "transforms") >= 2
          and _integer(result.get("rewrittenStyles"), "rewrittenStyles") >= 1
          and _integer(result.get("externalTileRequests"), "externalTileRequests") == 0,
          "native transform observations differ")
    cases = result.get("cases")
    _need(isinstance(cases, list) and len(cases) == 1 and isinstance(cases[0], dict),
          "one successful HTTPS case is required")
    case = cases[0]
    _need(case.get("name") == "SDK pinned HTTPS raster render" and case.get("pass") is True
          and case.get("styleLoaded") is True and case.get("fullyRendered") is True,
          "HTTPS style/render evidence differs")
    native = case.get("native")
    _need(isinstance(native, dict) and _same(native, result.get("nativeAtFinish")),
          "final native snapshots differ")
    keys = ("active", "pending", "maxActive", "maxPending", "cancelledActive", "cancelledPending",
            "released", "started", "blockedBeforeDispatch", "httpRequestSendsSettled",
            "receivedHTTPBytesSettled", "acceptedBodyBytes", "tlsVerifiedExchanges")
    for key in keys:
        _integer(native.get(key), "native." + key)
    _need(native.get("transport") == "pinned-private-tls-http1-fixture"
          and native.get("ledgerOK") is True, "native TLS transport or ledger differs")
    _need(all(native[key] == 0 for key in ("active", "pending", "maxPending", "cancelledActive",
                                         "cancelledPending", "blockedBeforeDispatch")),
          "native requests did not finish cleanly")
    _need(all(native[key] == 2 for key in ("started", "released", "httpRequestSendsSettled",
                                         "tlsVerifiedExchanges"))
          and 1 <= native["maxActive"] <= 4, "two verified HTTPS exchanges are required")
    saved = native.get("ledger")
    _need(isinstance(saved, dict), "native ledger is absent")
    expected = {"schema": 1, "requests": 2, "tiles": 1, "reservedBytes": 512,
                "maxRequests": 32, "maxTiles": 16, "maxReservedBytes": 8192,
                "reservationBytes": 256}
    for key, value in expected.items():
        _need(_integer(saved.get(key), "ledger." + key) == value, "ledger limits or charge differ")
    _need(saved.get("origin") == expected_origin and saved.get("unresolved") == [],
          "ledger origin or unresolved work differs")
    _certificate(saved.get("fixtureTLSLeafDER"), certificate)
    _need(isinstance(archived, dict) and _same(saved, archived), "archived ledger differs")
    _need(isinstance(server, dict), "server observation is absent")
    for key in ("active", "maxActive", "heldActive", "resourceCount"):
        _integer(server.get(key), "server." + key)
    _need(server["active"] == server["heldActive"] == 0 and server["resourceCount"] == 2
          and 1 <= server["maxActive"] <= 4 and server.get("heldReleased") is False,
          "server did not finish exactly two resources")
    if "origin" in server:
        _need(server["origin"] == expected_origin, "server origin differs")
    entries = server.get("requests")
    _need(isinstance(entries, list) and len(entries) == 2, "server resource history differs")
    total = 0
    for entry, path in zip(entries, ("/resource/style/sdk", "/resource/tile/0_0_0")):
        _need(isinstance(entry, dict) and entry.get("path") == path,
              "SDK style and tile sequence differs")
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
        total += written
    _need(native["acceptedBodyBytes"] == total
          and native["receivedHTTPBytesSettled"] >= total, "native/server body totals differ")
    return {"validated": True, "cases": 1, "resources": 2,
            "verifiedHTTPSExchanges": 2, "acceptedBodyBytes": total,
            "nativeMaxActive": native["maxActive"], "serverMaxActive": server["maxActive"],
            "scope": "saved isolated SDK pinned HTTPS render only; not HTTP2, product or OS-byte acceptance"}


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
