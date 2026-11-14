"""Host capture barriers using synthetic CoreDevice and HTTPS replies."""

from contextlib import ExitStack
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import time
import unittest
from unittest.mock import MagicMock, patch

import tls_cancel_capture as trial
from tls_result import EvidenceError


ORIGIN = "https://127.0.0.1:8443"
CERT = b"synthetic public leaf"
PID = 845
EXECUTABLE = "file:///private/var/test/MapLibreQA.app/MapLibreQA"
INITIAL = {"active": 0, "maxActive": 0, "heldActive": 0, "resourceCount": 0,
           "heldReleased": False, "requests": []}
HEADERS = {"ua": "TripPaintingMapTransportQA/1.0", "receivedAuthHeader": False,
           "cookieHeader": False, "tlsProtocol": "TLSv1.3", "alpn": "http/1.1"}
STYLE = {**HEADERS, "path": "/resource/style/held", "held": False, "finished": True,
         "closedBeforeFinish": False, "bytes": 200, "bytesWritten": 200}
HELD = [{**HEADERS, "path": f"/resource/tile/h_2_1_{index}", "held": True, "finished": False,
         "closedBeforeFinish": False, "bytes": 105, "bytesWritten": 0} for index in range(4)]
BEFORE = {**INITIAL, "active": 4, "heldActive": 4, "maxActive": 4, "resourceCount": 5,
          "requests": [STYLE, *HELD]}
DRAINED = {**BEFORE, "active": 0, "heldActive": 0,
           "requests": [STYLE, *[{**row, "closedBeforeFinish": True} for row in HELD]]}
ATTEMPTS = [
    {"accepted": True, "phaseBefore": 10, "phaseAfter": 11, "sequenceBefore": 0, "sequenceAfter": 1},
    {"accepted": False, "phaseBefore": 12, "phaseAfter": 12, "sequenceBefore": 1, "sequenceAfter": 1},
    {"accepted": True, "phaseBefore": 12, "phaseAfter": 13, "sequenceBefore": 1, "sequenceAfter": 2},
]


class CaptureFake:
    def __init__(self, *, locked=False, drained=DRAINED, changed_pid_at=None):
        self.events = []
        self.sent = []
        self.locked = locked
        self.drained = drained
        self.changed_pid_at = changed_pid_at
        self.interim_seen = False
        self.environment = None

    def request(self, route, _deadline):
        self.events.append((route, len(self.sent)))
        if route == "/release-held":
            return {"heldReleased": True, "releasedOpenBodies": 0}
        if self.environment is None:
            return INITIAL
        return {0: BEFORE, 1: self.drained, 3: {**DRAINED, "heldReleased": True}}[len(self.sent)]

    def device(self, _device, command, *, deadline):
        assert command == ("info", "lockState") and time.monotonic() < deadline
        return {"passcodeRequired": self.locked, "unlockedSinceBoot": True}

    def processes(self, _device, _deadline):
        return [{"executable": EXECUTABLE, "processIdentifier": PID}] if self.environment else []

    def launch(self, _device, options, _deadline):
        if self.environment is None:
            assert options[0] == "--environment-variables"
            self.environment = json.loads(options[1])
            return PID, EXECUTABLE
        assert options[0] == "--payload-url"
        self.events.append(("payload", len(self.sent) + 1))
        self.sent.append(options[1])
        return PID + (len(self.sent) == self.changed_pid_at), EXECUTABLE

    def document(self, _device, run, name, _deadline):
        assert run == self.environment["QA_RUN_ID"]
        if name == "tls-ledger.json":
            return {"requests": 12}
        if name == "result.json":
            return {"complete": True}
        assert name == "action-progress.json"
        step = len(self.sent)
        phase = (10, 12, 12, 13)[step]
        if step == 1 and not self.interim_seen:
            self.interim_seen = True
            phase = 11
        return {"kind": "fixture-action-progress", "stage": "tls-cancel-retry", "runID": run,
                "process": PID, "phase": phase, "sequence": (0, 1, 1, 2)[step],
                "attempts": ATTEMPTS[:step],
                "native": {"ledgerOK": True, "transport": "pinned-private-tls-http1-fixture",
                           "active": 4 if phase == 10 else 0, "pending": 2 if phase == 10 else 0}}


class TLSCancelCaptureTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.folder = Path(temporary.name) / "observations"

    def capture(self, fake):
        with ExitStack() as patches:
            patches.enter_context(patch.object(trial, "FixtureControl", return_value=fake))
            for name, fake_function in (("_device", fake.device), ("_processes", fake.processes),
                                        ("_launched", fake.launch), ("_copy", fake.document)):
                patches.enter_context(patch.object(trial.device_tools, name, fake_function))
            trial.capture_observations("explicit-qa-device", self.folder, ORIGIN, CERT)

    def test_checks_drain_before_replay_then_releases_before_reload(self):
        fake = CaptureFake()
        self.capture(fake)
        self.assertEqual(fake.events, [("/stats", 0), ("/stats", 0), ("payload", 1), ("/stats", 1),
                                       ("payload", 2), ("/release-held", 2), ("payload", 3), ("/stats", 3)])
        self.assertEqual(fake.sent[0], fake.sent[1])
        self.assertIn("://reload?", fake.sent[2])
        self.assertTrue(fake.interim_seen)
        self.assertEqual(json.loads((self.folder / "progress-1.json").read_text())["phase"], 12)
        self.assertEqual(json.loads((self.folder / "process-after.json").read_text()), {"process": PID})
        self.assertEqual(fake.environment["QA_STAGE"], "tls-cancel-retry")
        output = "".join(path.read_text() for path in self.folder.iterdir())
        for key in ("QA_FIXTURE_CANCEL_NONCE", "QA_FIXTURE_RELOAD_NONCE"):
            self.assertNotIn(fake.environment[key], output)

    def test_incomplete_drain_is_saved_and_prevents_replay_release_and_reload(self):
        fake = CaptureFake(drained={**DRAINED, "requests": [STYLE, *HELD]})
        with self.assertRaisesRegex(EvidenceError, "did not close without writing"):
            self.capture(fake)
        self.assertEqual(len(fake.sent), 1)
        self.assertTrue((self.folder / "server-drained.json").is_file())
        self.assertNotIn(("/release-held", 2), fake.events)

    def test_different_process_stops_before_release(self):
        fake = CaptureFake(changed_pid_at=2)
        with self.assertRaisesRegex(EvidenceError, "different QA process"):
            self.capture(fake)
        self.assertEqual(len(fake.sent), 2)
        self.assertFalse((self.folder / "release.json").exists())

    def test_locked_device_does_not_launch_or_touch_fixture(self):
        fake = CaptureFake(locked=True)
        with self.assertRaisesRegex(EvidenceError, "unlock the device"):
            self.capture(fake)
        self.assertIsNone(fake.environment)
        self.assertEqual(fake.events, [])


class FixtureControlTests(unittest.TestCase):
    def request(self, leaf, alpn):
        fixture = trial.FixtureControl(ORIGIN, CERT)
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.getpeercert.return_value = leaf
        connection.selected_alpn_protocol.return_value = alpn
        connection.recv.side_effect = [b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
                                       b"Transfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n0\r\n\r\n", b""]
        return fixture, connection

    def test_authenticates_leaf_and_alpn_before_writing(self):
        for leaf, alpn, reason in ((b"different leaf", "http/1.1", "leaf differs"),
                                   (CERT, "h2", "ALPN differs")):
            with self.subTest(reason=reason):
                fixture, connection = self.request(leaf, alpn)
                with patch.object(trial.socket, "create_connection"), patch.object(
                        fixture.context, "wrap_socket", return_value=connection):
                    with self.assertRaisesRegex(EvidenceError, reason):
                        fixture.request("/stats", time.monotonic() + 4)
                connection.sendall.assert_not_called()

    def test_reads_chunked_json_from_explicit_fixture_route(self):
        fixture, connection = self.request(CERT, "http/1.1")
        with patch.object(trial.socket, "create_connection") as tcp, patch.object(
                fixture.context, "wrap_socket", return_value=connection):
            self.assertEqual(fixture.request("/release-held", time.monotonic() + 4), {})
        self.assertEqual(tcp.call_args.args[0], ("127.0.0.1", 8443))
        request = connection.sendall.call_args.args[0]
        self.assertTrue(request.startswith(b"GET /release-held HTTP/1.1\r\nHost: 127.0.0.1:8443\r\n"))
        self.assertNotIn(b"Authorization:", request)
        self.assertNotIn(b"Cookie:", request)
