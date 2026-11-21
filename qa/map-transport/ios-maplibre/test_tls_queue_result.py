"""Synthetic saved-report regressions; these are not native or device cases."""

import base64
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from tls_queue_result import EvidenceError, validate


CERTIFICATE = b"synthetic-public-certificate-byte-binding-only"
ORIGIN = "https://192.168.50.2:3091"


def reports():
    paths = ["/resource/style/multi"] + [f"/resource/tile/2_{x}_{y}"
                                             for x, y in ((0, 0), (0, 1), (1, 0),
                                                          (1, 1), (2, 0), (2, 1))]
    entries = [{"path": path, "bytes": 201 if index == 0 else 105,
                "bytesWritten": 201 if index == 0 else 105, "finished": True,
                "held": False, "closedBeforeFinish": False,
                "ua": "TripPaintingMapTransportQA/1.0", "receivedAuthHeader": False,
                "cookieHeader": False, "alpn": "http/1.1", "tlsProtocol": "TLSv1.3"}
               for index, path in enumerate(paths)]
    ledger = {"schema": 1, "origin": ORIGIN, "requests": 7, "tiles": 6,
              "reservedBytes": 1792, "unresolved": [], "maxRequests": 32,
              "maxTiles": 16, "maxReservedBytes": 8192, "reservationBytes": 256,
              "fixtureTLSLeafDER": base64.b64encode(CERTIFICATE).decode("ascii")}
    native = {"active": 0, "pending": 0, "maxActive": 4, "maxPending": 2,
              "cancelledActive": 0, "cancelledPending": 0, "released": 7,
              "started": 7, "blockedBeforeDispatch": 0, "httpRequestSendsSettled": 7,
              "receivedHTTPBytesSettled": 1600, "acceptedBodyBytes": 831,
              "tlsVerifiedExchanges": 7, "ledgerOK": True,
              "transport": "pinned-private-tls-http1-fixture", "ledger": deepcopy(ledger)}
    waiting = deepcopy(native)
    waiting.update(active=4, pending=2, started=5, released=1, httpRequestSendsSettled=1,
                   tlsVerifiedExchanges=1, receivedHTTPBytesSettled=350, acceptedBodyBytes=201)
    waiting["ledger"].update(requests=5, tiles=4, reservedBytes=1280,
                             unresolved=["tile-a", "tile-b", "tile-c", "tile-d"])
    result = {"complete": True, "pass": True, "stage": "tls-queue", "trialPhase": 2,
              "process": 1234, "delegatePreserved": True,
              "delegateClass": "MLRNTransformRequest", "transforms": 7,
              "rewrittenStyles": 1, "externalTileRequests": 0,
              "nativeAtFinish": deepcopy(native),
              "cases": [{"name": "SDK pinned HTTPS fifth request waits", "pass": True,
                         "styleLoaded": True, "fullyRendered": True, "native": native,
                         "waitingSnapshot": waiting}]}
    server = {"active": 0, "maxActive": 4, "heldActive": 0, "heldReleased": False,
              "resourceCount": 7, "requests": entries, "origin": ORIGIN}
    return result, server, ledger


