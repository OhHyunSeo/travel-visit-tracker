"""Synthetic report mutations exercise rejection; these are not native cases."""

from copy import deepcopy
import unittest

from cancel_result import EvidenceError, validate


def reports():
    def entry(path, held=False, finished=True):
        size = 100 if held else 220 if path.endswith("/held") else 36
        return {"path": path, "bytes": size, "bytesWritten": size if finished else 0,
                "finished": finished, "held": held, "closedBeforeFinish": False,
                "ua": "TripPaintingMapTransportQA/1.0", "receivedAuthHeader": False,
                "cookieHeader": False}

    def stats(entries, active, released):
        return {"active": active, "maxActive": 4 if not released else 5,
                "heldActive": active, "heldReleased": released,
                "resourceCount": len(entries), "requests": entries}

    def native(requests, tiles, active, pending, accepted, cancel=False):
        return {"active": active, "maxActive": 4, "pending": pending, "maxPending": 2,
                "cancelledActive": 4 if cancel else 0, "cancelledPending": 2 if cancel else 0,
                "released": requests - active, "started": requests, "blockedBeforeDispatch": 0,
                "httpRequestSendsSettled": requests - active,
                "receivedHTTPBytesSettled": accepted + (requests - active) * 120,
                "acceptedBodyBytes": accepted, "ledgerOK": True,
                "ledger": {"schema": 1, "origin": "http://127.0.0.1:3091", "requests": requests,
                           "tiles": tiles, "reservedBytes": requests * 256,
                           "unresolved": ["synthetic-" + str(i) for i in range(active)],
                           "maxRequests": 64, "maxTiles": 32, "maxReservedBytes": 16384,
                           "reservationBytes": 256}}

    old_paths = ["/resource/tile/h_2_1_1", "/resource/tile/h_2_1_2",
                 "/resource/tile/h_2_2_1", "/resource/tile/h_2_2_2"]
    waiting_entries = [entry("/resource/style/held")] + [entry(x, True, False) for x in old_paths]
    cancelled_entries = deepcopy(waiting_entries)
    for value in cancelled_entries[1:]:
        value["closedBeforeFinish"] = True
    suffix = [entry("/resource/style/held")] + [entry(x, True) for x in old_paths +
              ["/resource/tile/h_2_0_1", "/resource/tile/h_2_0_2"]]
    final_entries = deepcopy(cancelled_entries) + suffix
    waiting = native(5, 4, 4, 2, 220)
    cancelled = native(5, 4, 0, 0, 220, True)
    final = native(12, 10, 0, 0, 1040, True)
    server = stats(final_entries, 0, True)
    result = {"complete": True, "pass": True, "stage": "cancel-retry", "process": 1234,
              "cancellationTrigger": "local-style-json",
              "delegatePreserved": True, "delegateClass": "MLRNTransformRequest",
              "nativeAtFinish": deepcopy(final),
              "cases": [{"name": "cancellation", "pass": True, "native": cancelled,
                         "localEmptyStyleLoaded": True,
                         "emptyStyleEvidence": {"json": {"version": 8, "sources": {}, "layers": []},
                                                "nativeSourceIDs": ["synthetic-annotation"],
                                                "nativeLayerIDs": ["synthetic-annotation"],
                                                "noSyntheticRaster": True},
                         "waitingSnapshot": waiting, "waitingServer": stats(waiting_entries, 4, False),
                         "serverAfterCancel": stats(cancelled_entries, 0, False)},
                        {"name": "retry", "pass": True, "native": final,
                         "server": deepcopy(server), "beforeRetry": deepcopy(cancelled),
                         "releaseControl": {"heldReleased": True, "releasedOpenBodies": 0},
                         "styleLoaded": True, "fullyRendered": True}]}
    return result, server, deepcopy(final["ledger"])


