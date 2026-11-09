"""Synthetic report checks for the saved SDK HTTPS cancellation evidence."""

import base64
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

from tls_cancel_result import EvidenceError, verify


ORIGIN = "https://192.168.50.2:3091"
CERTIFICATE = b"synthetic public DER bytes"
PID = 842
RUN = "tls-cancel-run"


def _entry(path, state):
    held = "/tile/" in path
    size = 202 if not held else 106
    return {"path": path, "bytes": size, "bytesWritten": size if state == "finished" else 0,
            "finished": state == "finished", "closedBeforeFinish": state == "closed", "held": held,
            "ua": "TripPaintingMapTransportQA/1.0", "receivedAuthHeader": False, "cookieHeader": False,
            "tlsProtocol": "TLSv1.3", "alpn": "http/1.1"}


def _server(entries, active, released):
    return {"active": active, "maxActive": 4 if entries else 0, "heldActive": active,
            "resourceCount": len(entries), "heldReleased": released, "requests": entries}


def reports(pending=2):
    style = "/resource/style/held"
    tiles = [f"/resource/tile/h_2_{x}_{y}" for x in range(3) for y in range(2)]
    waiting_server = _server([_entry(style, "finished")] + [_entry(p, "waiting") for p in tiles[:4]],
                             active=4, released=False)
    drained = _server([_entry(style, "finished")] + [_entry(p, "closed") for p in tiles[:4]],
                      active=0, released=False)
    final_server = _server(deepcopy(drained["requests"]) + [_entry(p, "finished") for p in (style, *tiles)],
                           active=0, released=True)
    ledger = {"schema": 1, "origin": ORIGIN, "requests": 5, "tiles": 4, "reservedBytes": 1280,
              "unresolved": [f"00000000-0000-0000-0000-{i:012X}" for i in range(1, 5)],
              "maxRequests": 32, "maxTiles": 16, "maxReservedBytes": 8192, "reservationBytes": 256,
              "fixtureTLSLeafDER": base64.b64encode(CERTIFICATE).decode("ascii")}
    waiting = {"active": 4, "pending": pending, "maxActive": 4, "maxPending": pending,
               "cancelledActive": 0, "cancelledPending": 0, "started": 5, "released": 1,
               "blockedBeforeDispatch": 0, "httpRequestSendsSettled": 1,
               "receivedHTTPBytesSettled": 355, "acceptedBodyBytes": 202, "tlsVerifiedExchanges": 1,
               "ledgerOK": True, "transport": "pinned-private-tls-http1-fixture", "ledger": ledger}
    cancelled = dict(waiting, active=0, pending=0, cancelledActive=4, cancelledPending=pending,
                     released=5, httpRequestSendsSettled=5, receivedHTTPBytesSettled=939,
                     ledger=dict(ledger, unresolved=[]))
    final = dict(cancelled, maxPending=3, started=12, released=12, httpRequestSendsSettled=12,
                 receivedHTTPBytesSettled=2806, acceptedBodyBytes=1040, tlsVerifiedExchanges=8,
                 ledger=dict(ledger, requests=12, tiles=10, reservedBytes=3072, unresolved=[]))
    empty = {"json": {"version": 8, "sources": {}, "layers": []}, "noSyntheticRaster": True,
             "nativeSourceIDs": ["annotation-source"], "nativeLayerIDs": ["annotation-layer"]}
    cases = [{"name": "SDK style change cancels active and pending requests", "pass": True,
              "native": cancelled, "waitingSnapshot": waiting, "localEmptyStyleLoaded": True,
              "emptyStyleEvidence": empty},
             {"name": "manual SDK style reload repeats paths with retained charge", "pass": True,
              "native": final, "beforeRetry": cancelled, "styleLoaded": True, "fullyRendered": True}]
    attempts = [{"accepted": True, "phaseBefore": 10, "phaseAfter": 11,
                 "sequenceBefore": 0, "sequenceAfter": 1},
                {"accepted": False, "phaseBefore": 12, "phaseAfter": 12,
                 "sequenceBefore": 1, "sequenceAfter": 1},
                {"accepted": True, "phaseBefore": 12, "phaseAfter": 13,
                 "sequenceBefore": 1, "sequenceAfter": 2}]
    result = {"complete": True, "pass": True, "stage": "tls-cancel-retry", "trialPhase": 13,
              "cancellationTrigger": "local-style-json", "mapCreated": True, "runID": RUN,
              "process": PID, "fixtureActionSequence": 2, "fixtureActionAttempts": attempts,
              "delegatePreserved": 1, "delegateClass": "MLRNTransformRequest",
              "transforms": 14, "rewrittenStyles": 0, "externalTileRequests": 0,
              "nativeAtFinish": final, "emptyStyleEvidence": empty, "cases": cases}
    evidence = {"result.json": result, "ledger.json": final["ledger"], "run.json": {"runID": RUN},
                "launch.json": {"process": PID}, "process-after.json": {"process": PID},
                "server-initial.json": _server([], active=0, released=False),
                "server-before.json": waiting_server, "server-drained.json": drained,
                "release.json": {"heldReleased": True, "releasedOpenBodies": 0},
                "server-final.json": final_server}
    for i, (phase, sequence, native) in enumerate(zip((10, 12, 12, 13), (0, 1, 1, 2),
                                                      (waiting, cancelled, cancelled, cancelled))):
        evidence[f"progress-{i}.json"] = {"kind": "fixture-action-progress", "stage": "tls-cancel-retry",
                                         "runID": RUN, "process": PID, "phase": phase,
                                         "sequence": sequence, "attempts": attempts[:i], "native": native}
    for i, signal in enumerate(("cancel", "cancel", "reload"), start=1):
        evidence[f"payload-{i}.json"] = {"process": PID, "signal": signal}
    # The files are independent observations. A mutation in one must not
    # implicitly change a corroborating snapshot in another.
    return {name: json.loads(json.dumps(value)) for name, value in evidence.items()}


