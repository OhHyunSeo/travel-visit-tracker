"""Cross-check local SDK cancellation evidence; this does not run a device test."""

import argparse
import ipaddress
import json
from pathlib import Path
import re
from urllib.parse import urlsplit


class EvidenceError(ValueError):
    """A report is missing evidence or contradicts another saved observation."""


def _need(condition, message):
    if not condition:
        raise EvidenceError(message)


def _integer(value, label):
    _need(type(value) is int and value >= 0, label + " must be an unsigned integer")
    return value


def _native(value, label, idle=False):
    _need(isinstance(value, dict), label + " is not an object")
    keys = ("active", "pending", "maxActive", "maxPending", "cancelledActive",
            "cancelledPending", "released", "started", "blockedBeforeDispatch",
            "httpRequestSendsSettled", "receivedHTTPBytesSettled", "acceptedBodyBytes")
    for key in keys:
        _integer(value.get(key), label + "." + key)
    _need(value.get("ledgerOK") is True, label + " ledger is invalid")
    _need(value["maxActive"] == 4 and value["active"] <= 4, label + " permit peak differs")
    _need(value["maxPending"] >= value["pending"], label + " pending peak differs")
    _need(value["blockedBeforeDispatch"] == 0, label + " has blocked requests")
    _need(value["active"] + value["released"] == value["started"], label + " releases differ")
    ledger = value.get("ledger")
    _need(isinstance(ledger, dict), label + " has no ledger")
    for key in ("requests", "tiles", "reservedBytes", "maxRequests", "maxTiles",
                "maxReservedBytes", "reservationBytes", "schema"):
        _integer(ledger.get(key), label + ".ledger." + key)
    _need(ledger["schema"] == 1 and ledger["reservationBytes"] == 256, label + " ledger schema differs")
    _need(ledger["maxRequests"] == 64 and ledger["maxTiles"] == 32
          and ledger["maxReservedBytes"] == 16384, label + " ledger limits differ")
    _need(ledger["requests"] == value["started"], label + " acquired requests differ")
    _need(ledger["tiles"] <= ledger["requests"] <= ledger["maxRequests"]
          and ledger["tiles"] <= ledger["maxTiles"], label + " ledger request bounds differ")
    _need(ledger["reservedBytes"] == ledger["requests"] * 256
          and ledger["reservedBytes"] <= ledger["maxReservedBytes"], label + " charge differs")
    unresolved = ledger.get("unresolved")
    _need(isinstance(unresolved, list) and all(isinstance(x, str) and x for x in unresolved),
          label + " unresolved list differs")
    _need(len(unresolved) == len(set(unresolved)) == value["active"], label + " unresolved permits differ")
    try:
        origin = urlsplit(ledger.get("origin", ""))
        address = ipaddress.IPv4Address(origin.hostname)
        permitted = address.is_loopback or address in ipaddress.ip_network("10.0.0.0/8") \
            or address in ipaddress.ip_network("172.16.0.0/12") \
            or address in ipaddress.ip_network("192.168.0.0/16")
        _need(origin.scheme == "http" and permitted and origin.port
              and 1 <= origin.port <= 65535 and not origin.username and not origin.password
              and not origin.query and not origin.fragment and origin.path == "", label + " origin differs")
    except (ValueError, TypeError):
        raise EvidenceError(label + " origin differs") from None
    if idle:
        _need(value["active"] == value["pending"] == 0 and not unresolved, label + " is not idle")
    return ledger


def _server(value, label, idle=False):
    _need(isinstance(value, dict), label + " is not an object")
    for key in ("active", "maxActive", "heldActive", "resourceCount"):
        _integer(value.get(key), label + "." + key)
    _need(type(value.get("heldReleased")) is bool, label + " release flag differs")
    entries = value.get("requests")
    _need(isinstance(entries, list) and len(entries) == value["resourceCount"], label + " resource count differs")
    _need(value["maxActive"] >= value["active"], label + " server peak differs")
    for entry in entries:
        _need(isinstance(entry, dict), label + " entry differs")
        path = entry.get("path", "")
        held = bool(re.fullmatch(r"/resource/tile/h_2_[0-3]_[0-3]", path))
        _need(held or path == "/resource/style/held", label + " unexpected path")
        _need(entry.get("held") is held, label + " held flag differs")
        _need(entry.get("ua") == "TripPaintingMapTransportQA/1.0"
              and entry.get("receivedAuthHeader") is False and entry.get("cookieHeader") is False,
              label + " credentials or User-Agent differ")
        size = _integer(entry.get("bytes"), label + " entry.bytes")
        written = _integer(entry.get("bytesWritten"), label + " entry.bytesWritten")
        _need(0 < size <= 256 and written <= size, label + " payload size differs")
        _need(type(entry.get("finished")) is bool and type(entry.get("closedBeforeFinish")) is bool,
              label + " completion flags differ")
        _need(not (entry["finished"] and entry["closedBeforeFinish"]), label + " contradictory completion")
        if entry["finished"]:
            _need(written == size, label + " finished body is incomplete")
    if idle:
        _need(value["active"] == value["heldActive"] == 0, label + " server is not idle")
    return entries


