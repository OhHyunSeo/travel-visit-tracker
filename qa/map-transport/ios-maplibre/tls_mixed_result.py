"""Cross-check saved mixed-resource MapLibre HTTPS queue observations."""

import argparse
import json
from pathlib import Path
import re

from action_delivery import COUNTERS, _pid, _read
from tls_result import EvidenceError, _certificate, _integer, _need, _origin, _same


STYLE = "/resource/style/mixed"
GLYPH = "/resource/glyph/QA/0-255.pbf"
ENCODED_GLYPH = "/resource/glyph/Noto%20Sans%20Regular/0-255.pbf"
TILE = re.compile(r"/resource/tile/m_2_[0-3]_[0-3]")
SPRITE = re.compile(r"/resource/sprite/mixed(@2x)?\.(json|png)")
UUID = re.compile(r"[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}")
CASE_NAME = "SDK pinned HTTPS mixed resources"
PROFILE = "mixed-v1"
RESERVATION = 1024
RESOURCE_COUNT = 10


def _matches(value, expected, label):
    _need(isinstance(value, dict) and _same({key: value.get(key) for key in expected}, expected), label)


def _category(path, expected_glyph):
    _need(type(path) is str, "invalid fixture resource path")
    if path == STYLE:
        return "style"
    if path == expected_glyph:
        return "glyph"
    if TILE.fullmatch(path):
        return "tile"
    if SPRITE.fullmatch(path):
        return "sprite"
    raise EvidenceError("unexpected mixed fixture resource path")


def _server(value, origin, *, active, count, released, peak, encoded_glyph=False):
    _matches(value, {"active": active, "maxActive": peak, "heldActive": active,
                     "resourceCount": count, "heldReleased": released},
             "mixed fixture counts or release state differ")
    _need(value.get("origin", origin) == origin, "mixed fixture origin differs")
    rows = value.get("requests")
    _need(isinstance(rows, list) and len(rows) == count, "mixed fixture history count differs")
    paths = set()
    for index, row in enumerate(rows):
        _need(isinstance(row, dict), "mixed fixture row is absent")
        path = row.get("path")
        category = _category(path, ENCODED_GLYPH if encoded_glyph else GLYPH)
        _need((category == "style") == (index == 0) and path not in paths,
              "style order or mixed fixture path uniqueness differs")
        paths.add(path)
        size = _integer(row.get("bytes"), "server resource body")
        written = _integer(row.get("bytesWritten"), "server written body")
        _need(0 < size <= (RESERVATION if category == "style" else 256),
              "mixed fixture body exceeds its bound")
        held = category in ("tile", "glyph")
        finished = released or not held
        _need(row.get("held") is held and row.get("finished") is finished
              and row.get("closedBeforeFinish") is False and written == (size if finished else 0),
              "mixed fixture response lifecycle differs")
        _need(row.get("ua") == "TripPaintingMapTransportQA/1.0"
              and row.get("receivedAuthHeader") is False and row.get("cookieHeader") is False,
              "mixed fixture User-Agent or credentials differ")
        _need(row.get("alpn") == "http/1.1" and row.get("tlsProtocol") in ("TLSv1.2", "TLSv1.3"),
              "mixed fixture TLS or ALPN differs")
    sprites = [match for path in paths if (match := SPRITE.fullmatch(path))]
    _need(len(sprites) <= 2 and len({match[1] for match in sprites}) <= 1,
          "sprite scale differs within the mixed fixture")
    return rows


