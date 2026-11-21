"""Host-only regressions for the two RN initial-style evidence modes."""

import base64
from copy import deepcopy
import unittest

from rn_evidence import verify, verify_pack_recovery, verify_pack_reopen
from tls_result import EvidenceError


ORIGIN = "https://192.168.1.2:4000"
CERTIFICATE = b"synthetic-public-leaf"
PATHS = ["/resource/style/sdk", "/resource/tile/0_0_0", "/resource/style/empty"]


def evidence(mode="local-empty"):
    blocked = int(mode == "sdk-default")
    ledger = {"schema": 1, "origin": ORIGIN, "requests": 3, "tiles": 1,
              "reservedBytes": 768, "maxRequests": 8, "maxTiles": 4,
              "maxReservedBytes": 2048, "reservationBytes": 256, "unresolved": [],
              "fixtureTLSLeafDER": base64.b64encode(CERTIFICATE).decode()}
    native = {"transport": "pinned-private-tls-http1-fixture", "ledgerOK": True,
              "active": 0, "pending": 0, "cancelledActive": 0, "cancelledPending": 0,
              "blockedBeforeDispatch": blocked, "started": 3, "released": 3,
              "httpRequestSendsSettled": 3, "tlsVerifiedExchanges": 3,
              "acceptedBodyBytes": 6, "ledger": ledger}
    observed = [{"fixtureOrigin": True, "resource": path, "sdkDefaultStyle": False,
                 "get": True, "query": 0, "fragment": 0} for path in PATHS]
    if blocked:
        observed.insert(0, {"fixtureOrigin": False, "resource": "other", "sdkDefaultStyle": True,
                            "get": True, "query": 0, "fragment": 0})
    result = {"complete": True, "pass": True, "delegatePreserved": True,
              "runID": "synthetic-run", "process": 1234, "native": native,
              "rnSchema": 2, "initialStyleMode": mode, "localBootstrap": not blocked,
              "renderConfirmedAfterTile": True, "observedRequests": observed}
    server = {"active": 0, "heldActive": 0, "heldReleased": False, "resourceCount": 3,
              "requests": [{"path": path, "bytes": 2, "bytesWritten": 2, "finished": True,
                            "closedBeforeFinish": False, "held": False, "receivedAuthHeader": False,
                            "cookieHeader": False, "ua": "TripPaintingMapTransportQA/1.0",
                            "alpn": "http/1.1", "tlsProtocol": "TLSv1.3"} for path in PATHS]}
    return result, deepcopy(ledger), server


def check(values, mode):
    return verify(*values, ORIGIN, CERTIFICATE, "synthetic-run", 1234,
                  runtime="synthetic-host", initial_style=mode)


class InitialStyleEvidenceTests(unittest.TestCase):
    def test_local_bootstrap_requires_only_the_three_fixture_resources(self):
        self.assertEqual(check(evidence(), "local-empty")["blockedSdkDefaultStyle"], 0)

    def test_missing_resource_uses_the_local_request_boundary(self):
        self.assertEqual(check(evidence("local-missing"), "local-missing")["blockedSdkDefaultStyle"], 0)
        with self.assertRaises(EvidenceError):
            check(evidence("local-missing"), "local-empty")

    def test_baseline_identifies_the_single_blocked_default_style(self):
        self.assertEqual(check(evidence("sdk-default"), "sdk-default")["blockedSdkDefaultStyle"], 1)

    def test_mode_cannot_be_relabelled(self):
        for actual, requested in (("sdk-default", "local-empty"), ("local-empty", "sdk-default")):
            with self.subTest(actual=actual), self.assertRaises(EvidenceError):
                check(evidence(actual), requested)

    def test_unidentified_external_request_is_rejected(self):
        values = evidence("sdk-default")
        values[0]["observedRequests"][0]["sdkDefaultStyle"] = False
        with self.assertRaises(EvidenceError):
            check(values, "sdk-default")

    def test_missing_initialization_or_render_proof_is_rejected(self):
        for field in ("rnSchema", "localBootstrap", "renderConfirmedAfterTile", "initialStyleMode"):
            values = evidence()
            del values[0][field]
            with self.subTest(field=field), self.assertRaises(EvidenceError):
                check(values, "local-empty")

    def test_boolean_schema_and_render_flags_cannot_substitute_for_the_expected_types(self):
        for field, value in (("rnSchema", True), ("localBootstrap", 1), ("renderConfirmedAfterTile", 1)):
            values = evidence()
            values[0][field] = value
            with self.subTest(field=field), self.assertRaises(EvidenceError):
                check(values, "local-empty")

    def test_extra_or_misidentified_fixture_request_is_rejected(self):
        for change in ("extra", "path", "origin", "default", "query", "method"):
            values = evidence()
            request = values[0]["observedRequests"][1]
            if change == "extra":
                values[0]["observedRequests"].append(deepcopy(request))
            else:
                key, value = {"path": ("resource", "/resource/style/rn-entry"),
                              "origin": ("fixtureOrigin", False), "default": ("sdkDefaultStyle", True),
                              "query": ("query", 1), "method": ("get", False)}[change]
                request[key] = value
            with self.subTest(change=change), self.assertRaises(EvidenceError):
                check(values, "local-empty")

    def test_unreported_native_block_is_rejected(self):
        values = evidence()
        values[0]["native"]["blockedBeforeDispatch"] = 1
        with self.assertRaises(EvidenceError):
            check(values, "local-empty")

    def test_recorded_server_bytes_and_process_must_match(self):
        for change in ("body", "process", "certificate", "ledger"):
            values = evidence()
            if change == "body":
                values[2]["requests"][0]["bytesWritten"] = 1
            elif change == "process":
                values[0]["process"] = 1235
            elif change == "certificate":
                values[1]["fixtureTLSLeafDER"] = base64.b64encode(b"other-leaf").decode()
                values[0]["native"]["ledger"] = deepcopy(values[1])
            else:
                values[1]["reservedBytes"] = 512
            with self.subTest(change=change), self.assertRaises(EvidenceError):
                check(values, "local-empty")

    def test_legacy_saved_simulator_evidence_remains_readable(self):
        values = evidence()
        for field in ("rnSchema", "initialStyleMode", "localBootstrap", "renderConfirmedAfterTile", "observedRequests"):
            del values[0][field]
        self.assertTrue(check(values, None)["validated"])