def validate(result, server, ledger=None, pid=None):
    """Raise EvidenceError for missing/conflicting evidence; return safe count summary."""
    try:
        return _validate(result, server, ledger, pid)
    except (KeyError, TypeError, IndexError, AttributeError) as error:
        raise EvidenceError("malformed evidence") from error


def _validate(result, server, archived, pid):
    _need(isinstance(result, dict) and result.get("complete") is True and result.get("pass") is True,
          "trial did not complete successfully")
    _need(result.get("stage") == "cancel-retry", "wrong trial stage")
    _need(result.get("cancellationTrigger") == "local-style-json", "wrong cancellation trigger")
    actual_pid = _integer(result.get("process"), "process")
    _need(actual_pid > 0 and (pid is None or type(pid) is int and actual_pid == pid), "process differs")
    # Objective-C boxes a C logical expression as NSNumber(int), serialized as 1.
    # Accept that exact wire value here; counters and other booleans stay strict.
    preserved = result.get("delegatePreserved")
    _need((preserved is True or type(preserved) is int and preserved == 1)
          and result.get("delegateClass") == "MLRNTransformRequest",
          "native transform delegate differs")
    cases = result.get("cases")
    _need(isinstance(cases, list) and len(cases) == 2 and all(x.get("pass") is True for x in cases),
          "two successful cases are required")
    cancellation, retry = cases
    _need(cancellation.get("localEmptyStyleLoaded") is True,
          "local empty-style completion evidence is absent")
    empty = cancellation.get("emptyStyleEvidence", {})
    _need(empty.get("json") == {"version": 8, "sources": {}, "layers": []}
          and empty.get("noSyntheticRaster") is True
          and isinstance(empty.get("nativeSourceIDs"), list)
          and isinstance(empty.get("nativeLayerIDs"), list)
          and "t" not in empty["nativeSourceIDs"] and "t" not in empty["nativeLayerIDs"],
          "empty JSON or removed raster evidence differs")
    waiting, cancelled, final = cancellation["waitingSnapshot"], cancellation["native"], retry["native"]
    ledgers = [_native(waiting, "waiting"), _native(cancelled, "cancelled", True), _native(final, "final", True)]
    _need(waiting["active"] == 4 and waiting["pending"] >= 1, "four active and pending baseline is absent")
    _need(waiting["cancelledActive"] == waiting["cancelledPending"] == 0, "baseline already cancelled")
    _need(cancelled["cancelledActive"] >= 1 and cancelled["cancelledPending"] >= 1,
          "both active and pending cancellations are required")
    _need(retry["beforeRetry"] == cancelled and result["nativeAtFinish"] == final,
          "cross-stage native snapshot differs")
    _need(retry.get("fullyRendered") is True and retry.get("styleLoaded") is True,
          "retry style/render evidence is absent")
    release = retry.get("releaseControl")
    _need(isinstance(release, dict) and release.get("heldReleased") is True
          and type(release.get("releasedOpenBodies")) is int and release["releasedOpenBodies"] == 0,
          "release revived an old response")
    identity = ("origin", "schema", "reservationBytes", "maxRequests", "maxTiles", "maxReservedBytes")
    monotonic = ("maxActive", "maxPending", "started", "released", "cancelledActive", "cancelledPending",
                 "httpRequestSendsSettled", "receivedHTTPBytesSettled", "acceptedBodyBytes")
    for before, after, old_ledger, new_ledger in zip((waiting, cancelled), (cancelled, final), ledgers, ledgers[1:]):
        _need(all(old_ledger[k] == new_ledger[k] for k in identity), "ledger identity/limits changed")
        _need(all(after[k] >= before[k] for k in monotonic), "native counters reset")
        _need(all(new_ledger[k] >= old_ledger[k] for k in ("requests", "tiles", "reservedBytes")), "ledger charge was refunded")
    _need(ledgers[-1]["reservedBytes"] > ledgers[1]["reservedBytes"], "retry was not charged")
    _need(all(final[k] == cancelled[k] for k in ("cancelledActive", "cancelledPending")), "retry unexpectedly cancelled")
    before_server, cancelled_server = cancellation["waitingServer"], cancellation["serverAfterCancel"]
    before_entries = _server(before_server, "waitingServer")
    cancelled_entries = _server(cancelled_server, "serverAfterCancel", True)
    final_entries = _server(server, "server", True)
    _need(server == retry["server"], "external and embedded server snapshots differ")
    _need(before_server["active"] == before_server["heldActive"] == 4
          and before_server["heldReleased"] is False and cancelled_server["heldReleased"] is False
          and server["heldReleased"] is True, "server hold lifecycle differs")
    old_held = [x for x in before_entries if x["held"]]
    old_paths = {x["path"] for x in old_held}
    _need(len(old_held) == len(old_paths) == 4, "four distinct old held paths are required")
    _need(all(x["bytesWritten"] == 0 and not x["finished"] and not x["closedBeforeFinish"] for x in old_held),
          "baseline body was already delivered or closed")
    _need(len(cancelled_entries) >= len(before_entries), "cancelled resource history was lost")
    for old, new in zip(before_entries, cancelled_entries):
        _need(all(old[k] == new[k] for k in ("path", "bytes", "held", "ua", "receivedAuthHeader", "cookieHeader")),
              "old resource identity changed")
    _need(final_entries[:len(cancelled_entries)] == cancelled_entries, "closed resource prefix changed after release")
    for entry in cancelled_entries:
        if entry["held"]:
            _need(entry["closedBeforeFinish"] and not entry["finished"] and entry["bytesWritten"] == 0,
                  "old held response did not close without body")
        else:
            _need(entry["finished"], "style did not complete")
    suffix = final_entries[len(cancelled_entries):]
    retry_tiles = [x for x in suffix if x["held"] and x["finished"] and not x["closedBeforeFinish"]]
    retry_paths = {x["path"] for x in retry_tiles}
    _need(len(retry_paths) >= 5 and old_paths <= retry_paths, "same old paths did not really retry")
    _need(all(x["finished"] and not x["closedBeforeFinish"] for x in suffix), "retry has unfinished resources")
    paths_before = [x["path"] for x in before_entries]
    paths_cancel = [x["path"] for x in cancelled_entries]
    paths_final = [x["path"] for x in final_entries]
    _need(paths_before.count("/resource/style/held") == 1
          and paths_cancel.count("/resource/style/held") == 1
          and paths_final.count("/resource/style/held") == 2,
          "SDK style sequence differs")
    _need(final["httpRequestSendsSettled"] == server["resourceCount"], "native sends and server resources differ")
    _need(final["acceptedBodyBytes"] == sum(x["bytesWritten"] for x in final_entries if x["finished"]),
          "accepted body evidence differs")
    if archived is not None:
        _need(archived == ledgers[-1], "archived ledger differs")
    return {"validated": True, "cases": 2, "resources": server["resourceCount"],
            "repeatedOldPaths": len(old_paths), "retryDistinctTiles": len(retry_paths),
            "nativeMaxActive": final["maxActive"], "serverMaxActive": server["maxActive"],
            "scope": "saved isolated SDK manual style-reload evidence only"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("result", type=Path)
    parser.add_argument("server", type=Path)
    parser.add_argument("--ledger", type=Path)
    parser.add_argument("--pid", type=int)
    args = parser.parse_args()
    try:
        value = validate(json.loads(args.result.read_text()), json.loads(args.server.read_text()),
                         json.loads(args.ledger.read_text()) if args.ledger else None, args.pid)
    except (EvidenceError, OSError, json.JSONDecodeError) as error:
        parser.exit(1, "Evidence rejected: " + str(error) + "\n")
    print(json.dumps(value, sort_keys=True))


if __name__ == "__main__":
    main()
