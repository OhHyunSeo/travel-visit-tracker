"""Exercise the capture sequence with a fake CoreDevice and replay its saved files."""

import json
import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import action_delivery as delivery


PID = 845
EXECUTABLE = "file:///private/var/test/MapLibreQA.app/MapLibreQA"
ATTEMPTS = [
    {"accepted": True, "phaseBefore": 10, "phaseAfter": 12, "sequenceBefore": 0, "sequenceAfter": 1},
    {"accepted": False, "phaseBefore": 12, "phaseAfter": 12, "sequenceBefore": 1, "sequenceAfter": 1},
    {"accepted": True, "phaseBefore": 12, "phaseAfter": 13, "sequenceBefore": 1, "sequenceAfter": 2},
]


class FakeCoreDevice:
    def __init__(self, *, locked=False, changed_at=None, accept_replay=False):
        self.locked = locked
        self.changed_at = changed_at
        self.accept_replay = accept_replay
        self.environment = {}
        self.sent = []
        self.launched = False
        self.read_initial_result = False

    def __call__(self, args, *, capture_output, timeout, env):
        assert args[:3] == ["xcrun", "devicectl", "device"] and args[6] == "qa-device"
        assert capture_output and 0 < timeout <= 8 and "--terminate-existing" not in args
        assert not any(key.startswith("DEVICECTL_CHILD_") for key in env)
        command = tuple(args[3:5])
        process = {"processIdentifier": PID, "executable": EXECUTABLE}
        if command == ("info", "lockState"):
            return self.reply(args, {"passcodeRequired": self.locked, "unlockedSinceBoot": True})
        if command == ("info", "processes"):
            assert args[-2:] == ["--search", "MapLibreQA"]
            return self.reply(args, {"runningProcesses": [process] if self.launched else []})
        if command == ("process", "launch"):
            assert args[-1] == "app.trippainting.maplibreqa"
            if not self.launched:
                assert args[-3] == "--environment-variables"
                self.environment = json.loads(args[-2])
                assert set(self.environment) == {"QA_STAGE", "QA_RUN_ID", "QA_FIXTURE_CANCEL_NONCE",
                                                 "QA_FIXTURE_RELOAD_NONCE"}
                self.launched = True
            else:
                assert args[-3] == "--payload-url" and "--environment-variables" not in args
                self.sent.append(args[-2])
                if len(self.sent) == self.changed_at:
                    process["processIdentifier"] += 1
            return self.reply(args, {"process": process})
        assert command == ("copy", "from") and "--remove-existing-content" not in args
        assert args[args.index("--domain-identifier") + 1] == "app.trippainting.maplibreqa"
        step = len(self.sent)
        name = args[args.index("--source") + 1]
        run = self.environment["QA_RUN_ID"]
        assert name in (f"Documents/{run}/action-progress.json", f"Documents/{run}/result.json")
        identity = {"stage": "action-gate", "runID": run, "process": PID}
        if name.endswith("/action-progress.json"):
            attempts = [dict(item) for item in ATTEMPTS[:step]]
            if step == 2 and self.accept_replay:
                attempts[1]["accepted"] = True
            value = dict(identity, kind="fixture-action-progress", phase=(10, 12, 12, 13)[step],
                         sequence=(0, 1, 1, 2)[step], attempts=attempts)
        elif not self.read_initial_result:
            self.read_initial_result = True
            value = {"complete": False, "phase": "waiting-for-fixture-signal"}
        else:
            value = dict(identity, complete=True, **{"pass": True}, trialPhase=13,
                         fixtureActionSequence=2, fixtureActionAttempts=ATTEMPTS, mapCreated=False,
                         cancellationTrigger="none", delegateClass="none", transforms=0,
                         rewrittenStyles=0, externalTileRequests=0,
                         cases=[{"name": "run-bound fixture URL delivery", "pass": True,
                                 "attempts": ATTEMPTS}],
                         nativeAtFinish=dict(dict.fromkeys(delivery.COUNTERS, 0), ledger={}))
        Path(args[args.index("--destination") + 1]).write_text(json.dumps(value))
        return subprocess.CompletedProcess(args, 0, b"", b"")

    @staticmethod
    def reply(args, result):
        assert args[args.index("--json-output") + 1] == "-"
        return subprocess.CompletedProcess(args, 0, json.dumps({"info": {"outcome": "success"},
                                                                "result": result}).encode(), b"")


class ActionDeliveryTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.evidence = Path(temporary.name) / "new-private-evidence"

    def record(self, fake):
        with patch.object(delivery.subprocess, "run", side_effect=fake):
            return delivery.capture("qa-device", self.evidence)

    def test_records_and_replays_the_same_process_without_storing_nonces(self):
        fake = FakeCoreDevice()
        with patch.dict(os.environ, {"DEVICECTL_CHILD_QA_STAGE": "unrelated-test"}):
            result = self.record(fake)
        self.assertEqual(result, delivery.verify(self.evidence))
        self.assertEqual((result["accepted"], result["duplicateRejected"]), (2, 1))
        self.assertEqual(fake.sent[0], fake.sent[1])
        self.assertIn(f"://reload?runID={fake.environment['QA_RUN_ID']}&pid={PID}&nonce=", fake.sent[2])
        saved = "".join(path.read_text() for path in self.evidence.iterdir())
        for name in ("QA_FIXTURE_CANCEL_NONCE", "QA_FIXTURE_RELOAD_NONCE"):
            self.assertNotIn(fake.environment[name], saved)
        self.assertNotIn(EXECUTABLE, saved)

    def test_changed_process_stops_before_any_further_signal(self):
        fake = FakeCoreDevice(changed_at=2)
        with self.assertRaisesRegex(delivery.EvidenceError, "different QA process"):
            self.record(fake)
        self.assertEqual(len(fake.sent), 2)
        self.assertFalse((self.evidence / "payload-3.json").exists())

    def test_an_accepted_replay_is_preserved_and_stops_before_reload(self):
        fake = FakeCoreDevice(accept_replay=True)
        with self.assertRaisesRegex(delivery.EvidenceError, "observation 2"):
            self.record(fake)
        self.assertEqual(len(fake.sent), 2)
        self.assertTrue((self.evidence / "progress-2.json").exists())

    def test_locked_device_never_launches(self):
        fake = FakeCoreDevice(locked=True)
        with self.assertRaisesRegex(delivery.EvidenceError, "unlock"):
            self.record(fake)
        self.assertFalse(fake.launched)

    def test_verify_rejects_edited_final_process_and_native_activity(self):
        self.record(FakeCoreDevice())
        path = self.evidence / "process-after.json"
        path.write_text(json.dumps({"process": PID + 1}))
        with self.assertRaisesRegex(delivery.EvidenceError, "original process"):
            delivery.verify(self.evidence)
        path.write_text(json.dumps({"process": PID}))
        path = self.evidence / "result.json"
        value = json.loads(path.read_text())
        value["nativeAtFinish"]["started"] = 1
        path.write_text(json.dumps(value))
        with self.assertRaisesRegex(delivery.EvidenceError, "native transport activity"):
            delivery.verify(self.evidence)

    def test_verify_rejects_duplicate_keys_and_integer_flags(self):
        self.record(FakeCoreDevice())
        path = self.evidence / "result.json"
        value = json.loads(path.read_text())
        value["mapCreated"] = 0
        path.write_text(json.dumps(value))
        with self.assertRaisesRegex(delivery.EvidenceError, "final scene evidence"):
            delivery.verify(self.evidence)
        path.write_text('{"complete":false,"complete":true}')
        with self.assertRaisesRegex(delivery.EvidenceError, "duplicate evidence keys"):
            delivery.verify(self.evidence)
