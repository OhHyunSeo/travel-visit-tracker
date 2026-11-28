"""Cross-check saved SDK HTTPS cancellation and same-path reload observations."""

import argparse
import json
from pathlib import Path
import re

from action_delivery import COUNTERS, PHASES, SEQUENCES, SIGNALS, _pid, _read
from tls_result import EvidenceError, _certificate, _integer, _need, _origin, _same


STAGE = "tls-cancel-retry"
HELD_STYLE = "/resource/style/held"
HELD_TILE = re.compile(r"/resource/tile/h_2_[0-3]_[0-3]")
UUID = re.compile(r"[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}")


def _matches(value, expected, reason):
    _need(isinstance(value, dict) and _same({key: value.get(key) for key in expected}, expected),
          reason)


def _native(value, label, origin, certificate, *, active, started, sends, verified, tiles):
    _need(isinstance(value, dict), label + " native observation is absent")
    for key in COUNTERS:
        _integer(value.get(key), label + "." + key)
    _matches(value, {"active": active, "maxActive": 4, "started": started,
                     "released": started - active, "blockedBeforeDispatch": 0,
                     "httpRequestSendsSettled": sends, "tlsVerifiedExchanges": verified,
                     "ledgerOK": True, "transport": "pinned-private-tls-http1-fixture"},
             label + " native TLS counters differ")
    _need(value["pending"] <= value["maxPending"], label + " pending peak differs")
    _need(value["receivedHTTPBytesSettled"] >= value["acceptedBodyBytes"] > 0,
          label + " native body counters differ")
    ledger = value.get("ledger")
    expected = {"schema": 1, "origin": origin, "requests": started, "tiles": tiles,
                "reservedBytes": started * 256, "maxRequests": 32, "maxTiles": 16,
                "maxReservedBytes": 8192, "reservationBytes": 256}
    _matches(ledger, expected, label + " ledger identity, limits or charge differ")
    _need(set(ledger) == set(expected) | {"unresolved", "fixtureTLSLeafDER"},
          label + " ledger keys differ")
    _certificate(ledger["fixtureTLSLeafDER"], certificate)
    unresolved = ledger["unresolved"]
    _need(isinstance(unresolved, list) and len(unresolved) == active
          and all(type(item) is str and UUID.fullmatch(item) for item in unresolved)
          and len(set(unresolved)) == active, label + " unresolved permits differ")
    return ledger


def _server(value, label, origin, *, active, count, released, peak=4):
    _matches(value, {"active": active, "maxActive": peak, "heldActive": active,
                     "resourceCount": count, "heldReleased": released},
             label + " server counts or hold state differ")
    _need(value.get("origin", origin) == origin, label + " server origin differs")
    entries = value.get("requests")
    _need(isinstance(entries, list) and len(entries) == count, label + " request history differs")
    for entry in entries:
        _need(isinstance(entry, dict), label + " resource is absent")
        path = entry.get("path")
        _need(type(path) is str and (path == HELD_STYLE or HELD_TILE.fullmatch(path)),
              label + " has an unexpected resource")
        size = _integer(entry.get("bytes"), label + ".bytes")
        written = _integer(entry.get("bytesWritten"), label + ".bytesWritten")
        _need(0 < size <= 256 and written <= size, label + " body size differs")
        _need(entry.get("held") is (path != HELD_STYLE)
              and type(entry.get("finished")) is bool
              and type(entry.get("closedBeforeFinish")) is bool
              and not (entry["finished"] and entry["closedBeforeFinish"]),
              label + " response lifecycle flags differ")
        _need(entry.get("ua") == "TripPaintingMapTransportQA/1.0"
              and entry.get("receivedAuthHeader") is False and entry.get("cookieHeader") is False,
              label + " credentials or User-Agent differ")
        _need(entry.get("alpn") == "http/1.1"
              and entry.get("tlsProtocol") in ("TLSv1.2", "TLSv1.3"),
              label + " TLS version or ALPN differs")
    return entries


def _finished(entry):
    return entry["finished"] and not entry["closedBeforeFinish"] and entry["bytesWritten"] == entry["bytes"]


def _held_paths(entries, count):
    paths = {entry["path"] for entry in entries if entry["held"]}
    _need(len(entries) == len(paths) == count, "held tile paths are missing or repeated")
    return paths