def _native(value, rows, origin, certificate, *, active, pending):
    _need(isinstance(value, dict), "mixed native observation is absent")
    for name in (*COUNTERS, "mixedActiveSprites"):
        _integer(value.get(name), "mixed native." + name)
    started = len(rows)
    settled = started - active
    body = sum(row["bytesWritten"] for row in rows)
    _matches(value, {"active": active, "pending": pending, "maxActive": 4,
                     "started": started, "released": settled, "cancelledActive": 0,
                     "cancelledPending": 0, "blockedBeforeDispatch": 0,
                     "httpRequestSendsSettled": settled, "tlsVerifiedExchanges": settled,
                     "acceptedBodyBytes": body, "mixedActiveSprites": 0, "ledgerOK": True,
                     "transport": "pinned-private-tls-http1-fixture"},
             "mixed native counters differ from fixture observations")
    _need(max(1, pending) <= value["maxPending"] <= RESOURCE_COUNT - 5
          and value["receivedHTTPBytesSettled"] >= body, "mixed native peak or body observation differs")
    expected = {"schema": 1, "origin": origin, "requests": started,
                "tiles": sum(bool(TILE.fullmatch(row["path"])) for row in rows),
                "reservedBytes": started * RESERVATION, "maxRequests": 16, "maxTiles": 8,
                "maxReservedBytes": 16 * RESERVATION, "reservationBytes": RESERVATION,
                "fixtureResourceProfile": PROFILE}
    ledger = value.get("ledger")
    _matches(ledger, expected, "mixed reservation ledger identity or charge differs")
    _need(set(ledger) == set(expected) | {"fixtureTLSLeafDER", "unresolved"},
          "mixed reservation ledger fields differ")
    _certificate(ledger["fixtureTLSLeafDER"], certificate)
    permits = ledger["unresolved"]
    _need(isinstance(permits, list) and len(permits) == active
          and all(type(permit) is str and UUID.fullmatch(permit) for permit in permits)
          and len(set(permits)) == active, "mixed unresolved permits differ")
    return ledger


def validate_waiting(native, server, origin, certificate, *, encoded_glyph=False):
    """Require native queue and independent fixture evidence before releasing bodies."""
    origin = _origin(origin)
    _need(isinstance(server, dict) and isinstance(native, dict), "mixed waiting observations are absent")
    count = _integer(server.get("resourceCount"), "waiting resource count")
    _need(5 <= count <= 7, "waiting fixture must contain style, four held resources and optional sprites")
    rows = _server(server, origin, active=4, count=count, released=False, peak=4, encoded_glyph=encoded_glyph)
    _need(sum(row["held"] for row in rows) == 4, "four mixed fixture bodies must be open")
    pending = _integer(native.get("pending"), "waiting native pending")
    _need(1 <= pending <= RESOURCE_COUNT - count, "mixed fifth request is not waiting")
    _native(native, rows, origin, certificate, active=4, pending=pending)
    return rows


def verify(folder, origin, certificate, *, encoded_glyph=False):
    """Validate independently saved host, device, fixture and ledger observations."""
    try:
        return _verify(Path(folder), _origin(origin), certificate, encoded_glyph=encoded_glyph)
    except (KeyError, TypeError, IndexError, AttributeError, ValueError) as error:
        if isinstance(error, EvidenceError):
            raise
        raise EvidenceError("malformed mixed evidence") from error