class PackRecoveryEvidenceTests(unittest.TestCase):
    def evidence(self):
        result, ledger, server = evidence()
        ledger.update(requests=2, reservedBytes=512)
        native = result["native"]
        native.update(ledger=deepcopy(ledger), started=2, released=2, httpRequestSendsSettled=2,
                      tlsVerifiedExchanges=2, acceptedBodyBytes=4)
        paths = ["/resource/style/pack-recovery", "/resource/tile/pack_8_219_98"]
        result["observedRequests"] = [{"resource": path} for path in paths]
        server.update(resourceCount=2, requests=server["requests"][:2])
        for item, path in zip(server["requests"], paths):
            item["path"] = path
        recovery = {"pass": True, "states": ["idle", "awaiting-pack", "incomplete", "complete"],
                    "createdPackId": "test-pack", "savedPackId": "test-pack",
                    "status": {"kind": "complete", "packId": "test-pack",
                               "completedResourceCount": 2, "requiredResourceCount": 2,
                               "completedTileCount": 1}}
        return result, recovery, ledger, server

    def verify_case(self, values):
        return verify_pack_recovery(*values, ORIGIN, CERTIFICATE, "synthetic-run", 1234,
                                    runtime="synthetic-host")

    def test_requires_discovery_and_persistence_of_the_created_pack(self):
        self.assertTrue(self.verify_case(self.evidence())["samePackPersisted"])
        for patch in ({"savedPackId": "different"}, {"states": ["idle", "complete"]}):
            values = self.evidence()
            values[1].update(patch)
            with self.subTest(patch=patch), self.assertRaises(EvidenceError):
                self.verify_case(values)

    def test_requires_the_exact_style_and_tile_requests(self):
        values = self.evidence()
        values[3]["requests"][1]["path"] = "/resource/tile/0_0_0"
        with self.assertRaises(EvidenceError):
            self.verify_case(values)

    def test_reopen_requires_the_same_completion_in_a_new_process_without_requests(self):
        result, previous, ledger, _ = self.evidence()
        reopened = {"pass": True, "states": ["complete"], "savedPackId": previous["savedPackId"],
                    "status": deepcopy(previous["status"])}
        ledger.update(requests=0, tiles=0, reservedBytes=0)
        result.update(process=1235, observedRequests=[])
        result["native"].update(ledger=deepcopy(ledger), started=0, released=0, httpRequestSendsSettled=0,
                                tlsVerifiedExchanges=0, acceptedBodyBytes=0)
        def verify_reopen():
            return verify_pack_reopen(result, reopened, ledger, ORIGIN, CERTIFICATE,
                                      "synthetic-run", result["process"], 1234, previous)
        self.assertTrue(verify_reopen()["newProcess"])
        for target, key, unrelated in ((result, "process", 1234), (reopened, "savedPackId", "other"),
                                       (result["native"], "started", 1), (ledger, "reservedBytes", 256)):
            before = target[key]
            target[key] = unrelated
            with self.subTest(key=key), self.assertRaises(EvidenceError):
                verify_reopen()
            target[key] = before


if __name__ == "__main__":
    unittest.main()