class CancelResultTests(unittest.TestCase):
    def setUp(self):
        self.result, self.server, self.ledger = reports()

    def check(self):
        return validate(self.result, self.server, self.ledger, 1234)

    def sync_server(self):
        self.result["cases"][1]["server"] = deepcopy(self.server)

    def sync_final(self):
        self.result["nativeAtFinish"] = deepcopy(self.result["cases"][1]["native"])
        self.ledger = deepcopy(self.result["cases"][1]["native"]["ledger"])

    def test_consistent_evidence_and_distinct_server_lifetime_peak(self):
        value = self.check()
        self.assertEqual(value["nativeMaxActive"], 4)
        self.assertEqual(value["serverMaxActive"], 5)
        self.assertEqual(value["retryDistinctTiles"], 6)

    def test_objc_boxed_logical_delegate_flag_accepts_only_exact_true_or_one(self):
        self.result["delegatePreserved"] = 1
        self.assertTrue(self.check()["validated"])
        for value in (False, 0, 2, "1", 1.0, None):
            with self.subTest(value=value):
                self.result["delegatePreserved"] = value
                with self.assertRaisesRegex(EvidenceError, "delegate"):
                    self.check()

    def test_independent_server_or_archived_ledger_mismatch_rejected(self):
        self.server["resourceCount"] += 1
        with self.assertRaises(EvidenceError):
            self.check()
        self.result, self.server, self.ledger = reports()
        self.ledger["reservedBytes"] -= 256
        with self.assertRaises(EvidenceError):
            self.check()

    def test_render_callback_does_not_replace_same_path_network_evidence(self):
        self.server["requests"][7]["path"] = "/resource/tile/h_2_3_3"
        self.sync_server()
        with self.assertRaisesRegex(EvidenceError, "same old paths"):
            self.check()

    def test_coherent_charge_reset_still_rejected(self):
        final = self.result["cases"][1]["native"]
        final["started"] = final["released"] = 7
        final["ledger"].update(requests=7, tiles=6, reservedBytes=7 * 256)
        final["cancelledActive"] = final["cancelledPending"] = 0
        self.sync_final()
        with self.assertRaises(EvidenceError):
            self.check()

    def test_old_response_cannot_be_revived_after_release(self):
        self.server["requests"][1].update(finished=True, closedBeforeFinish=False, bytesWritten=100)
        self.sync_server()
        with self.assertRaisesRegex(EvidenceError, "prefix"):
            self.check()

    def test_missing_pending_cancellation_or_release_zero_rejected(self):
        for change in ("cancel", "release"):
            with self.subTest(change=change):
                self.result, self.server, self.ledger = reports()
                if change == "cancel":
                    self.result["cases"][0]["native"]["cancelledPending"] = 0
                    self.result["cases"][1]["beforeRetry"]["cancelledPending"] = 0
                else:
                    self.result["cases"][1]["releaseControl"]["releasedOpenBodies"] = 1
                with self.assertRaises(EvidenceError):
                    self.check()

    def test_pid_stage_and_delegate_are_verified(self):
        for key, value in (("process", 4321), ("stage", "queue"),
                           ("delegateClass", "QASentinel"), ("complete", False)):
            with self.subTest(key=key):
                self.result, self.server, self.ledger = reports()
                self.result[key] = value
                with self.assertRaises(EvidenceError):
                    self.check()

    def test_credentials_or_incomplete_payload_rejected(self):
        for change in ("auth", "payload"):
            with self.subTest(change=change):
                self.result, self.server, self.ledger = reports()
                if change == "auth":
                    self.server["requests"][-1]["receivedAuthHeader"] = True
                else:
                    self.server["requests"][-1]["bytesWritten"] -= 1
                self.sync_server()
                with self.assertRaises(EvidenceError):
                    self.check()

    def test_unresolved_permit_and_boolean_counter_rejected(self):
        for change in ("unresolved", "bool"):
            with self.subTest(change=change):
                self.result, self.server, self.ledger = reports()
                if change == "unresolved":
                    self.result["cases"][0]["waitingSnapshot"]["ledger"]["unresolved"].pop()
                else:
                    self.result["cases"][1]["native"]["released"] = True
                    self.sync_final()
                with self.assertRaises(EvidenceError):
                    self.check()

    def test_remote_style_trigger_or_missing_local_style_completion_rejected(self):
        for change in ("trigger", "remote", "completion"):
            with self.subTest(change=change):
                self.result, self.server, self.ledger = reports()
                if change == "trigger":
                    self.result["cancellationTrigger"] = "remote-style-url"
                elif change == "completion":
                    self.result["cases"][0]["localEmptyStyleLoaded"] = False
                else:
                    self.server["requests"][5]["path"] = "/resource/style/empty"
                    self.sync_server()
                with self.assertRaises(EvidenceError):
                    self.check()

    def test_missing_case_or_fewer_than_five_distinct_retry_tiles_rejected(self):
        self.result["cases"].pop()
        with self.assertRaises(EvidenceError):
            self.check()
        self.result, self.server, self.ledger = reports()
        self.server["requests"][-1]["path"] = self.server["requests"][-2]["path"] = self.server["requests"][7]["path"]
        self.sync_server()
        with self.assertRaisesRegex(EvidenceError, "same old paths"):
            self.check()

    def test_empty_json_and_absent_raster_required_with_sdk_owned_objects(self):
        for change in ("json", "source", "layer", "flag"):
            with self.subTest(change=change):
                self.result, self.server, self.ledger = reports()
                empty = self.result["cases"][0]["emptyStyleEvidence"]
                if change == "json":
                    empty["json"]["sources"]["t"] = {"type": "raster"}
                elif change == "flag":
                    empty["noSyntheticRaster"] = False
                else:
                    empty["nativeSourceIDs" if change == "source" else "nativeLayerIDs"].append("t")
                with self.assertRaisesRegex(EvidenceError, "empty JSON"):
                    self.check()


if __name__ == "__main__":
    unittest.main()
