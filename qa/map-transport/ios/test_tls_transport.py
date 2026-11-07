"""Pinned TLS through the real durable gate; Mac host, not SDK/phone proof."""
import json
from pathlib import Path
import select
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest

from test_tls_exchange import TLSFixture, make_certificate

ROOT = Path(__file__).resolve().parent
SUCCESS = b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\ntest"
PARTIAL = b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\nte"


class GateTLSFixture(TLSFixture):
    def __init__(self, certificate, key, *, responses=None, hold=False):
        super().__init__(certificate, key)
        self.responses = list(responses or [SUCCESS])
        self.lock = threading.Lock()
        self.release = threading.Event()
        if not hold:
            self.release.set()
        self.active = self.peak = 0

    def serve(self, connection):
        connection.settimeout(2)
        wrapped = None
        registered = False
        try:
            wrapped = self.context.wrap_socket(connection, server_side=True)
            request = bytearray()
            while b"\r\n\r\n" not in request and len(request) < 4096:
                body = wrapped.recv(1024)
                if not body:
                    return
                request.extend(body)
            with self.lock:
                index = len(self.requests)
                self.requests.append(bytes(request))
                self.protocols.append(wrapped.selected_alpn_protocol())
                self.active += 1
                self.peak = max(self.peak, self.active)
                registered = True
            while not self.release.wait(.01) and not self.stopped.is_set():
                readable, _, _ = select.select([wrapped], [], [], 0)
                if readable and not wrapped.recv(1):
                    return
            if self.stopped.is_set():
                return
            wrapped.sendall(self.responses[min(index, len(self.responses) - 1)])
            with self.lock:
                self.active -= 1
                registered = False
            wrapped.unwrap().close()
        except (OSError, TimeoutError):
            pass
        finally:
            if registered:
                with self.lock:
                    self.active -= 1
            if wrapped:
                wrapped.close()
            connection.close()