def validate_waiting_server(value, origin):
    """Require one completed style and four distinct open HTTPS tile bodies."""
    entries = _server(value, "waiting", _origin(origin), active=4, count=5, released=False)
    _need(entries[0]["path"] == HELD_STYLE and _finished(entries[0]), "initial style did not finish")
    _held_paths(entries[1:], 4)
    _need(all(not item["finished"] and not item["closedBeforeFinish"] and item["bytesWritten"] == 0
              for item in entries[1:]), "initial held body was delivered or closed")
    return entries


def validate_drained_server(value, waiting, origin):
    """Require the original four bodies to close before releasing the fixture."""
    before = validate_waiting_server(waiting, origin)
    entries = _server(value, "drained", _origin(origin), active=0, count=5, released=False)
    _need(_same(entries[0], before[0]), "initial style history changed at cancellation")
    for old, new in zip(before[1:], entries[1:]):
        _need(_same(new, dict(old, closedBeforeFinish=True)),
              "an original held HTTPS body changed identity or did not close without writing")
    return entries


def _server_evidence(folder, origin):
    _server(_read(folder / "server-initial.json"), "initial", origin,
            active=0, count=0, released=False, peak=0)
    waiting = _read(folder / "server-before.json")
    drained = validate_drained_server(_read(folder / "server-drained.json"), waiting, origin)
    _need(_same(_read(folder / "release.json"), {"heldReleased": True, "releasedOpenBodies": 0}),
          "fixture release reopened an old response")
    final = _server(_read(folder / "server-final.json"), "final", origin,
                    active=0, count=12, released=True)
    _need(_same(final[:5], drained), "old response history changed after release")
    style, *tiles = final[5:]
    _need(style["path"] == HELD_STYLE and style["bytes"] == drained[0]["bytes"],
          "the same style was not requested again")
    old_paths = _held_paths(drained[1:], 4)
    new_paths = _held_paths(tiles, 6)
    _need(old_paths <= new_paths, "an old tile path was not requested again")
    old_sizes = {entry["path"]: entry["bytes"] for entry in drained[1:]}
    _need(all(entry["bytes"] == old_sizes.get(entry["path"], entry["bytes"]) for entry in tiles),
          "a repeated tile changed fixture body size")
    _need(all(_finished(item) for item in final[5:]), "a reload body did not complete")
    return drained[0]["bytes"], sum(item["bytesWritten"] for item in final)


def _scene_evidence(folder, result, waiting, cancelled):
    run = _read(folder / "run.json").get("runID")
    _need(type(run) is str and re.fullmatch(r"[A-Za-z0-9_-]{1,64}", run), "invalid run ID")
    pid = _pid(_read(folder / "launch.json").get("process"))
    attempts = [{"accepted": index != 1, "phaseBefore": PHASES[index],
                 "phaseAfter": after, "sequenceBefore": SEQUENCES[index],
                 "sequenceAfter": SEQUENCES[index + 1]}
                for index, after in enumerate((11, 12, 13))]
    _matches(result, {"runID": run, "process": pid, "fixtureActionSequence": 2,
                      "fixtureActionAttempts": attempts}, "final scene action evidence differs")
    for step, native in enumerate((waiting, cancelled, cancelled, cancelled)):
        expected = {"kind": "fixture-action-progress", "stage": STAGE, "runID": run,
                    "process": pid, "phase": PHASES[step], "sequence": SEQUENCES[step],
                    "attempts": attempts[:step], "native": native}
        _need(_same(_read(folder / f"progress-{step}.json"), expected),
              f"scene progress or native observation differs at step {step}")
        if step:
            _need(_same(_read(folder / f"payload-{step}.json"),
                        {"process": pid, "signal": SIGNALS[step - 1]}),
                  f"host payload process or signal differs at step {step}")
    _need(_same(_read(folder / "process-after.json"), {"process": pid}),
          "the original process was not observed after reload")


def verify(folder, origin, certificate):
    """Validate independently captured host, scene, server and ledger files."""
    try:
        return _verify(Path(folder), _origin(origin), certificate)
    except (KeyError, TypeError, IndexError, AttributeError, ValueError) as error:
        if isinstance(error, EvidenceError):
            raise
        raise EvidenceError("malformed evidence") from error


