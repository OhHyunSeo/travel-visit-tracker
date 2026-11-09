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

    def test_held_handshake_diagnostics_record_deadline_without_native_error(self):
        with self.fixture(handshake_hold=True) as server:
            origin = f"https://127.0.0.1:{server.port}"
            direct = self.run_driver(origin, mode="exchange")
            info = direct["diagnostics"]
            self.assertEqual(direct["sends"], 0)
            self.assertEqual(info["finishCode"], 3)
            self.assertEqual(info["networkState"], "preparing")
            self.assertEqual(info["networkErrorDomain"], 0)
            self.assertEqual(info["networkErrorCode"], 0)
            self.assertEqual(info["requestSends"], 0)
            self.assertEqual(info["receivedHTTPBytes"], 0)
            self.assertNotIn("url", info)
            self.assertNotIn("headers", info)
            self.assertNotIn("body", info)
            self.assertEqual(server.accepted, 1)
            self.assertEqual(len(server.requests), 0)

    def test_certificate_host_failure_diagnostics_preserve_failure_charge(self):
        with self.fixture("wronghost") as server:
            origin = f"https://127.0.0.1:{server.port}"
            pin = base64.b64encode((self.root / "wronghost.der").read_bytes()).decode()
            native = self.run_driver(origin, pin=pin)["native"]
            info = native["lastExchange"]
            self.assertEqual(native["ledger"]["reservedBytes"], 256)
            self.assertEqual(native["released"], 1)
            self.assertEqual(info["finishCode"], 2)
            self.assertIn(info["networkState"], ("waiting", "failed"))
            self.assertGreater(info["networkErrorDomain"], 0)
            self.assertNotEqual(info["networkErrorCode"], 0)
            self.assertEqual(info["requestSends"], 0)
            self.assertEqual(info["receivedHTTPBytes"], 0)
            self.assertIs(info["trustAccepted"], False)
            self.assertEqual(len(server.requests), 0)

    def test_protocol_refusal_diagnostics_differ_from_connection_failure(self):
        with self.fixture(protocols=("h2",)) as server:
            native = self.run_driver(f"https://127.0.0.1:{server.port}")["native"]
            info = native["lastExchange"]
            self.assertEqual(info["finishCode"], 11)
            self.assertEqual(info["networkState"], "ready")
            self.assertEqual(info["networkErrorDomain"], 0)
            self.assertEqual(info["networkErrorCode"], 0)
            self.assertIs(info["trustAccepted"], True)
            self.assertEqual(info["alpn"], "h2")
            self.assertEqual(native["httpRequestSendsSettled"], 0)
            self.assertEqual(native["tlsVerifiedExchanges"], 0)
            self.assertEqual(native["ledger"]["reservedBytes"], 256)
            self.assertEqual(len(server.requests), 0)

    def test_mixed_body_limit_and_existing_default_limit(self):
        for size in (1024, 1025):
            response = (f"HTTP/1.1 200 OK\r\nContent-Length: {size}\r\nConnection: close\r\n\r\n".encode()
                        + b"x" * size)
            with self.subTest(size=size), self.fixture(response=response) as server:
                origin = f"https://127.0.0.1:{server.port}"
                ledger = self.root / f"mixed-body-{size}.json"
                result = self.run_driver(origin, origin + "/resource/style/mixed", mode="mixed", ledger=ledger)
                self.assertTrue(result["configured"])
                native = result["native"]
                self.assertEqual(native["released"], 1)
                self.assertEqual(native["httpRequestSendsSettled"], 1)
                self.assertEqual(native["ledger"]["reservationBytes"], 1024)
                self.assertEqual(native["ledger"]["reservedBytes"], 1024)
                self.assertEqual(native["ledger"]["unresolved"], [])
                accepted = size == 1024
                self.assertEqual(result["error"] == 0, accepted)
                self.assertEqual(result["length"], size if accepted else 0)
                self.assertEqual(native["tlsVerifiedExchanges"], int(accepted))
                self.assertEqual(native["lastExchange"]["finishCode"], 0 if accepted else 6)
                if accepted:
                    default = self.run_driver(origin, origin + "/resource/style/mixed", mode="gate-mixed-budget",
                                              ledger=self.root / "default-body.json")
                    self.assertNotEqual(default["error"], 0)
                    self.assertEqual(default["length"], 0)
                    self.assertEqual(default["native"]["lastExchange"]["finishCode"], 6)
                    self.assertEqual(default["native"]["ledger"]["reservedBytes"], 256)

    def test_mixed_accepts_only_exact_resource_paths(self):
        accepted = ("/resource/style/mixed", "/resource/tile/m_2_0_3", "/resource/glyph/QA/0-255.pbf",
                    "/resource/sprite/mixed.json", "/resource/sprite/mixed.png",
                    "/resource/sprite/mixed@2x.json", "/resource/sprite/mixed@2x.png")
        rejected = ("/resource/style/sdk", "/resource/style/mixed?", "/resource/style/mixed?hold=1",
                    "/resource/tile/m_2_4_0", "/resource/tile/m_1_0_0", "/resource/glyph/QA/256-511.pbf",
                    "/resource/glyph/%51A/0-255.pbf", "/resource/sprite/mixed%402x.png",
                    "/resource/sprite/mixed@3x.png", "/resource/sprite/mixed.json/")
        with self.fixture() as server:
            origin = f"https://127.0.0.1:{server.port}"
            ledger = self.root / "mixed-routes.json"
            for route in accepted:
                with self.subTest(route=route):
                    result = self.run_driver(origin, origin + route, mode="mixed", ledger=ledger)
                    self.assertEqual(result["error"], 0)
                    self.assertEqual(server.requests[-1].split(b"\r\n", 1)[0], f"GET {route} HTTP/1.1".encode())
            before = ledger.read_bytes()
            for route in rejected:
                with self.subTest(route=route):
                    result = self.run_driver(origin, origin + route, mode="mixed", ledger=ledger)
                    self.assertNotEqual(result["error"], 0)
                    self.assertEqual(result["native"]["started"], 0)
                    self.assertEqual(result["native"]["blockedBeforeDispatch"], 1)
                    self.assertEqual(ledger.read_bytes(), before)
            self.assertEqual(server.accepted, len(accepted))

    def test_mixed_ledger_reopens_only_with_its_resource_profile(self):
        with self.fixture() as server:
            origin = f"https://127.0.0.1:{server.port}"
            ledger = self.root / "mixed-profile.json"
            style = origin + "/resource/style/mixed"
            first = self.run_driver(origin, style, mode="mixed", ledger=ledger)
            self.assertEqual(first["error"], 0)
            saved = first["native"]["ledger"]
            self.assertEqual({key: saved[key] for key in ("maxRequests", "maxTiles", "maxReservedBytes",
                                                         "fixtureResourceProfile", "reservedBytes")},
                             {"maxRequests": 16, "maxTiles": 8, "maxReservedBytes": 16384,
                              "fixtureResourceProfile": "mixed-v1", "reservedBytes": 1024})
            before = ledger.read_bytes()
            self.assertFalse(self.run_driver(origin, style, mode="gate-mixed-budget", ledger=ledger)["configured"])
            self.assertEqual(ledger.read_bytes(), before)
            self.assertEqual(len(server.requests), 1)
            reopened = self.run_driver(origin, style, mode="mixed", ledger=ledger)
            self.assertEqual(reopened["error"], 0)
            self.assertEqual(reopened["native"]["ledger"]["reservedBytes"], 2048)
            self.assertEqual(len(server.requests), 2)


if __name__ == "__main__":
    unittest.main()