class TLSCancelResultTests(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.folder = Path(directory.name)
        self.evidence = reports()

    def write(self):
        for name, value in self.evidence.items():
            (self.folder / name).write_text(json.dumps(value), encoding="utf-8")

    def check(self, origin=ORIGIN, certificate=CERTIFICATE):
        self.write()
        return verify(self.folder, origin, certificate)

    def test_accepts_correlated_evidence_and_reports_unchanged_then_new_charge(self):
        summary = self.check()
        self.assertEqual([summary[k] for k in ("validated", "cases", "resources", "cancelledActive",
                                              "cancelledPending", "repeatedOldPaths", "reloadDistinctTiles",
                                              "verifiedHTTPSExchanges", "waitingReservedBytes",
                                              "cancelledReservedBytes", "finalReservedBytes",
                                              "acceptedBodyBytes")],
                         [True, 2, 12, 4, 2, 4, 6, 8, 1280, 1280, 3072, 1040])

    def test_single_pending_baseline_and_tls12_are_valid(self):
        self.evidence = reports(pending=1)
        for name in ("server-before.json", "server-drained.json", "server-final.json"):
            self.evidence[name]["requests"][0]["tlsProtocol"] = "TLSv1.2"
        self.assertEqual(self.check()["cancelledPending"], 1)

    def test_cross_checks_all_coredevice_process_reports(self):
        for name in ("launch.json", "payload-1.json", "payload-2.json",
                     "payload-3.json", "process-after.json"):
            with self.subTest(name=name), self.assertRaises(EvidenceError):
                self.evidence = reports()
                self.evidence[name]["process"] = PID + 1
                self.check()

    def test_app_progress_records_duplicate_rejection_and_pre_dispatch_reload(self):
        cases = (("progress-2.json", "attempts", [{"accepted": True}, {"accepted": True}]),
                 ("progress-1.json", "phase", 11), ("progress-0.json", "runID", "other-run"),
                 ("progress-3.json", "native", reports()["result.json"]["nativeAtFinish"]))
        for name, key, value in cases:
            with self.subTest(name=name, key=key), self.assertRaises(EvidenceError):
                self.evidence = reports()
                self.evidence[name][key] = value
                self.check()

    def test_refuses_closed_before_cancel_or_written_after_cancel(self):
        for name, key, value in (("server-before.json", "closedBeforeFinish", True),
                                 ("server-drained.json", "bytesWritten", 1),
                                 ("server-drained.json", "closedBeforeFinish", False)):
            with self.subTest(name=name, key=key), self.assertRaises(EvidenceError):
                self.evidence = reports()
                self.evidence[name]["requests"][1][key] = value
                self.check()

    def test_requires_fresh_fixture_and_release_of_zero_open_bodies(self):
        for name, key, value in (("server-initial.json", "maxActive", 1),
                                 ("server-drained.json", "heldReleased", True),
                                 ("release.json", "releasedOpenBodies", 1),
                                 ("release.json", "releasedOpenBodies", False)):
            with self.subTest(name=name, key=key), self.assertRaises(EvidenceError):
                self.evidence = reports()
                self.evidence[name][key] = value
                self.check()

    def test_requires_all_cancelled_paths_to_repeat_after_same_style(self):
        for index, path in ((5, "/resource/tile/h_2_3_3"), (6, "/resource/tile/h_2_3_3"),
                            (7, "/resource/tile/h_2_0_0")):
            with self.subTest(index=index, path=path), self.assertRaises(EvidenceError):
                self.evidence = reports()
                self.evidence["server-final.json"]["requests"][index]["path"] = path
                self.check()

    def test_rejects_changed_cancelled_history_and_unauthenticated_protocol(self):
        for name, index, key, value in (("server-final.json", 1, "bytes", 107),
                                       ("server-final.json", 6, "alpn", "h2"),
                                       ("server-before.json", 1, "receivedAuthHeader", True),
                                       ("server-final.json", 11, "cookieHeader", True)):
            with self.subTest(name=name, key=key), self.assertRaises(EvidenceError):
                self.evidence = reports()
                self.evidence[name]["requests"][index][key] = value
                self.check()

    def test_archived_ledger_and_expected_der_are_independent(self):
        with self.assertRaisesRegex(EvidenceError, "certificate"):
            self.check(certificate=b"other public certificate")
        self.evidence["ledger.json"]["reservedBytes"] -= 256
        with self.assertRaisesRegex(EvidenceError, "archived ledger"):
            self.check()

    def test_requires_retained_charge_and_fresh_reload_charge_in_native_snapshots(self):
        for index, bytes_reserved in ((0, 1024), (1, 1280)):
            with self.subTest(index=index), self.assertRaisesRegex(EvidenceError, "ledger"):
                self.evidence = reports()
                self.evidence["result.json"]["cases"][index]["native"]["ledger"]["reservedBytes"] = bytes_reserved
                self.check()

    def test_rejects_unsettled_native_requests_and_non_https_counters(self):
        for key, value in (("active", 1), ("released", 11), ("tlsVerifiedExchanges", 12),
                           ("transport", "single-send-http1-fixture"), ("cancelledActive", 3),
                           ("pending", 1)):
            with self.subTest(key=key), self.assertRaises(EvidenceError):
                self.evidence = reports()
                self.evidence["result.json"]["cases"][1]["native"][key] = value
                self.check()

    def test_native_body_bytes_must_match_finished_server_bodies(self):
        result = self.evidence["result.json"]
        result["cases"][1]["native"]["acceptedBodyBytes"] += 1
        result["nativeAtFinish"]["acceptedBodyBytes"] += 1
        with self.assertRaisesRegex(EvidenceError, "accepted body totals"):
            self.check()

    def test_requires_sdk_empty_style_and_reloaded_render(self):
        cases = self.evidence["result.json"]["cases"]
        cases[0]["emptyStyleEvidence"]["nativeSourceIDs"].append("t")
        with self.assertRaisesRegex(EvidenceError, "synthetic raster"):
            self.check()
        self.evidence = reports()
        self.evidence["result.json"]["cases"][1]["fullyRendered"] = 1
        with self.assertRaisesRegex(EvidenceError, "reload case"):
            self.check()

    def test_cli_verifies_saved_folder_and_refuses_duplicate_json_keys(self):
        self.write()
        path = self.folder / "leaf.der"
        path.write_bytes(CERTIFICATE)
        cmd = [sys.executable, str(Path(__file__).with_name("tls_cancel_result.py")),
               str(self.folder), "--origin", ORIGIN, "--certificate", str(path)]
        result = subprocess.run(cmd, text=True, capture_output=True, check=True, timeout=5)
        self.assertTrue(json.loads(result.stdout)["validated"])
        (self.folder / "release.json").write_text(
            '{"heldReleased":false,"heldReleased":true,"releasedOpenBodies":0}', encoding="utf-8")
        result = subprocess.run(cmd, text=True, capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 1)
        self.assertIn("duplicate evidence keys", result.stderr)