def _verify(folder, origin, certificate):
    result = _read(folder / "result.json")
    _matches(result, {"complete": True, "pass": True, "stage": STAGE, "trialPhase": 13,
                      "mapCreated": True, "cancellationTrigger": "local-style-json",
                      "delegateClass": "MLRNTransformRequest", "externalTileRequests": 0},
             "final SDK trial evidence differs")
    delegate = result.get("delegatePreserved")
    _need((delegate is True or type(delegate) is int and delegate == 1)
          and _integer(result.get("transforms"), "transforms") >= 12
          and _integer(result.get("rewrittenStyles"), "rewrittenStyles") == 0,
          "SDK transform delegate evidence differs")
    cases = result.get("cases")
    _need(isinstance(cases, list) and len(cases) == 2, "two successful SDK phases are required")
    cancel, reload = cases
    _matches(cancel, {"name": "SDK style change cancels active and pending requests",
                      "pass": True, "localEmptyStyleLoaded": True}, "cancel case differs")
    _matches(reload, {"name": "manual SDK style reload repeats paths with retained charge",
                      "pass": True, "styleLoaded": True, "fullyRendered": True}, "reload case differs")
    empty = cancel.get("emptyStyleEvidence")
    _matches(empty, {"json": {"version": 8, "sources": {}, "layers": []}, "noSyntheticRaster": True},
             "local empty-style evidence differs")
    for key in ("nativeSourceIDs", "nativeLayerIDs"):
        ids = empty.get(key)
        _need(isinstance(ids, list) and all(type(item) is str and item != "t" for item in ids),
              "synthetic raster survived the style change")
    _need(_same(empty, result.get("emptyStyleEvidence")), "final empty-style evidence differs")

    waiting, cancelled, final = cancel["waitingSnapshot"], cancel["native"], reload["native"]
    _native(waiting, "waiting", origin, certificate, active=4, started=5, sends=1, verified=1, tiles=4)
    _native(cancelled, "cancelled", origin, certificate, active=0, started=5, sends=5, verified=1, tiles=4)
    ledger = _native(final, "final", origin, certificate, active=0, started=12, sends=12, verified=8, tiles=10)
    _need(1 <= waiting["pending"] <= cancelled["cancelledPending"] <= 2
          and waiting["cancelledActive"] == waiting["cancelledPending"] == 0,
          "pending baseline or cancellation count differs")
    _need(cancelled["cancelledActive"] == final["cancelledActive"] == 4
          and cancelled["cancelledPending"] == final["cancelledPending"]
          and cancelled["pending"] == final["pending"] == 0,
          "four active requests and the queued requests did not drain on cancellation")
    _need(waiting["maxPending"] <= cancelled["maxPending"] <= final["maxPending"]
          and cancelled["maxPending"] >= cancelled["cancelledPending"]
          and waiting["receivedHTTPBytesSettled"] <= cancelled["receivedHTTPBytesSettled"]
          <= final["receivedHTTPBytesSettled"], "native cumulative observations decreased")
    _need(_same(cancelled, reload.get("beforeRetry")) and _same(final, result.get("nativeAtFinish")),
          "cross-phase native snapshots differ")
    _need(_same(_read(folder / "ledger.json"), ledger), "archived ledger differs")

    style_bytes, total_bytes = _server_evidence(folder, origin)
    _need(waiting["acceptedBodyBytes"] == cancelled["acceptedBodyBytes"] == style_bytes
          and final["acceptedBodyBytes"] == total_bytes, "native accepted body totals differ")
    _scene_evidence(folder, result, waiting, cancelled)
    return {"validated": True, "cases": 2, "resources": 12, "cancelledActive": 4,
            "cancelledPending": cancelled["cancelledPending"], "repeatedOldPaths": 4,
            "reloadDistinctTiles": 6, "verifiedHTTPSExchanges": 8,
            "waitingReservedBytes": 1280, "cancelledReservedBytes": 1280,
            "finalReservedBytes": 3072, "acceptedBodyBytes": total_bytes,
            "scope": "isolated same-process SDK HTTPS style cancellation and same-path reload"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("evidence", type=Path)
    parser.add_argument("--origin", required=True, help="expected exact HTTPS fixture origin")
    parser.add_argument("--certificate", type=Path, required=True, help="expected public DER certificate")
    args = parser.parse_args()
    try:
        with args.certificate.open("rb") as source:
            certificate = source.read(16_385)
        value = verify(args.evidence, args.origin, certificate)
    except (EvidenceError, OSError) as error:
        parser.exit(1, f"Evidence rejected: {error if isinstance(error, EvidenceError) else type(error).__name__}\n")
    print(json.dumps(value, sort_keys=True))


if __name__ == "__main__":
    main()
