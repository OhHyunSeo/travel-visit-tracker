"""Explicit private-origin TLS admission; actual Mac loopback, not phone/LAN proof."""
import base64
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from test_tls_exchange import TLSFixture, make_certificate

ROOT = Path(__file__).resolve().parent


@unittest.skipUnless(sys.platform == "darwin", "Apple native private TLS host tests")
class PrivateTLSTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="private-tls-")
        cls.root = Path(cls.temp.name)
        cls.binary = cls.root / "driver"
        try:
            subprocess.run(["xcrun", "clang", "-fobjc-arc", "-fblocks", "-Wall", "-Wextra", "-Werror",
                            "-Wno-unused-parameter", "-Wno-incompatible-pointer-types",
                            "-framework", "Foundation", "-framework", "Network", "-framework", "Security",
                            str(ROOT / "test-private-tls.m"), str(ROOT / "TPTransport.m"),
                            str(ROOT / "TPHTTPExchange.m"), "-o", str(cls.binary)],
                           check=True, capture_output=True, text=True)
            for name, san in (("correct", "IP:127.0.0.1"), ("other", "IP:127.0.0.1"), ("wronghost", "IP:192.168.1.1")):
                make_certificate(cls.root, name, san)
            cls.pin = base64.b64encode((cls.root / "correct.der").read_bytes()).decode()
        except BaseException:
            cls.temp.cleanup()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def fixture(self, name="correct", **kwargs):
        return TLSFixture(self.root / (name + ".pem"), self.root / (name + ".key"), **kwargs)

    def run_driver(self, origin, url=None, *, pin=None, ledger=None, mode="gate"):
        if ledger is None:
            ledger = self.root / (self.id().split(".")[-1] + ".json")
        output = subprocess.check_output([str(self.binary), origin, url or origin + "/resource/tile/test",
                                          self.pin if pin is None else pin, str(ledger), mode], text=True, timeout=20)
        return json.loads(output)

    def test_explicit_tls_success_reopen_charge_and_denial(self):
        with self.fixture() as server:
            origin = f"https://127.0.0.1:{server.port}"
            for count in (1, 2):
                result = self.run_driver(origin)
                self.assertEqual(result["error"], 0)
                native = result["native"]
                self.assertEqual(native["transport"], "pinned-private-tls-http1-fixture")
                self.assertEqual(native["tlsVerifiedExchanges"], 1)
                self.assertEqual(native["ledger"]["reservedBytes"], count * 256)
            denied = self.run_driver(origin)["native"]
            self.assertEqual(denied["started"], 0)
            self.assertEqual(denied["blockedBeforeDispatch"], 1)
            self.assertEqual(len(server.requests), 2)

    def test_canonical_private_origin_admission_without_dispatch(self):
        for index, origin in enumerate(("https://10.1.2.3:3000", "https://172.16.2.3:3000", "https://192.168.2.3:3000")):
            result = self.run_driver(origin, "https://example.invalid:443/resource/tile/test", ledger=self.root / f"private-{index}.json")
            self.assertTrue(result["configured"])
            self.assertEqual(result["native"]["started"], 0)
            self.assertEqual(result["native"]["ledger"]["requests"], 0)

    def test_legacy_loopback_mode_still_refuses_lan(self):
        self.assertFalse(self.run_driver("https://192.168.1.2:3000", mode="legacy")["configured"])

    def test_invalid_origin_or_der_never_creates_ledger(self):
        invalid = ("http://127.0.0.1:3000", "https://example.invalid:3000", "https://8.8.8.8:3000",
                   "https://169.254.1.2:3000", "https://127.0.0.2:3000", "https://[::1]:3000",
                   "https://192.168.1.2:03000", "https://192.168.1.2:3000/", "https://user@192.168.1.2:3000",
                   "https://192.168.1.2:3000?x=1", "https://192.168.1.2:3000#x", "https://192.168.1.2:0")
        for origin in invalid:
            ledger = self.root / "invalid-origin.json"
            self.assertFalse(self.run_driver(origin, ledger=ledger)["configured"], origin)
            self.assertFalse(ledger.exists())
        for pin in ("", self.pin + "\n", "!!!!", base64.b64encode(b"not DER").decode(), "A" * 21852):
            ledger = self.root / "invalid-der.json"
            self.assertFalse(self.run_driver("https://127.0.0.1:3000", pin=pin, ledger=ledger)["configured"])
            self.assertFalse(ledger.exists())

    def test_exact_origin_enforced_by_gate_and_exchange(self):
        with self.fixture() as server:
            origin = f"https://127.0.0.1:{server.port}"
            for mode in ("gate", "exchange"):
                result = self.run_driver(origin, f"https://127.0.0.1:{server.port + 1}/resource/tile/test", mode=mode)
                self.assertNotEqual(result["error"], 0)
                self.assertEqual(result["native"]["started"] if mode == "gate" else result["sends"], 0)
            self.assertEqual(server.accepted, 0)

    def test_same_ledger_pin_mismatch_preserves_bytes(self):
        with self.fixture() as server:
            origin = f"https://127.0.0.1:{server.port}"
            ledger = self.root / "mismatch.json"
            self.assertEqual(self.run_driver(origin, ledger=ledger)["error"], 0)
            before = ledger.read_bytes()
            other = base64.b64encode((self.root / "other.der").read_bytes()).decode()
            self.assertFalse(self.run_driver(origin, ledger=ledger, pin=other)["configured"])
            self.assertEqual(ledger.read_bytes(), before)
            self.assertEqual(len(server.requests), 1)

    def test_bad_pin_host_and_h2_reserve_but_do_not_send_http(self):
        for index, (name, protocols) in enumerate((("other", ("http/1.1",)), ("wronghost", ("http/1.1",)), ("correct", ("h2",)))):
            with self.fixture(name, protocols=protocols) as server:
                origin = f"https://127.0.0.1:{server.port}"
                pin = base64.b64encode((self.root / (name + ".der")).read_bytes()).decode() if name == "wronghost" else self.pin
                result = self.run_driver(origin, pin=pin, ledger=self.root / f"refuse-{index}.json")
                self.assertNotEqual(result["error"], 0)
                native = result["native"]
                self.assertEqual(native["ledger"]["reservedBytes"], 256)
                self.assertEqual(native["httpRequestSendsSettled"], 0)
                self.assertEqual(native["tlsVerifiedExchanges"], 0)
                self.assertEqual(native["released"], 1)
                self.assertEqual(len(server.requests), 0)


if __name__ == "__main__":
    unittest.main()
