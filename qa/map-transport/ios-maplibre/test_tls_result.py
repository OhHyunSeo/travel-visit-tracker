"""Synthetic saved-report regressions; these are not native/device cases."""

import base64
from copy import deepcopy
import unittest

from tls_result import EvidenceError, validate


CERTIFICATE = b"synthetic-public-certificate-byte-binding-only"
ORIGIN = "https://192.168.50.2:3091"


def reports():
    entries = [{"path": path, "bytes": size, "bytesWritten": size, "finished": True,
                "held": False, "closedBeforeFinish": False,
                "ua": "TripPaintingMapTransportQA/1.0", "receivedAuthHeader": False,
                "cookieHeader": False, "alpn": "http/1.1", "tlsProtocol": "TLSv1.3"}
               for path, size in (("/resource/style/sdk", 201), ("/resource/tile/0_0_0", 105))]
    ledger = {"schema": 1, "origin": ORIGIN, "requests": 2, "tiles": 1,
              "reservedBytes": 512, "unresolved": [], "maxRequests": 32,
              "maxTiles": 16, "maxReservedBytes": 8192, "reservationBytes": 256,
              "fixtureTLSLeafDER": base64.b64encode(CERTIFICATE).decode("ascii")}
    native = {"active": 0, "pending": 0, "maxActive": 1, "maxPending": 0,
              "cancelledActive": 0, "cancelledPending": 0, "released": 2,
              "started": 2, "blockedBeforeDispatch": 0, "httpRequestSendsSettled": 2,
              "receivedHTTPBytesSettled": 500, "acceptedBodyBytes": 306,
              "tlsVerifiedExchanges": 2, "ledgerOK": True,
              "transport": "pinned-private-tls-http1-fixture", "ledger": deepcopy(ledger)}
    result = {"complete": True, "pass": True, "stage": "tls-render", "trialPhase": 1,
              "process": 1234, "delegatePreserved": True,
              "delegateClass": "MLRNTransformRequest", "transforms": 2,
              "rewrittenStyles": 1, "externalTileRequests": 0,
              "nativeAtFinish": deepcopy(native),
              "cases": [{"name": "SDK pinned HTTPS raster render", "pass": True,
                         "styleLoaded": True, "fullyRendered": True, "native": native}]}
    server = {"active": 0, "maxActive": 1, "heldActive": 0, "heldReleased": False,
              "resourceCount": 2, "requests": entries, "origin": ORIGIN}
    return result, server, ledger