class TLSQueueResultTests(unittest.TestCase):
    def setUp(self):
        self.result, self.server, self.ledger = reports()
        self.certificate, self.origin, self.pid = CERTIFICATE, ORIGIN, 1234

    def check(self):
        return validate(self.result, self.server, self.ledger,
                        self.certificate, self.origin, self.pid)

    @property
    def native(self):
        return self.result["cases"][0]["native"]

    @property
    def waiting(self):
        return self.result["cases"][0]["waitingSnapshot"]

    def sync(self):
        self.result["nativeAtFinish"] = deepcopy(self.native)
        self.ledger = deepcopy(self.native["ledger"])

    def test_consistent_evidence_and_separate_peak_waiting_summary(self):
        value = self.check()
        self.assertEqual({key: value[key] for key in ("cases", "resources", "verifiedHTTPSExchanges",
                         "acceptedBodyBytes", "nativeMaxActive", "serverMaxActive", "waitingActive",
                         "waitingPending")}, {"cases": 1, "resources": 7, "verifiedHTTPSExchanges": 7,
                         "acceptedBodyBytes": 831, "nativeMaxActive": 4, "serverMaxActive": 4,
                         "waitingActive": 4, "waitingPending": 2})
        self.assertIn("not simultaneous TLS-socket count", value["scope"])
        self.assertIn("OS-byte acceptance", value["scope"])

    def test_one_pending_request_and_mixed_accepted_tls_versions_valid(self):
        self.waiting.update(pending=1, maxPending=1)
        self.native["maxPending"] = 1
        self.server["requests"][0]["tlsProtocol"] = "TLSv1.2"
        self.sync()
        self.assertTrue(self.check()["validated"])

    def test_delegate_accepts_only_true_or_exact_integer_one(self):
        for value in (True, 1):
            self.result["delegatePreserved"] = value
            self.assertTrue(self.check()["validated"])
        for value in (False, 0, 2, 1.0, "1", None):
            with self.subTest(value=value), self.assertRaises(EvidenceError):
                self.result["delegatePreserved"] = value
                self.check()

    def test_wrong_pid_stage_phase_completion_and_delegate_rejected(self):
        for key, value in (("process", 12), ("process", True), ("stage", "tls-render"),
                           ("trialPhase", 1), ("trialPhase", True), ("trialPhase", 2.0),
                           ("pass", 1), ("complete", 1), ("complete", False),
                           ("delegateClass", "QASentinel")):
            with self.subTest(key=key, value=value):
                self.setUp()
                self.result[key] = value
                with self.assertRaises(EvidenceError):
                    self.check()
        for pid in (None, True, 0, -1, 1234.0, "1234"):
            with self.subTest(pid=pid):
                self.setUp()
                self.pid = pid
                with self.assertRaises(EvidenceError):
                    self.check()

    def test_exact_case_and_actual_render_observations_required(self):
        for key, value in (("name", "SDK pinned HTTPS raster render"), ("pass", 1),
                           ("styleLoaded", False), ("styleLoaded", 1), ("fullyRendered", 1)):
            with self.subTest(key=key, value=value):
                self.setUp()
                self.result["cases"][0][key] = value
                with self.assertRaises(EvidenceError):
                    self.check()
        for cases in ([], [deepcopy(self.result["cases"][0])] * 2, None, [None]):
            with self.subTest(cases=cases):
                self.setUp()
                self.result["cases"] = cases
                with self.assertRaises(EvidenceError):
                    self.check()

    def test_transform_observations_required(self):
        for key, value in (("transforms", 6), ("transforms", True), ("rewrittenStyles", 0),
                           ("externalTileRequests", 1), ("externalTileRequests", False)):
            with self.subTest(key=key):
                self.setUp()
                self.result[key] = value
                with self.assertRaises(EvidenceError):
                    self.check()

    def test_missing_or_idle_waiting_snapshot_cannot_be_replaced_by_peak(self):
        for waiting in (None, {}, deepcopy(self.native)):
            with self.subTest(waiting=waiting):
                self.setUp()
                self.result["cases"][0]["waitingSnapshot"] = waiting
                with self.assertRaises(EvidenceError):
                    self.check()
        self.setUp()
        del self.result["cases"][0]["waitingSnapshot"]
        with self.assertRaises(EvidenceError):
            self.check()

    def test_waiting_exact_permits_settled_exchange_and_pending_peak(self):
        for key, value in (("active", 3), ("pending", 0), ("maxActive", 3), ("maxActive", 5),
                           ("maxPending", 1), ("started", 6), ("released", 0),
                           ("httpRequestSendsSettled", 2), ("tlsVerifiedExchanges", 0),
                           ("acceptedBodyBytes", 0), ("receivedHTTPBytesSettled", 200)):
            with self.subTest(key=key):
                self.setUp()
                self.waiting[key] = value
                with self.assertRaises(EvidenceError):
                    self.check()

    def test_final_exact_exchanges_and_idle_counts_required(self):
        for key, value in (("active", 1), ("pending", 1), ("maxActive", 3), ("maxActive", 5),
                           ("maxPending", 0), ("maxPending", 3), ("started", 8), ("released", 6),
                           ("httpRequestSendsSettled", 6), ("tlsVerifiedExchanges", 6)):
            with self.subTest(key=key):
                self.setUp()
                self.native[key] = value
                self.sync()
                with self.assertRaises(EvidenceError):
                    self.check()

    def test_waiting_cannot_claim_more_than_two_remaining_tile_requests(self):
        for pending in (3, 7):
            with self.subTest(pending=pending):
                self.setUp()
                self.waiting.update(pending=pending, maxPending=pending)
                with self.assertRaises(EvidenceError):
                    self.check()

    def test_waiting_settled_body_must_equal_the_only_completed_style(self):
        for body in (200, 202):
            with self.subTest(body=body):
                self.setUp()
                self.waiting["acceptedBodyBytes"] = body
                with self.assertRaises(EvidenceError):
                    self.check()

    def test_no_cancel_blocked_or_unverified_transport_in_either_snapshot(self):
        for side in ("native", "waiting"):
            for key, value in (("cancelledActive", 1), ("cancelledPending", 1),
                               ("blockedBeforeDispatch", 1), ("ledgerOK", 1),
                               ("transport", "single-send-http1-fixture")):
                with self.subTest(side=side, key=key):
                    self.setUp()
                    getattr(self, side)[key] = value
                    self.sync()
                    with self.assertRaises(EvidenceError):
                        self.check()

    def test_native_counters_require_unsigned_integers_in_both_snapshots(self):
        keys = ("active", "pending", "maxActive", "maxPending", "cancelledActive",
                "cancelledPending", "released", "started", "blockedBeforeDispatch",
                "httpRequestSendsSettled", "receivedHTTPBytesSettled", "acceptedBodyBytes",
                "tlsVerifiedExchanges")
        for side in ("native", "waiting"):
            for key in keys:
                for value in (True, 1.0, -1, "2", None):
                    with self.subTest(side=side, key=key, value=value):
                        self.setUp()
                        getattr(self, side)[key] = value
                        self.sync()
                        with self.assertRaises(EvidenceError):
                            self.check()

    def test_final_snapshot_and_archived_ledger_equality_are_type_strict(self):
        self.result["nativeAtFinish"]["maxPending"] = 2.0
        with self.assertRaises(EvidenceError):
            self.check()
        self.setUp()
        self.ledger["schema"] = True
        with self.assertRaises(EvidenceError):
            self.check()
        self.setUp()
        del self.ledger["fixtureTLSLeafDER"]
        with self.assertRaises(EvidenceError):
            self.check()

    def test_ledger_counts_limits_and_reservation_exact_in_both_snapshots(self):
        for side in ("native", "waiting"):
            for key in ("schema", "requests", "tiles", "reservedBytes", "maxRequests",
                        "maxTiles", "maxReservedBytes", "reservationBytes"):
                for value in (True, 1.0, -1, "1", None, 999):
                    with self.subTest(side=side, key=key, value=value):
                        self.setUp()
                        getattr(self, side)["ledger"][key] = value
                        self.sync()
                        with self.assertRaises(EvidenceError):
                            self.check()

    def test_waiting_unresolved_requires_four_unique_nonempty_strings(self):
        for unresolved in (None, [], ["a", "b", "c"], ["a", "b", "c", "d", "e"],
                           ["a", "b", "c", "c"], ["a", "b", "c", ""],
                           ["a", "b", "c", 1], {"a": 1}, ["a", "b", "c", []]):
            with self.subTest(unresolved=unresolved):
                self.setUp()
                self.waiting["ledger"]["unresolved"] = unresolved
                with self.assertRaises(EvidenceError):
                    self.check()
        self.setUp()
        self.native["ledger"]["unresolved"] = ["retained"]
        self.sync()
        with self.assertRaises(EvidenceError):
            self.check()

    def test_ledger_identity_cannot_change_while_queued(self):
        self.native["ledger"]["extraIdentity"] = True
        self.waiting["ledger"]["extraIdentity"] = 1
        self.sync()
        with self.assertRaises(EvidenceError):
            self.check()
        self.setUp()
        self.waiting["ledger"]["extraIdentity"] = "waiting-only"
        with self.assertRaises(EvidenceError):
            self.check()

    def test_cumulative_native_counts_cannot_decrease(self):
        for key, value in (("maxPending", 3), ("acceptedBodyBytes", 832),
                           ("receivedHTTPBytesSettled", 1601)):
            with self.subTest(key=key):
                self.setUp()
                self.waiting[key] = value
                if key == "acceptedBodyBytes":
                    self.waiting["receivedHTTPBytesSettled"] = value
                with self.assertRaises(EvidenceError):
                    self.check()

    def test_exact_public_certificate_binding_canonical_base64_and_size(self):
        encoded = base64.b64encode(CERTIFICATE).decode("ascii")
        for side in ("native", "waiting"):
            for value in ("", encoded + "\n", encoded + "=", "??", 1,
                          base64.b64encode(b"other").decode("ascii")):
                with self.subTest(side=side, value=value):
                    self.setUp()
                    getattr(self, side)["ledger"]["fixtureTLSLeafDER"] = value
                    self.sync()
                    with self.assertRaises(EvidenceError):
                        self.check()
        for expected in (b"", b"x" * 16385, bytearray(CERTIFICATE)):
            with self.subTest(size=len(expected)):
                self.setUp()
                self.certificate = expected
                with self.assertRaises(EvidenceError):
                    self.check()

    def test_expected_origin_requires_exact_private_ipv4_https_and_port(self):
        for origin in ("https://example.invalid:443", "https://8.8.8.8:443",
                       "https://169.254.1.1:443", "https://127.0.0.2:443", "https://[::1]:443",
                       "http://192.168.50.2:3091", ORIGIN + "/", ORIGIN + "?", ORIGIN + "#",
                       ORIGIN + "/path", "https://user@192.168.50.2:3091",
                       "https://192.168.50.2", "https://192.168.050.2:3091",
                       "https://192.168.50.2:03091", "HTTPS://192.168.50.2:3091",
                       "https://192.168.50.2:0"):
            with self.subTest(origin=origin):
                self.setUp()
                self.origin = origin
                self.native["ledger"]["origin"] = self.waiting["ledger"]["origin"] = origin
                self.server["origin"] = origin
                self.sync()
                with self.assertRaises(EvidenceError):
                    self.check()

    def test_origin_mismatch_rejected_in_either_ledger_and_server(self):
        for side in ("native", "waiting", "server"):
            with self.subTest(side=side):
                self.setUp()
                target = self.server if side == "server" else getattr(self, side)["ledger"]
                target["origin"] = "https://192.168.50.3:3091"
                self.sync()
                with self.assertRaises(EvidenceError):
                    self.check()

    def test_exact_unique_zoom_two_tile_paths_after_multi_style(self):
        for path in ("/resource/tile/0_0_0", "/resource/tile/2_4_0", "/resource/tile/2_0_4",
                     "/resource/tile/2_00_0", "/resource/tile/2_0_0?x=1", "/resource/tile/2_0_0\n",
                     "/resource/style/multi", "/resource/tile/h_2_0_0", None, 1):
            with self.subTest(path=path):
                self.setUp()
                self.server["requests"][-1]["path"] = path
                with self.assertRaises(EvidenceError):
                    self.check()
        for change in ("style-after-tile", "wrong-style", "duplicate-tile", "extra", "missing"):
            with self.subTest(change=change):
                self.setUp()
                entries = self.server["requests"]
                if change == "style-after-tile":
                    entries[0], entries[1] = entries[1], entries[0]
                elif change == "wrong-style":
                    entries[0]["path"] = "/resource/style/sdk"
                elif change == "duplicate-tile":
                    entries[-1]["path"] = entries[1]["path"]
                elif change == "extra":
                    entries.append(deepcopy(entries[-1]))
                    self.server["resourceCount"] = 8
                else:
                    entries.pop()
                    self.server["resourceCount"] = 6
                with self.assertRaises(EvidenceError):
                    self.check()

    def test_tile_arrival_order_is_not_assumed(self):
        self.server["requests"][1:] = reversed(self.server["requests"][1:])
        self.assertTrue(self.check()["validated"])

    def test_every_resource_requires_finished_unheld_uncancelled_lifecycle(self):
        for index in range(7):
            for key, value in (("finished", False), ("finished", 1), ("held", True),
                               ("held", 0), ("closedBeforeFinish", True), ("closedBeforeFinish", 0)):
                with self.subTest(index=index, key=key, value=value):
                    self.setUp()
                    self.server["requests"][index][key] = value
                    with self.assertRaises(EvidenceError):
                        self.check()

    def test_server_headers_and_complete_bounded_integer_body_required(self):
        for key, value in (("ua", "other"), ("receivedAuthHeader", True), ("receivedAuthHeader", 0),
                           ("cookieHeader", True), ("bytesWritten", 104), ("bytes", 257),
                           ("bytes", 0), ("bytes", True), ("bytesWritten", 105.0)):
            with self.subTest(key=key, value=value):
                self.setUp()
                self.server["requests"][-1][key] = value
                with self.assertRaises(EvidenceError):
                    self.check()

    def test_tls_protocol_and_alpn_required_for_every_resource(self):
        for index in range(7):
            for key, value in (("alpn", "h2"), ("alpn", ""), ("alpn", None),
                               ("tlsProtocol", "TLSv1"), ("tlsProtocol", "TLSv1.1"),
                               ("tlsProtocol", "TLSv1.4"), ("tlsProtocol", None)):
                with self.subTest(index=index, key=key, value=value):
                    self.setUp()
                    self.server["requests"][index][key] = value
                    with self.assertRaises(EvidenceError):
                        self.check()
            for key in ("alpn", "tlsProtocol"):
                with self.subTest(index=index, missing=key):
                    self.setUp()
                    del self.server["requests"][index][key]
                    with self.assertRaises(EvidenceError):
                        self.check()

    def test_native_server_body_totals_cross_checked(self):
        for key, value in (("acceptedBodyBytes", 830), ("acceptedBodyBytes", 832),
                           ("receivedHTTPBytesSettled", 830)):
            with self.subTest(key=key):
                self.setUp()
                self.native[key] = value
                self.sync()
                with self.assertRaises(EvidenceError):
                    self.check()

    def test_server_exact_peak_final_idle_and_counter_types(self):
        for key, value in (("active", 1), ("maxActive", 3), ("maxActive", 5), ("heldActive", 1),
                           ("resourceCount", 8), ("heldReleased", True), ("heldReleased", 0)):
            with self.subTest(key=key, value=value):
                self.setUp()
                self.server[key] = value
                with self.assertRaises(EvidenceError):
                    self.check()
        for key in ("active", "maxActive", "heldActive", "resourceCount"):
            for value in (True, 4.0, -1, "4", None):
                with self.subTest(key=key, value=value):
                    self.setUp()
                    self.server[key] = value
                    with self.assertRaises(EvidenceError):
                        self.check()

    def test_malformed_documents_are_evidence_errors(self):
        for result, server, ledger in ((None, self.server, self.ledger),
                                      (self.result, [], self.ledger),
                                      (self.result, self.server, None)):
            with self.subTest(result=result is None), self.assertRaises(EvidenceError):
                validate(result, server, ledger, CERTIFICATE, ORIGIN, 1234)
        for side in ("native", "waiting"):
            with self.subTest(side=side):
                self.setUp()
                getattr(self, side)["ledger"]["nonJSON"] = float("nan")
                with self.assertRaises(EvidenceError):
                    self.check()

    def test_cli_accepts_saved_reports_and_rejects_malformed_evidence(self):
        with tempfile.TemporaryDirectory(prefix="tp-tls-queue-report-") as directory:
            root = Path(directory)
            paths = [root / name for name in ("result.json", "server.json", "ledger.json", "public.der")]
            for path, document in zip(paths[:3], (self.result, self.server, self.ledger)):
                path.write_text(json.dumps(document))
            paths[3].write_bytes(CERTIFICATE)
            command = [sys.executable, "-B", str(Path(__file__).with_name("tls_queue_result.py")),
                       str(paths[0]), str(paths[1]), "--ledger", str(paths[2]),
                       "--certificate", str(paths[3]), "--origin", ORIGIN, "--pid", "1234"]
            accepted = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertEqual(accepted.returncode, 0, accepted.stderr)
            self.assertEqual(json.loads(accepted.stdout)["resources"], 7)
            paths[0].write_text("{")
            rejected = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertEqual(rejected.returncode, 1)
            self.assertIn("Evidence rejected:", rejected.stderr)
            missing_flags = subprocess.run(command[:4], capture_output=True, text=True, check=False)
            self.assertEqual(missing_flags.returncode, 2)


if __name__ == "__main__":
    unittest.main()