def _verify(folder, origin, certificate, *, encoded_glyph):
    run = _read(folder / "run.json").get("runID")
    _need(type(run) is str and re.fullmatch(r"[A-Za-z0-9_-]{1,64}", run), "invalid mixed trial run ID")
    pid = _pid(_read(folder / "launch.json").get("process"))
    _need(_same(_read(folder / "process-after.json"), {"process": pid}),
          "the original mixed trial process was not observed at completion")
    result = _read(folder / "result.json")
    _matches(result, {"complete": True, "pass": True, "stage": "tls-mixed", "trialPhase": 2,
                      "runID": run, "process": pid, "mapCreated": True,
                      "delegateClass": "MLRNTransformRequest", "externalTileRequests": 0},
             "final mixed SDK trial identity or state differs")
    delegate = result.get("delegatePreserved")
    _need((delegate is True or type(delegate) is int and delegate == 1)
          and _integer(result.get("transforms"), "native transforms") >= RESOURCE_COUNT,
          "mixed native transform delegate evidence differs")
    _integer(result.get("rewrittenStyles"), "mixed rewritten styles")
    cases = result.get("cases")
    _need(isinstance(cases, list) and len(cases) == 1, "one successful mixed SDK case is required")
    case = cases[0]
    _matches(case, {"name": CASE_NAME, "pass": True, "styleLoaded": True, "fullyRendered": True,
                    "styleEvidence": {"rasterSource": True, "rasterLayer": True,
                                      "symbolSource": True, "symbolLayer": True}},
             "mixed raster and symbol style render evidence differs")
    waiting, final = case["waitingSnapshot"], case["native"]
    _need(_same(_read(folder / "waiting.json"), {"kind": "mixed-waiting", "runID": run,
                                               "process": pid, "native": waiting}),
          "independently captured mixed waiting observation differs")
    _need(_same(final, result.get("nativeAtFinish")), "final mixed native observation differs")

    _server(_read(folder / "server-initial.json"), origin, active=0, count=0, released=False, peak=0)
    before = validate_waiting(waiting, _read(folder / "server-before.json"), origin, certificate,
                              encoded_glyph=encoded_glyph)
    _need(_same(_read(folder / "release.json"), {"heldReleased": True, "releasedOpenBodies": 4}),
          "fixture release did not release exactly four open mixed bodies")
    after = _server(_read(folder / "server-final.json"), origin, active=0,
                    count=RESOURCE_COUNT, released=True, peak=4, encoded_glyph=encoded_glyph)
    for old, new in zip(before, after):
        _need(_same(new, dict(old, finished=True, bytesWritten=old["bytes"])),
              "mixed fixture response identity changed after release")
    categories = [_category(row["path"], ENCODED_GLYPH if encoded_glyph else GLYPH) for row in after]
    _need({kind: categories.count(kind) for kind in ("style", "tile", "glyph", "sprite")}
          == {"style": 1, "tile": 6, "glyph": 1, "sprite": 2},
          "mixed fixture did not complete the style, six tiles, glyph and sprite pair")
    ledger = _native(final, after, origin, certificate, active=0, pending=0)
    _need(final["maxPending"] >= waiting["maxPending"]
          and final["receivedHTTPBytesSettled"] >= waiting["receivedHTTPBytesSettled"],
          "mixed native cumulative observations decreased")
    _need(_same(_read(folder / "ledger.json"), ledger), "archived mixed reservation ledger differs")
    return {"validated": True, "cases": 1, "resources": RESOURCE_COUNT, "tiles": 6,
            "glyphs": 1, "spriteResponses": 2, "verifiedHTTPSExchanges": RESOURCE_COUNT,
            "nativeMaxActive": 4, "serverMaxActive": 4, "waitingActive": 4,
            "waitingPending": waiting["pending"], "waitingReservedBytes": waiting["ledger"]["reservedBytes"],
            "finalReservedBytes": ledger["reservedBytes"], "acceptedBodyBytes": final["acceptedBodyBytes"],
            "scope": "isolated same-process SDK mixed HTTPS response bodies and queued requests"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("evidence", type=Path)
    parser.add_argument("--origin", required=True, help="expected exact HTTPS fixture origin")
    parser.add_argument("--certificate", type=Path, required=True, help="expected public DER certificate")
    parser.add_argument("--encoded-glyph", action="store_true", help="require the encoded Noto Sans fixture path")
    args = parser.parse_args()
    try:
        with args.certificate.open("rb") as source:
            certificate = source.read(16_385)
        value = verify(args.evidence, args.origin, certificate, encoded_glyph=args.encoded_glyph)
    except (EvidenceError, OSError) as error:
        parser.exit(1, f"Evidence rejected: {error if isinstance(error, EvidenceError) else type(error).__name__}\n")
    print(json.dumps(value, sort_keys=True))


if __name__ == "__main__":
    main()
