"""Compare the isolated React Native app ledger with the HTTPS fixture."""

import json
from pathlib import Path
import sys


BUNDLE = "app.trippainting.rnmapqa"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ios-maplibre"))
from tls_result import _certificate, _need, _same


def save(output, name, value):
    (output / (name + ".json")).write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def verify(result, ledger, server, origin, certificate, run, pid, *, runtime, initial_style=None):
    _need(initial_style in (None, "local-empty", "sdk-default"), "invalid initial style mode")
    expected_blocks = int(initial_style == "sdk-default")
    _need(result.get("complete") is True and result.get("pass") is True
          and result.get("delegatePreserved") is True and result.get("runID") == run
          and result.get("process") == pid, "native RN case or process differs")
    native = result["native"]
    if initial_style is not None:
        _need(_same(result.get("rnSchema"), 2) and result.get("initialStyleMode") == initial_style
              and result.get("renderConfirmedAfterTile") is True
              and result.get("localBootstrap") is (initial_style == "local-empty"),
              "initial style or render evidence differs")
        observed = result.get("observedRequests")
        _need(isinstance(observed, list) and len(observed) == 3 + expected_blocks,
              "observed request count differs")
        if expected_blocks:
            _need(observed[0].get("fixtureOrigin") is False
                  and observed[0].get("sdkDefaultStyle") is True, "the SDK default style was not identified")
        expected_paths = ["/resource/style/sdk", "/resource/tile/0_0_0", "/resource/style/empty"]
        for request, path in zip(observed[expected_blocks:], expected_paths):
            _need(request.get("fixtureOrigin") is True and request.get("resource") == path
                  and request.get("sdkDefaultStyle") is False, "observed fixture request differs")
        _need(all(request.get("get") is True and _same(request.get("query"), 0)
                  and _same(request.get("fragment"), 0) for request in observed), "observed method or URL differs")
    _need(native.get("transport") == "pinned-private-tls-http1-fixture"
          and native.get("ledgerOK") is True
          and all(_same(native.get(key), 0) for key in
                  ("active", "pending", "cancelledActive", "cancelledPending"))
          and _same(native.get("blockedBeforeDispatch"), expected_blocks)
          and all(_same(native.get(key), 3) for key in
                  ("started", "released", "httpRequestSendsSettled", "tlsVerifiedExchanges")),
          "native exchange counts differ")
    expected = {"schema": 1, "origin": origin, "requests": 3, "tiles": 1, "reservedBytes": 768,
                "maxRequests": 8, "maxTiles": 4, "maxReservedBytes": 2048, "reservationBytes": 256,
                "unresolved": []}
    _need(_same(native["ledger"], ledger)
          and _same({key: ledger.get(key) for key in expected}, expected), "native and stored ledger differ")
    _certificate(ledger.get("fixtureTLSLeafDER"), certificate)
    _need(_same(server.get("active"), 0) and _same(server.get("heldActive"), 0)
          and server.get("heldReleased") is False and _same(server.get("resourceCount"), 3),
          "fixture did not finish three resources")
    requests = server["requests"]
    paths = ["/resource/style/sdk", "/resource/tile/0_0_0", "/resource/style/empty"]
    _need([request.get("path") for request in requests] == paths, "fixture resource order differs")
    total = 0
    for request in requests:
        size = request.get("bytes")
        _need(type(size) is int and 0 < size <= 256 and _same(request.get("bytesWritten"), size)
              and request.get("finished") is True and request.get("closedBeforeFinish") is False
              and request.get("held") is False and request.get("receivedAuthHeader") is False
              and request.get("cookieHeader") is False
              and request.get("ua") == "TripPaintingMapTransportQA/1.0"
              and request.get("alpn") == "http/1.1"
              and request.get("tlsProtocol") in ("TLSv1.2", "TLSv1.3"), "fixture exchange differs")
        total += size
    _need(_same(native.get("acceptedBodyBytes"), total), "native and server body totals differ")
    summary = {"validated": True, "runtime": runtime, "bundle": BUNDLE, "resources": paths,
               "verifiedHTTPSExchanges": 3, "acceptedBodyBytes": total}
    if initial_style is not None:
        summary.update(initialStyleMode=initial_style, blockedSdkDefaultStyle=expected_blocks,
                       renderConfirmedAfterTile=True)
    return summary