@unittest.skipUnless(sys.platform == "darwin", "Apple Foundation/Network/Security TLS gate host test")
class TLSTransportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="tls-transport-")
        cls.directory = Path(cls.temporary.name)
        cls.binary, cls.queue_binary = cls.directory / "gate-test", cls.directory / "queue-test"
        try:
            sdk = subprocess.check_output(["xcrun", "--sdk", "macosx", "--show-sdk-path"], text=True).strip()
            for source, binary in (("test-http-exchange.m", cls.binary), ("test-transport-queue.m", cls.queue_binary)):
                subprocess.run([
                    "xcrun", "clang", "-fobjc-arc", "-fblocks", "-Wall", "-Wextra", "-Werror",
                    "-Wno-unused-parameter", "-Wno-incompatible-pointer-types", "-isysroot", sdk,
                    "-framework", "Foundation", "-framework", "Network", "-framework", "Security",
                    str(ROOT / source), str(ROOT / "TPHTTPExchange.m"), str(ROOT / "TPTransport.m"),
                    "-o", str(binary),
                ], check=True, capture_output=True, text=True)
            for name in ("correct", "other"):
                make_certificate(cls.directory, name, "IP:127.0.0.1")
            (cls.directory / "invalid.der").write_bytes(b"invalid synthetic DER")
        except BaseException:
            cls.temporary.cleanup()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()  # Only this suite's fresh keys, certificates and binaries.

    def fixture(self, name="correct", **kwargs):
        return GateTLSFixture(self.directory / (name + ".pem"), self.directory / (name + ".key"), **kwargs)

    def fetch(self, port, ledger, *, certificate="correct", url=None):
        result = subprocess.run([
            str(self.binary), url or f"https://127.0.0.1:{port}/resource/tile/test", "1", "0",
            str(ledger), "1", str(self.directory / (certificate + ".der")),
        ], check=True, capture_output=True, text=True, timeout=15)
        return json.loads(result.stdout)

    def test_tls_success_reopen_and_third_attempt_denial_keep_charge(self):
        ledger = self.directory / "success-ledger.json"
        with self.fixture() as fixture:
            first, second, denied = [self.fetch(fixture.port, ledger) for _ in range(3)]
            self.assertEqual((first["error"], second["error"]), (0, 0))
            self.assertNotEqual(denied["error"], 0)
            self.assertEqual(len(fixture.requests), 2)
            self.assertEqual(fixture.protocols, ["http/1.1", "http/1.1"])
            self.assertEqual(denied["native"]["ledger"]["reservedBytes"], 512)
            self.assertEqual(denied["native"]["httpRequestSendsSettled"], 0)
            self.assertEqual(second["native"]["transport"], "pinned-loopback-tls-http1-fixture")
            self.assertEqual(second["native"]["ledger"]["unresolved"], [])
            self.assertIn("fixtureTLSLeafDER", json.loads(ledger.read_text()))
            for request in fixture.requests:
                self.assertNotIn(b"Authorization:", request)
                self.assertNotIn(b"Cookie:", request)

    def test_partial_tls_http_failure_explicit_retry_and_reopen_do_not_refund(self):
        ledger = self.directory / "partial-ledger.json"
        with self.fixture(responses=[PARTIAL, SUCCESS]) as fixture:
            failed = self.fetch(fixture.port, ledger)
            self.assertNotEqual(failed["error"], 0)
            self.assertEqual(failed["native"]["ledger"]["reservedBytes"], 256)
            self.assertEqual(failed["native"]["httpRequestSendsSettled"], 1)
            retried = self.fetch(fixture.port, ledger)
            self.assertEqual((retried["error"], retried["length"]), (0, 4))
            self.assertEqual(retried["native"]["ledger"]["reservedBytes"], 512)
            denied = self.fetch(fixture.port, ledger)
            self.assertNotEqual(denied["error"], 0)
            self.assertEqual((denied["native"]["started"], denied["native"]["httpRequestSendsSettled"]), (0, 0))
            self.assertEqual(len(fixture.requests), 2)

    def test_tls_failure_before_http_still_reserves_and_releases_exactly_once(self):
        ledger = self.directory / "trust-ledger.json"
        with self.fixture("other") as fixture:
            first, second, denied = [self.fetch(fixture.port, ledger) for _ in range(3)]
            for result in (first, second):
                self.assertNotEqual(result["error"], 0)
                self.assertEqual((result["native"]["started"], result["native"]["released"]), (1, 1))
                self.assertEqual((result["native"]["active"], result["native"]["httpRequestSendsSettled"]), (0, 0))
            self.assertEqual(denied["native"]["ledger"]["reservedBytes"], 512)
            self.assertEqual(denied["native"]["started"], 0)
            self.assertEqual(fixture.requests, [])
            self.assertEqual(fixture.accepted, 2)

    def test_changed_pin_or_invalid_configuration_never_resets_existing_ledger(self):
        ledger = self.directory / "pin-ledger.json"
        with self.fixture() as fixture:
            self.assertEqual(self.fetch(fixture.port, ledger)["error"], 0)
            before, accepted = ledger.read_bytes(), fixture.accepted
            for certificate in ("other", "invalid"):
                result = self.fetch(fixture.port, ledger, certificate=certificate)
                self.assertFalse(result["configured"])
                self.assertEqual(ledger.read_bytes(), before)
            self.assertEqual(fixture.accepted, accepted)
            for url in ("https://example.invalid:443/resource/tile/test", "https://192.168.1.1:443/resource/tile/test", f"http://127.0.0.1:{fixture.port}/resource/tile/test"):
                result = self.fetch(fixture.port, ledger, url=url)
                self.assertFalse(result["configured"])
                self.assertEqual(ledger.read_bytes(), before)

    def queue_scenario(self, mode):
        ledger = self.directory / (mode + ".json")
        with self.fixture(hold=True) as fixture:
            process = subprocess.Popen([
                str(self.queue_binary), f"https://127.0.0.1:{fixture.port}", str(ledger), mode,
                str(self.directory / "correct.der"),
            ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                def wait_until(predicate):
                    deadline = time.monotonic() + 6
                    while time.monotonic() < deadline:
                        if predicate():
                            return
                        self.assertIsNone(process.poll(), "TLS queue driver exited before checkpoint")
                        time.sleep(.01)
                    self.fail("TLS queue checkpoint deadline")

                checkpoint = Path(str(ledger) + ".checkpoint")
                wait_until(checkpoint.exists)
                wait_until(lambda: len(fixture.requests) == 4)
                before = json.loads(checkpoint.read_text())
                self.assertEqual((before["active"], before["started"], before["maxPending"]), (4, 4, 4))
                self.assertEqual(before["pending"], 3 if mode == "pending-cancel" else 4)
                self.assertEqual(before["ledger"]["reservedBytes"], 1024)
                if mode == "active-cancel":
                    Path(str(ledger) + ".cancel").write_text("cancel the owned active request")
                    after = Path(str(ledger) + ".after-cancel")
                    wait_until(after.exists)
                    value = json.loads(after.read_text())
                    self.assertEqual((value["active"], value["pending"], value["started"], value["released"]), (4, 3, 5, 1))
                    self.assertEqual(value["ledger"]["reservedBytes"], 1280)
                    wait_until(lambda: len(fixture.requests) == 5)
                fixture.release.set()
                output, error = process.communicate(timeout=10)
                self.assertEqual(process.returncode, 0, error)
                result = json.loads(output)
                native = result["native"]
                cancelled = {"pending-cancel": "4", "active-cancel": "0"}.get(mode)
                for key, value in result["results"].items():
                    self.assertEqual(value, {"error": -999, "length": 0} if key == cancelled else {"error": 0, "length": 4})
                admitted = 7 if mode == "pending-cancel" else 8
                self.assertEqual((native["active"], native["pending"], native["maxActive"], native["released"]), (0, 0, 4, admitted))
                self.assertEqual(native["httpRequestSendsSettled"], admitted)
                self.assertEqual(native["ledger"]["reservedBytes"], admitted * 256)
                self.assertEqual(native["ledger"]["unresolved"], [])
                self.assertEqual(len(fixture.requests), admitted)
                self.assertEqual(fixture.protocols, ["http/1.1"] * admitted)
                if mode != "active-cancel":
                    self.assertEqual(fixture.peak, 4)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.communicate()

    def test_tls_fifth_request_waits_until_one_body_finishes(self):
        self.queue_scenario("queue")

    def test_tls_pending_double_cancel_never_reserves_or_sends(self):
        self.queue_scenario("pending-cancel")

    def test_tls_active_double_cancel_releases_once_and_preserves_charge(self):
        self.queue_scenario("active-cancel")

    def test_tls_sigkill_preserves_unresolved_charge_in_a_new_process(self):
        # Actual Mac host SIGKILL/new process only: not phone, power-loss,
        # SDK retry, or resumption of the original eight logical operations.
        ledger = self.directory / "sigkill-ledger.json"
        checkpoint = Path(str(ledger) + ".checkpoint")
        processes = []
        with self.fixture(hold=True) as fixture:
            def start_driver():
                process = subprocess.Popen([
                    str(self.queue_binary), f"https://127.0.0.1:{fixture.port}", str(ledger), "queue",
                    str(self.directory / "correct.der"),
                ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                processes.append(process)
                return process

            def wait_until(predicate, process=None):
                deadline = time.monotonic() + 6
                while time.monotonic() < deadline:
                    if predicate():
                        return
                    if process is not None:
                        self.assertIsNone(process.poll(), "TLS restart driver exited before checkpoint")
                    time.sleep(.01)
                self.fail("TLS restart checkpoint deadline")

            def server_state(requests, active):
                with fixture.lock:
                    return len(fixture.requests) == requests and fixture.active == active

            try:
                first = start_driver()
                wait_until(checkpoint.exists, first)
                wait_until(lambda: server_state(4, 4), first)
                before = json.loads(checkpoint.read_text())
                saved = json.loads(ledger.read_text())
                self.assertEqual((before["active"], before["pending"], before["started"]), (4, 4, 4))
                self.assertEqual(before["ledger"], saved)
                self.assertEqual((saved["requests"], saved["tiles"], saved["reservedBytes"]), (4, 4, 1024))
                old_unresolved = list(saved["unresolved"])
                self.assertEqual(len(old_unresolved), 4)
                self.assertEqual(len(set(old_unresolved)), 4)
                identity_keys = ("schema", "origin", "maxRequests", "maxTiles", "maxReservedBytes",
                                 "reservationBytes", "fixtureTLSLeafDER")
                identity = {key: saved[key] for key in identity_keys}

                first.kill()
                first.communicate(timeout=3)
                self.assertEqual(first.returncode, -signal.SIGKILL)
                wait_until(lambda: server_state(4, 0))
                self.assertEqual(json.loads(ledger.read_text()), saved)
                self.assertEqual(len(fixture.requests), 4)

                # This marker belongs only to this suite; its absence ensures
                # the next readiness observation cannot use the killed driver.
                checkpoint.unlink()
                second = start_driver()
                self.assertNotEqual(first.pid, second.pid)
                wait_until(checkpoint.exists, second)
                wait_until(lambda: server_state(8, 4), second)
                reopened = json.loads(checkpoint.read_text())
                self.assertEqual((reopened["active"], reopened["pending"], reopened["started"]), (4, 4, 4))
                self.assertEqual((reopened["ledger"]["requests"], reopened["ledger"]["reservedBytes"]), (8, 2048))
                self.assertEqual(reopened["ledger"]["unresolved"][:4], old_unresolved)
                self.assertEqual(len(reopened["ledger"]["unresolved"]), 8)
                self.assertEqual({key: reopened["ledger"][key] for key in identity_keys}, identity)

                fixture.release.set()
                output, error = second.communicate(timeout=10)
                self.assertEqual(second.returncode, 0, error)
                result = json.loads(output)
                self.assertEqual(set(result["results"]), {str(i) for i in range(8)})
                self.assertTrue(all(value == {"error": 0, "length": 4} for value in result["results"].values()))
                native, final = result["native"], result["native"]["ledger"]
                self.assertEqual((native["started"], native["released"], native["httpRequestSendsSettled"]), (8, 8, 8))
                self.assertEqual((native["active"], native["pending"], native["maxActive"]), (0, 0, 4))
                self.assertEqual(native["acceptedBodyBytes"], 32)
                self.assertEqual((final["requests"], final["tiles"], final["reservedBytes"]), (12, 12, 3072))
                self.assertEqual(final["unresolved"], old_unresolved)
                self.assertEqual({key: final[key] for key in identity_keys}, identity)
                self.assertEqual(json.loads(ledger.read_text()), final)
                self.assertEqual(len(fixture.requests), 12)
                self.assertEqual(fixture.protocols, ["http/1.1"] * 12)
            finally:
                for process in processes:
                    if process.poll() is None:
                        process.kill()
                        process.communicate(timeout=3)


if __name__ == "__main__":
    unittest.main()
