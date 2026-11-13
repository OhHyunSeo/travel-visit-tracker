import hashlib
import io
from pathlib import Path
import stat
import struct
from tempfile import TemporaryDirectory
import unittest
import zlib
from zipfile import ZipFile

from PIL import Image

from capture_device import ACTIVITY, JOURNAL, PACKAGE, collect


PID = b"4310\n"
GOOD_LOG = (
    b"11-13 09:10:11.001  4310  4310 I TripMapSdkFixture: TRANSPORT_READY\n"
    b"11-13 09:10:12.001  4310  4310 I TripMapSdkFixture: STYLE_LOADED attempts=1 tiles=0 reserved=4096\n"
    b"11-13 09:10:12.002  4310  4310 I TripMapSdkFixture: FRAME_RENDERED fully=true\n"
)
GOOD_SERVER = b"STYLE_SERVER_READY port=39443\nSERVED_STYLE bytes=124\n"
GOOD_RELAY = b"RELAY_READY port=39443\nRELAY_COMPLETE forwarded=2452\n"
ACTIVITIES = (f"  topResumedActivity=ActivityRecord{{124 u0 {ACTIVITY} t73}}\n"
              f"  mResumedActivity: ActivityRecord{{124 u0 {ACTIVITY} t73}}\n").encode()


class CaptureTest(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.output = self.root / "capture"
        self.apk = self.root / "test.apk"
        with ZipFile(self.apk, "w") as archive:
            archive.writestr("assets/fixture-port", b"39443")
        self.apk_hash = hashlib.sha256(self.apk.read_bytes()).hexdigest()

        image = io.BytesIO()
        Image.new("RGB", (100, 120), (23, 120, 120)).save(image, format="PNG")
        header = struct.pack(">IIIIQ", 0x54504231, 16, 8, 4096, 65536)
        record = struct.pack(">IIQI", 1, 0, 4096, 0)
        journal = header + struct.pack(">I", zlib.crc32(header)) + record + struct.pack(">I", zlib.crc32(record))
        self.calls = [
            (("shell", "pidof", PACKAGE), PID),
            (("logcat", "-d", "--pid", "4310", "-v", "threadtime", "-s", "TripMapSdkFixture:V", "*:S"), GOOD_LOG),
            (("shell", "dumpsys", "activity", "activities"), ACTIVITIES),
            (("exec-out", "screencap", "-p"), image.getvalue()),
            (("shell", "dumpsys", "activity", "activities"), ACTIVITIES),
            (("shell", "pidof", PACKAGE), PID),
            (("exec-out", "run-as", PACKAGE, "cat", JOURNAL), journal),
            (("shell", "pidof", PACKAGE), PID),
        ]

    def command(self, limit, *args):
        expected, result = self.calls.pop(0)
        self.assertEqual(args, expected)
        self.assertLessEqual(len(result), limit)
        return result

    def collect(self, server=GOOD_SERVER):
        return collect(self.command, self.output, self.apk, server, GOOD_RELAY, expected_apk_sha256=self.apk_hash)

    def test_captures_and_verifies_current_foreground_fixture(self):
        report = self.collect()
        self.assertFalse(self.calls)
        self.assertTrue(report["renderEventObserved"])
        self.assertEqual(report["reservedBodyBytes"], 4096)
        self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o700)
        for file in self.output.iterdir():
            self.assertEqual(stat.S_IMODE(file.stat().st_mode), 0o600)

    def test_incomplete_relay_or_server_evidence_blocks_guest_commands(self):
        with self.assertRaisesRegex(ValueError, "one matching fixture style response"):
            self.collect(GOOD_SERVER + b"SERVED_STYLE bytes=124\n")
        self.assertEqual(len(self.calls), 8)

    def test_no_screenshot_before_complete_frame(self):
        args, _ = self.calls[1]
        self.calls[1] = args, b"\n".join(GOOD_LOG.splitlines()[:2])
        with self.assertRaisesRegex(ValueError, "completed frame"):
            self.collect()
        self.assertEqual(len(self.calls), 6)
        self.assertFalse((self.output / "screen.png").exists())

    def test_blocks_screenshot_when_another_app_is_resumed(self):
        args, _ = self.calls[2]
        self.calls[2] = args, ACTIVITIES + b"topResumedActivity=ActivityRecord{124 u0 other.app/.Activity t45}\n"
        with self.assertRaisesRegex(ValueError, "sole resumed activity"):
            self.collect()
        self.assertEqual(len(self.calls), 5)
        self.assertFalse((self.output / "screen.png").exists())

    def test_discards_screenshot_when_pid_changes(self):
        args, _ = self.calls[5]
        self.calls[5] = args, b"4322\n"
        with self.assertRaisesRegex(ValueError, "PID changed during screen capture"):
            self.collect()
        self.assertEqual(len(self.calls), 2)
        self.assertFalse((self.output / "screen.png").exists())

    def test_discards_journal_when_pid_changes(self):
        args, _ = self.calls[-1]
        self.calls[-1] = args, b"4322\n"
        with self.assertRaisesRegex(ValueError, "PID changed during journal capture"):
            self.collect()
        self.assertFalse((self.output / "budget.journal").exists())

    def test_does_not_reuse_capture_directory(self):
        self.output.mkdir()
        with self.assertRaises(FileExistsError):
            self.collect()
        self.assertEqual(len(self.calls), 8)

    def test_refuses_different_apk_before_guest_commands(self):
        self.apk_hash = '0' * 64
        with self.assertRaisesRegex(ValueError, "differs from the checked build"):
            self.collect()
        self.assertEqual(len(self.calls), 8)
        self.assertFalse(self.output.exists())

    def test_does_not_accept_apk_replaced_mid_capture(self):
        def replace_at_end(limit, *args):
            result = self.command(limit, *args)
            if not self.calls:
                with ZipFile(self.apk, "a") as archive:
                    archive.writestr("different-file", b"replacement")
            return result

        with self.assertRaisesRegex(ValueError, "changed during capture"):
            collect(replace_at_end, self.output, self.apk, GOOD_SERVER, GOOD_RELAY, expected_apk_sha256=self.apk_hash)
