"""Compare the isolated React Native app ledger with the HTTPS fixture."""

import json
from pathlib import Path
import sys


BUNDLE = "app.trippainting.rnmapqa"
INITIAL_STYLES = ("local-empty", "local-missing", "sdk-default")
CASES = ("render", "pack-recovery")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ios-maplibre"))
from tls_result import _certificate, _need, _same


def save(output, name, value):
    (output / (name + ".json")).write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def verify(result, ledger, server, origin, certificate, run, pid, *, runtime, initial_style=None):
    _need(initial_style is None or initial_style in INITIAL_STYLES, "invalid initial style mode")
    expected_blocks = int(initial_style == "sdk-default")
    _need(result.get("complete") is True and result.get("pass") is True
          and result.get("delegatePreserved") is True and result.get("runID") == run
          and result.get("process") == pid, "native RN case or process differs")
    native = result["native"]
    if initial_style is not None:
        _need(_same(result.get("rnSchema"), 2) and result.get("initialStyleMode") == initial_style
              and result.get("renderConfirmedAfterTile") is True
              and result.get("localBootstrap") is (initial_style != "sdk-default"),
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


def verify_pack_recovery(result, recovery, ledger, server, origin, certificate, run, pid, *, runtime):
    _need(result.get("complete") is True and result.get("pass") is True and
          result.get("delegatePreserved") is True and result.get("runID") == run and
          result.get("process") == pid, "native pack recovery evidence differs")
    states = recovery.get("states")
    _need(isinstance(states, list) and states[:2] == ["idle", "awaiting-pack"] and
          states[-1] == "complete" and all(state == "incomplete" for state in states[2:-1]),
          "unexpected Expo operation states")
    status = recovery.get("status", {})
    pack_id = recovery.get("createdPackId")
    _need(recovery.get("pass") is True and isinstance(pack_id, str) and pack_id and
          recovery.get("savedPackId") == pack_id and status.get("packId") == pack_id and
          status.get("kind") == "complete" and
          _same(status.get("completedResourceCount"), 2) and _same(status.get("requiredResourceCount"), 2) and
          _same(status.get("completedTileCount"), 1),
          "the recovered SDK and SQLite pack records differ")
    paths = ["/resource/style/pack-recovery", "/resource/tile/pack_8_219_98"]
    native = result["native"]
    _need(native.get("ledgerOK") is True and
          all(_same(native.get(k), 2) for k in ("started", "released", "httpRequestSendsSettled", "tlsVerifiedExchanges")) and
          all(_same(native.get(k), 0) for k in ("active", "pending", "blockedBeforeDispatch")), "pack exchanges differ")
    _need(_same(native.get("ledger"), ledger) and ledger.get("origin") == origin and
          _same(ledger.get("requests"), 2) and _same(ledger.get("tiles"), 1) and
          _same(ledger.get("reservedBytes"), 512) and _same(ledger.get("unresolved"), []), "pack request ledger differs")
    _certificate(ledger.get("fixtureTLSLeafDER"), certificate)
    requests = server.get("requests", [])
    _need(_same(server.get("active"), 0) and _same(server.get("resourceCount"), 2) and
          [item.get("path") for item in requests] == paths, "pack server resources differ")
    _need([item.get("resource") for item in result.get("observedRequests", [])] == paths and
          all(item.get("finished") is True and item.get("receivedAuthHeader") is False and
              item.get("cookieHeader") is False and item.get("alpn") == "http/1.1" and
              _same(item.get("bytes"), item.get("bytesWritten")) for item in requests) and
          _same(native.get("acceptedBodyBytes"), sum(item["bytes"] for item in requests)), "pack response evidence differs")
    return {"validated": True, "runtime": runtime, "bundle": BUNDLE, "resources": paths,
            "verifiedHTTPSExchanges": 2, "samePackPersisted": True, "operationStates": states}


def verify_pack_reopen(result, recovery, ledger, origin, certificate, run, pid, previous_pid, previous_pack):
    _need(result.get("complete") is True and result.get("pass") is True and
          result.get("delegatePreserved") is True and result.get("runID") == run and
          result.get("process") == pid and pid != previous_pid, "QA did not complete in a new process")
    _need(recovery.get("pass") is True and recovery.get("states") == ["complete"] and
          recovery.get("savedPackId") == previous_pack.get("savedPackId") and
          _same(recovery.get("status"), previous_pack.get("status")), "saved pack or completion changed")
    native = result["native"]
    _need(result.get("observedRequests") == [] and native.get("ledgerOK") is True and
          all(_same(native.get(k), 0) for k in ("started", "released", "httpRequestSendsSettled", "tlsVerifiedExchanges",
              "active", "pending", "blockedBeforeDispatch", "acceptedBodyBytes")), "reopen attempted transport")
    _need(_same(native.get("ledger"), ledger) and ledger.get("origin") == origin and
          all(_same(ledger.get(k), 0) for k in ("requests", "tiles", "reservedBytes")) and
          ledger.get("unresolved") == [], "reopen reserved resources")
    _certificate(ledger.get("fixtureTLSLeafDER"), certificate)
    return {"validated": True, "runtime": "physical-iphone", "bundle": BUNDLE,
            "samePackPersisted": True, "newProcess": True, "verifiedHTTPSExchanges": 0}
