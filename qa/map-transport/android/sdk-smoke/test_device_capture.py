import hashlib
from pathlib import Path
import struct
from tempfile import TemporaryDirectory
import unittest
import zlib
from zipfile import ZipFile

from PIL import Image

from verify_device_capture import verify


PORT = 39443
PID = 4310
APP_READY = f"11-12 07:00:01.022  {PID}  4310 I TripMapSdkFixture: TRANSPORT_READY\n"
APP_STYLE = f"11-12 07:00:02.022  {PID}  4320 I TripMapSdkFixture: STYLE_LOADED attempts=1 tiles=0 reserved=4096\n"


def checked(value):
    return value + struct.pack(">I", zlib.crc32(value))


class CaptureTest(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.apk = self.root / "fixture.apk"
        with ZipFile(self.apk, "w") as fixture:
            fixture.writestr("assets/fixture-port", str(PORT))
        (self.root / "server.log").write_text(f"STYLE_SERVER_READY port={PORT}\nSERVED_STYLE bytes=124\n")
        (self.root / "relay.log").write_text(f"RELAY_READY port={PORT}\nRELAY_COMPLETE forwarded=1942\n")
        (self.root / "app.log").write_text("--------- beginning of main\n" + APP_READY + APP_STYLE)
        self.journal = self.root / "budget.journal"
        self.journal.write_bytes(
            checked(struct.pack(">IIIIQ", 0x54504231, 16, 8, 4096, 65536))
            + checked(struct.pack(">IIQI", 1, 0, 4096, 0))
        )
        self.screen = self.root / "screen.png"
        Image.new("RGB", (100, 100), (23, 120, 120)).save(self.screen)

    def test_accepts_one_matching_capture(self):
        result = verify(self.root, self.apk, PID)
        self.assertEqual(result["apkSha256"], hashlib.sha256(self.apk.read_bytes()).hexdigest())
        self.assertEqual(result["styleBodyBytes"], 124)
        self.assertEqual(result["reservedBodyBytes"], 4096)
        self.assertEqual(result["renderedFrame"]["matchingSamples"], 25)

    def test_rejects_mixed_pid(self):
        (self.root / "app.log").write_text(APP_READY + APP_STYLE.replace(str(PID), "9100"))
        with self.assertRaisesRegex(ValueError, "unexpected fixture log"):
            verify(self.root, self.apk, PID)

    def test_rejects_reported_startup_failure(self):
        failed = APP_READY.replace(" I ", " E ").replace("TRANSPORT_READY", "TRANSPORT_STARTUP_FAILED")
        (self.root / "app.log").write_text(failed + APP_READY + APP_STYLE)
        with self.assertRaisesRegex(ValueError, "failed or unexpected"):
            verify(self.root, self.apk, PID)

    def test_rejects_second_server_response(self):
        with (self.root / "server.log").open("a") as log:
            log.write("SERVED_STYLE bytes=124\n")
        with self.assertRaisesRegex(ValueError, "one matching fixture"):
            verify(self.root, self.apk, PID)

    def test_rejects_over_limit_relay(self):
        (self.root / "relay.log").write_text(f"RELAY_READY port={PORT}\nRELAY_COMPLETE forwarded=131073\n")
        with self.assertRaisesRegex(ValueError, "relay byte count"):
            verify(self.root, self.apk, PID)

    def test_rejects_bad_journal_checksum(self):
        record = bytearray(self.journal.read_bytes())
        record[-1] ^= 1
        self.journal.write_bytes(record)
        with self.assertRaisesRegex(ValueError, "one style reservation"):
            verify(self.root, self.apk, PID)

    def test_rejects_additional_journal_record(self):
        with self.journal.open("ab") as journal:
            journal.write(checked(struct.pack(">IIQI", 2, 0, 8192, 0)))
        with self.assertRaisesRegex(ValueError, "Invalid capture file length"):
            verify(self.root, self.apk, PID)

    def test_rejects_blank_screenshot_after_success_logs(self):
        Image.new("RGB", (100, 100), (0, 0, 0)).save(self.screen)
        with self.assertRaisesRegex(ValueError, "fixture map background"):
            verify(self.root, self.apk, PID)

    def test_matches_server_and_relay_to_embedded_apk_port(self):
        with ZipFile(self.apk, "w") as fixture:
            fixture.writestr("assets/fixture-port", "40123")
        with self.assertRaisesRegex(ValueError, "one matching fixture"):
            verify(self.root, self.apk, PID)


if __name__ == "__main__":
    unittest.main()