class TLSResultTests(unittest.TestCase):
    def setUp(self):
        self.result, self.server, self.ledger = reports()
        self.certificate, self.origin, self.pid = CERTIFICATE, ORIGIN, 1234

    def check(self):
        return validate(self.result, self.server, self.ledger,
                        self.certificate, self.origin, self.pid)

    @property
    def native(self):
        return self.result["cases"][0]["native"]

    def sync(self):
        self.result["nativeAtFinish"] = deepcopy(self.native)
        self.ledger = deepcopy(self.native["ledger"])

    def test_consistent_evidence_and_public_certificate_byte_binding(self):
        self.assertEqual(self.check()["acceptedBodyBytes"], 306)
        self.assertIn("not HTTP2", self.check()["scope"])

    def test_delegate_logical_accepts_only_bool_true_or_exact_integer_one(self):
        for value in (True, 1):
            self.result["delegatePreserved"] = value
            self.assertTrue(self.check()["validated"])
        for value in (False, 0, 2, 1.0, "1", None):
            with self.subTest(value=value), self.assertRaises(EvidenceError):
                self.result["delegatePreserved"] = value
                self.check()

    def test_wrong_pid_stage_phase_completion_and_delegate_rejected(self):
        for key, value in (("process", 12), ("stage", "queue"), ("trialPhase", 2),
                           ("trialPhase", True), ("pass", 1), ("complete", False),
                           ("delegateClass", "QASentinel")):
            with self.subTest(key=key, value=value):
                self.setUp()
                self.result[key] = value
                with self.assertRaises(EvidenceError):
                    self.check()

    def test_case_and_style_render_observations_required(self):
        for key, value in (("name", "raster"), ("pass", 1), ("styleLoaded", False),
                           ("fullyRendered", 1)):
            with self.subTest(key=key):
                self.setUp()
                self.result["cases"][0][key] = value
                with self.assertRaises(EvidenceError):
                    self.check()
        self.setUp()
        self.result["cases"].append(deepcopy(self.result["cases"][0]))
        with self.assertRaises(EvidenceError):
            self.check()

    def test_unverified_tls_and_extra_or_unsettled_requests_rejected(self):
        for key, value in (("tlsVerifiedExchanges", 1), ("started", 3), ("released", 1),
                           ("httpRequestSendsSettled", 3), ("pending", 1), ("active", 1),
                           ("maxActive", 5), ("cancelledActive", 1), ("blockedBeforeDispatch", 1),
                           ("transport", "single-send-http1-fixture"), ("ledgerOK", 1)):
            with self.subTest(key=key):
                self.setUp()
                self.native[key] = value
                self.sync()
                with self.assertRaises(EvidenceError):
                    self.check()

    def test_boolean_and_float_counters_are_not_integers(self):
        for key in ("maxActive", "acceptedBodyBytes", "receivedHTTPBytesSettled",
                    "tlsVerifiedExchanges", "released"):
            for value in (True, 1.0, -1, "2", None):
                with self.subTest(key=key, value=value):
                    self.setUp()
                    self.native[key] = value
                    self.sync()
                    with self.assertRaises(EvidenceError):
                        self.check()

    def test_native_snapshot_and_archived_ledger_equality_is_type_strict(self):
        self.result["nativeAtFinish"]["maxActive"] = True
        with self.assertRaises(EvidenceError):
            self.check()
        self.setUp()
        self.ledger["schema"] = True
        with self.assertRaises(EvidenceError):
            self.check()

    def test_charge_limits_schema_tiles_and_unresolved_work_exact(self):
        for key, value in (("schema", True), ("requests", 1), ("tiles", 2),
                           ("reservedBytes", 256), ("maxRequests", 64),
                           ("maxTiles", 32), ("maxReservedBytes", 16384),
                           ("reservationBytes", 128), ("unresolved", ["leftover"])):
            with self.subTest(key=key):
                self.setUp()
                self.native["ledger"][key] = value
                self.sync()
                with self.assertRaises(EvidenceError):
                    self.check()

    def test_certificate_mismatch_noncanonical_base64_and_size_rejected(self):
        encoded = base64.b64encode(CERTIFICATE).decode("ascii")
        for value in ("", encoded + "\n", encoded + "=", "??", 1,
                      base64.b64encode(b"other").decode("ascii")):
            with self.subTest(value=value):
                self.setUp()
                self.native["ledger"]["fixtureTLSLeafDER"] = value
                self.sync()
                with self.assertRaises(EvidenceError):
                    self.check()
        for expected in (b"", b"x" * 16385, bytearray(CERTIFICATE)):
            with self.subTest(size=len(expected)):
                self.setUp()
                self.certificate = expected
                with self.assertRaises(EvidenceError):
                    self.check()

    def test_origin_requires_exact_canonical_private_ipv4_and_explicit_port(self):
        for origin in ("https://example.invalid:443", "https://8.8.8.8:443",
                       "https://169.254.1.1:443", "https://127.0.0.2:443",
                       "https://[::1]:443", "http://192.168.50.2:3091",
                       ORIGIN + "/", ORIGIN + "?", ORIGIN + "#", ORIGIN + "/path",
                       "https://user@192.168.50.2:3091", "https://192.168.50.2",
                       "https://192.168.050.2:3091", "https://192.168.50.2:03091",
                       "HTTPS://192.168.50.2:3091", "https://192.168.50.2:0"):
            with self.subTest(origin=origin):
                self.setUp()
                self.origin = self.native["ledger"]["origin"] = origin
                self.server["origin"] = origin
                self.sync()
                with self.assertRaises(EvidenceError):
                    self.check()

    def test_origin_mismatch_and_missing_expected_pid_rejected(self):
        self.server["origin"] = "https://192.168.50.3:3091"
        with self.assertRaises(EvidenceError):
            self.check()
        self.setUp()
        self.native["ledger"]["origin"] = "https://192.168.50.3:3091"
        self.sync()
        with self.assertRaises(EvidenceError):
            self.check()
        self.setUp()
        self.pid = None
        with self.assertRaises(EvidenceError):
            self.check()

    def test_server_paths_order_extra_requests_and_lifecycle_exact(self):
        for change in ("order", "extra", "held", "unfinished", "closed", "wrong-path"):
            with self.subTest(change=change):
                self.setUp()
                if change == "order":
                    self.server["requests"].reverse()
                elif change == "extra":
                    self.server["requests"].append(deepcopy(self.server["requests"][-1]))
                    self.server["resourceCount"] = 3
                elif change == "wrong-path":
                    self.server["requests"][-1]["path"] = "/resource/tile/1_0_0"
                else:
                    self.server["requests"][-1][{"held": "held", "unfinished": "finished",
                                                 "closed": "closedBeforeFinish"}[change]] = change != "unfinished"
                with self.assertRaises(EvidenceError):
                    self.check()

    def test_server_headers_incomplete_oversized_and_boolean_sizes_rejected(self):
        for key, value in (("ua", "other"), ("receivedAuthHeader", True), ("cookieHeader", True),
                           ("bytesWritten", 104), ("bytes", 257), ("bytes", True),
                           ("finished", 1), ("closedBeforeFinish", 0)):
            with self.subTest(key=key):
                self.setUp()
                self.server["requests"][-1][key] = value
                with self.assertRaises(EvidenceError):
                    self.check()

    def test_server_and_native_body_totals_cross_checked(self):
        self.native["acceptedBodyBytes"] = 305
        self.sync()
        with self.assertRaises(EvidenceError):
            self.check()
        self.setUp()
        self.native["receivedHTTPBytesSettled"] = 305
        self.sync()
        with self.assertRaises(EvidenceError):
            self.check()

    def test_server_tls_and_alpn_evidence_required_per_resource(self):
        for field, value in (("alpn", "h2"), ("alpn", ""), ("alpn", None),
                             ("tlsProtocol", "TLSv1"), ("tlsProtocol", "TLSv1.1"),
                             ("tlsProtocol", "TLSv1.4"), ("tlsProtocol", None)):
            for index in (0, 1):
                with self.subTest(field=field, value=value, index=index):
                    self.setUp()
                    self.server["requests"][index][field] = value
                    with self.assertRaises(EvidenceError):
                        self.check()
        for field in ("alpn", "tlsProtocol"):
            with self.subTest(missing=field):
                self.setUp()
                del self.server["requests"][0][field]
                with self.assertRaises(EvidenceError):
                    self.check()
        self.setUp()
        self.server["requests"][0]["tlsProtocol"] = "TLSv1.2"
        self.assertTrue(self.check()["validated"])

    def test_server_counters_idle_and_types_checked(self):
        for key, value in (("active", 1), ("maxActive", 5), ("heldActive", 1),
                           ("resourceCount", 3), ("heldReleased", 0), ("maxActive", True)):
            with self.subTest(key=key):
                self.setUp()
                self.server[key] = value
                with self.assertRaises(EvidenceError):
                    self.check()

    def test_transform_observations_cannot_be_replaced_by_render_flag(self):
        for key, value in (("transforms", 1), ("rewrittenStyles", 0),
                           ("externalTileRequests", 1), ("rewrittenStyles", True)):
            with self.subTest(key=key):
                self.setUp()
                self.result[key] = value
                with self.assertRaises(EvidenceError):
                    self.check()

    def test_malformed_documents_raise_evidence_error(self):
        for result, server, ledger in ((None, self.server, self.ledger),
                                      (self.result, [], self.ledger),
                                      (self.result, self.server, None)):
            with self.subTest(result=result is None), self.assertRaises(EvidenceError):
                validate(result, server, ledger, CERTIFICATE, ORIGIN, 1234)


if __name__ == "__main__":
    unittest.main()
