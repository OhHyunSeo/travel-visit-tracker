"""Synthetic reports for the checks that guard the SDK policy conclusion."""

import base64
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from tls_policy_capture import EMPTY, SOURCE_EMPTY, verify
from tls_result import EvidenceError


ORIGIN = "https://127.0.0.1:3000"
TARGET = "https://127.0.0.1:3001"
LEAF = b"test-only fixture certificate bytes"


def evidence(reissues=0):
    requests = []
    for index in range(2 + reissues):
        path, status, size = ("/resource/style/mixed", 200, 467) if index == 0 else ("/resource/tile/m_2_0_0", 302, 0)
        requests.append({"path": path, "status": status, "bytes": size, "bytesWritten": size,
                         "held": False, "finished": True, "closedBeforeFinish": False,
                         "ua": "TripPaintingMapTransportQA/1.0", "receivedAuthHeader": False,
                         "cookieHeader": False, "tlsProtocol": "TLSv1.3", "alpn": "http/1.1"})
    ledger = {"schema": 1, "origin": ORIGIN, "fixtureResourceProfile": "mixed-v1", "requests": len(requests),
              "tiles": len(requests) - 1, "reservedBytes": len(requests) * 1024, "reservationBytes": 1024,
              "maxRequests": 16, "maxTiles": 8, "maxReservedBytes": 16384, "unresolved": [],
              "fixtureTLSLeafDER": base64.b64encode(LEAF).decode()}
    native = {"active": 0, "pending": 0, "started": len(requests), "released": len(requests),
              "httpRequestSendsSettled": len(requests), "ledgerOK": True, "tlsVerifiedExchanges": 1,
              "acceptedBodyBytes": 467, "transport": "pinned-private-tls-http1-fixture",
              "blockedBeforeDispatch": 2, "ledger": ledger,
              "lastExchange": {"finishCode": 6, "trustAccepted": True, "alpn": "http/1.1", "requestSends": 1}}
    run, pid = "tlspolicy-" + "a" * 24, 123
    attempts = {"origin": 1, "path": 1, "redirectSource": len(requests) - 1}
    case = {"name": "SDK HTTPS policy refusal", "pass": True, "styleLoaded": True,
            "observationMs": 2600, "attempts": attempts, "native": native}
    return {"source-initial": dict(SOURCE_EMPTY), "target-initial": dict(EMPTY), "target-final": dict(EMPTY),
            "source-final": {**SOURCE_EMPTY, "resourceCount": len(requests), "maxActive": 1, "requests": requests},
            "run": {"runID": run}, "launch": {"process": pid}, "process-after": {"process": pid}, "ledger": ledger,
            "result": {"complete": True, "pass": True, "stage": "tls-policy", "trialPhase": 1,
                       "mapCreated": True, "runID": run, "process": pid, "delegateClass": "MLRNTransformRequest",
                       "delegatePreserved": 1, "cases": [case], "policyAttempts": attempts, "nativeAtFinish": native}}


class PolicyEvidenceTests(unittest.TestCase):
    def verify(self, value):
        with TemporaryDirectory() as tmp:
            folder = Path(tmp)
            for name, row in value.items():
                (folder / f"{name}.json").write_text(json.dumps(row))
            return verify(folder, ORIGIN, TARGET, LEAF)

    def test_only_counts_observed_same_process_reissues(self):
        for reissues in (0, 2):
            with self.subTest(reissues=reissues):
                result = self.verify(evidence(reissues))
                self.assertEqual(result["sameProcessReissuesObserved"], reissues)
                self.assertEqual(result["reservedBytes"], (2 + reissues) * 1024)

    def test_refuses_a_target_arrival_or_a_denied_path_at_source(self):
        for file, key in (("target-final", "resourceCount"), ("source-final", "policyDeniedPathArrivals")):
            value = evidence()
            value[file][key] = 1
            with self.subTest(file=file), self.assertRaises(EvidenceError):
                self.verify(value)

    def test_refuses_wrong_process_and_non_redirect_diagnostics(self):
        value = evidence()
        value["process-after"]["process"] += 1
        with self.assertRaises(EvidenceError):
            self.verify(value)
        value = evidence()
        value["result"]["nativeAtFinish"]["lastExchange"]["finishCode"] = 2
        with self.assertRaises(EvidenceError):
            self.verify(value)
