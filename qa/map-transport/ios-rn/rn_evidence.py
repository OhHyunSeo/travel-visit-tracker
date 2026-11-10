"""Compare the isolated React Native app ledger with the HTTPS fixture."""

import json
from pathlib import Path
import sys


BUNDLE = "app.trippainting.rnmapqa"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ios-maplibre"))
from tls_result import _certificate, _need, _same


def save(output, name, value):
    (output / (name + ".json")).write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def verify(result, ledger, server, origin, certificate, run, pid, *, runtime):
    _need(result.get("complete") is True and result.get("pass") is True
          and result.get("delegatePreserved") is True and result.get("runID") == run
          and result.get("process") == pid, "native RN case or process differs")
    native = result["native"]
    _need(native.get("transport") == "pinned-private-tls-http1-fixture"
          and native.get("ledgerOK") is True
          and all(_same(native.get(key), 0) for key in
                  ("active", "pending", "blockedBeforeDispatch", "cancelledActive", "cancelledPending"))
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
    return {"validated": True, "runtime": runtime, "bundle": BUNDLE, "resources": paths,
            "verifiedHTTPSExchanges": 3, "acceptedBodyBytes": total}
