"""macOS-native, loopback-only HTTP/1 experiment; no device/provider traffic."""
import json
from pathlib import Path
import socket
import select
import subprocess
import sys
import tempfile
import threading
import time
import unittest

ROOT = Path(__file__).resolve().parent


class RawFixture:
    def __init__(self, chunks, pause=0, hold=False):
        self.socket = socket.socket()
        try:
            self.socket.bind(("127.0.0.1", 0))
        except OSError:
            self.socket.close()
            raise
        self.socket.listen()
        self.socket.settimeout(0.1)
        self.port = self.socket.getsockname()[1]
        self.chunks, self.pause, self.hold = chunks, pause, hold
        self.requests = []
        self.active = self.peak = 0
        self.lock = threading.Lock()
        self.connections = []
        self.workers = []
        self.stopped = threading.Event()
        self.thread = threading.Thread(target=self.run)

    def __enter__(self):
        self.thread.start()
        return self

    def serve(self, connection):
        connection.settimeout(1)
        request = bytearray()
        try:
            while b"\r\n\r\n" not in request and len(request) < 4096:
                part = connection.recv(1024)
                if not part:
                    return
                request.extend(part)
            self.requests.append(bytes(request))
            with self.lock:
                self.active += 1
                self.peak = max(self.peak, self.active)
            if self.hold:
                self.stopped.wait(2)
                return
            for chunk in self.chunks:
                connection.sendall(chunk)
                if self.pause:
                    time.sleep(self.pause)
        except (OSError, TimeoutError):
            pass
        finally:
            with self.lock:
                if request:
                    self.active -= 1
            connection.close()

    def run(self):
        while not self.stopped.is_set():
            try:
                connection, _ = self.socket.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            self.connections.append(connection)
            thread = threading.Thread(target=self.serve, args=(connection,))
            self.workers.append(thread)
            thread.start()

    def __exit__(self, *_):
        self.stopped.set()
        self.socket.close()
        self.thread.join(3)
        for connection in self.connections:
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        for thread in self.workers:
            thread.join(3)


class QueueFixture(RawFixture):
    """No response bodies until the host has inspected the native wait queue."""
    def __init__(self):
        super().__init__([])
        self.release = threading.Event()

    def serve(self, connection):
        connection.settimeout(1)
        request = bytearray()
        registered = False
        try:
            while b"\r\n\r\n" not in request and len(request) < 4096:
                part = connection.recv(1024)
                if not part:
                    return
                request.extend(part)
            with self.lock:
                self.requests.append(bytes(request))
                self.active += 1
                self.peak = max(self.peak, self.active)
                registered = True
            while not self.release.wait(.01) and not self.stopped.is_set():
                readable, _, _ = select.select([connection], [], [], 0)
                if readable and not connection.recv(1):
                    return
            if not self.stopped.is_set():
                connection.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\ntest")
        except (OSError, TimeoutError):
            pass
        finally:
            if registered:
                with self.lock:
                    self.active -= 1
            connection.close()


@unittest.skipUnless(sys.platform == "darwin", "Apple Foundation/Network native host test")
class SingleExchangeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        build_root = ROOT / ".build"
        build_root.mkdir(exist_ok=True)
        cls.temporary = tempfile.TemporaryDirectory(prefix="http-exchange-", dir=build_root)
        cls.directory = Path(cls.temporary.name)
        cls.binary = cls.directory / "exchange-test"
        sdk = subprocess.check_output(["xcrun", "--sdk", "macosx", "--show-sdk-path"], text=True).strip()
        subprocess.run([
            "xcrun", "clang", "-fobjc-arc", "-fblocks", "-Wall", "-Wextra",
            "-Wno-unused-parameter", "-Wno-incompatible-pointer-types", "-Werror",
            "-isysroot", sdk, "-framework", "Foundation", "-framework", "Network", "-framework", "Security",
            str(ROOT / "test-http-exchange.m"), str(ROOT / "TPHTTPExchange.m"),
            str(ROOT / "TPTransport.m"), "-o", str(cls.binary),
        ], check=True, capture_output=True, text=True)
        cls.queue_binary = cls.directory / "queue-test"
        subprocess.run([
            "xcrun", "clang", "-fobjc-arc", "-fblocks", "-Wall", "-Wextra",
            "-Wno-unused-parameter", "-Wno-incompatible-pointer-types", "-Werror",
            "-isysroot", sdk, "-framework", "Foundation", "-framework", "Network", "-framework", "Security",
            str(ROOT / "test-transport-queue.m"), str(ROOT / "TPHTTPExchange.m"),
            str(ROOT / "TPTransport.m"), "-o", str(cls.queue_binary),
        ], check=True, capture_output=True, text=True)

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()  # Only this test's new binary directory.

    def fetch(self, port, timeout=1, cancellation=0, ledger="-", url=None, count=1):
        result = subprocess.run([
            str(self.binary), url or f"http://127.0.0.1:{port}/resource/tile/test",
            str(timeout), str(cancellation), str(ledger), str(count),
        ], check=True, capture_output=True, text=True, timeout=16)
        return json.loads(result.stdout)

    def test_fragmented_success_and_single_write(self):
        response = b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\ntest"
        with RawFixture([bytes([b]) for b in response]) as fixture:
            result = self.fetch(fixture.port)
            self.assertEqual((result["error"], result["length"], result["sends"]), (0, 4, 1))
            self.assertEqual(result["receivedHTTPBytes"], len(response))
            self.assertEqual(len(fixture.requests), 1)
            self.assertIn(b"User-Agent: TripPaintingMapTransportQA/1.0\r\n", fixture.requests[0])

    def test_fail_closed_response_shapes(self):
        responses = [
            b"HTTP/1.1 302 Found\r\nContent-Length: 0\r\nLocation: http://example.invalid/\r\n\r\n",
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r\ntest\r\n0\r\n\r\n",
            b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nContent-Encoding: gzip\r\n\r\ntest",
            b"HTTP/1.1 200 OK\r\nContent-Length: 257\r\n\r\n",
            b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\ncontent-length: 4\r\n\r\ntest",
            b"HTTP/1.1 200 OK\r\nContent-Length: 04\r\n\r\ntest",
            b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n bad: fold\r\n\r\ntest",
            b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nX-Long: " + b"x" * 8192 + b"\r\n\r\ntest",
            b"HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n",
            b"HTTP/1.1 200 OK\r\n\r\ntest",
            b"HTTP/1.1 200 OK\nX: y\r\nContent-Length: 4\r\n\r\ntest",
            b"HTTP/1.1 200 OK\rX: y\r\nContent-Length: 4\r\n\r\ntest",
            b"HTTP/1.1 200 OK\x00X: y\r\nContent-Length: 4\r\n\r\ntest",
        ]
        for response in responses:
            with self.subTest(response=response[:90]), RawFixture([response]) as fixture:
                result = self.fetch(fixture.port)
                self.assertNotEqual(result["error"], 0)
                self.assertEqual((result["length"], result["sends"]), (0, 1))
                self.assertEqual(len(fixture.requests), 1)

    def test_eof_cut_does_not_retry(self):
        for response in [b"", b"HTTP/1.1 200", b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\nte"]:
            with self.subTest(response=response), RawFixture([response]) as fixture:
                result = self.fetch(fixture.port)
                time.sleep(0.2)
                self.assertNotEqual(result["error"], 0)
                self.assertEqual((result["length"], result["sends"]), (0, 1))
                self.assertEqual(len(fixture.requests), 1)

    def test_zero_and_maximum_bodies(self):
        for size in [0, 256]:
            with self.subTest(size=size), RawFixture([
                f"HTTP/1.1 200 OK\r\nContent-Length: {size}\r\n\r\n".encode(), b"x" * size,
            ]) as fixture:
                result = self.fetch(fixture.port)
                self.assertEqual((result["error"], result["length"], result["sends"]), (0, size, 1))

    def test_extra_and_late_body_refused(self):
        for pause in [0, 0.04]:
            with self.subTest(pause=pause), RawFixture([
                b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\ntest", b"extra",
            ], pause=pause) as fixture:
                result = self.fetch(fixture.port)
                self.assertNotEqual(result["error"], 0)
                self.assertEqual(result["length"], 0)

    def test_timeout_and_cancellation(self):
        for cancellation in [0, 0.08]:
            with self.subTest(cancellation=cancellation), RawFixture([], hold=True) as fixture:
                begin = time.monotonic()
                result = self.fetch(fixture.port, timeout=0.3, cancellation=cancellation)
                self.assertLess(time.monotonic() - begin, 1.5)
                self.assertEqual(result["error"], 10 if cancellation else 3)
                self.assertEqual((result["length"], result["sends"]), (0, 1))
                self.assertEqual(len(fixture.requests), 1)

    def test_public_tls_and_unsafe_paths_refused(self):
        for url in ["http://8.8.8.8:80/resource/tile/test", "https://127.0.0.1:443/resource/tile/test", "http://127.0.0.1:80/stats", "http://user:pass@127.0.0.1:80/resource/tile/test"]:
            with self.subTest(url=url):
                result = self.fetch(1, url=url)
                self.assertEqual((result["error"], result["sends"]), (1, 0))

    def test_durable_gate_refuses_third_attempt_after_reopen(self):
        ledger = self.directory / "ledger.json"
        with RawFixture([b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\ntest"]) as fixture:
            first, second, third = [self.fetch(fixture.port, ledger=ledger) for _ in range(3)]
            self.assertEqual((first["error"], second["error"]), (0, 0))
            self.assertNotEqual(third["error"], 0)
            self.assertEqual(len(fixture.requests), 2)
            self.assertEqual(third["native"]["ledger"]["reservedBytes"], 512)
            self.assertEqual(third["native"]["started"], 0)
            self.assertEqual(first["native"]["httpRequestSendsSettled"], 1)
            self.assertNotIn(b"Authorization:", fixture.requests[0])
            self.assertNotIn(b"Cookie:", fixture.requests[0])

    def test_failed_exchange_stays_charged_across_processes(self):
        ledger = self.directory / "failure-ledger.json"
        with RawFixture([b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\nte"]) as fixture:
            failed = self.fetch(fixture.port, ledger=ledger)
            self.assertNotEqual(failed["error"], 0)
            self.assertEqual(failed["native"]["ledger"]["reservedBytes"], 256)
            self.assertEqual(len(fixture.requests), 1)
            fixture.chunks = [b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\ntest"]
            retry = self.fetch(fixture.port, ledger=ledger)
            self.assertEqual(retry["error"], 0)
            self.assertEqual(retry["native"]["ledger"]["reservedBytes"], 512)
            self.assertEqual(retry["native"]["ledger"]["unresolved"], [])
            self.assertEqual(len(fixture.requests), 2)
            denied = self.fetch(fixture.port, ledger=ledger)
            self.assertNotEqual(denied["error"], 0)
            self.assertEqual(denied["native"]["ledger"]["reservedBytes"], 512)
            self.assertEqual(denied["native"]["httpRequestSendsSettled"], 0)
            self.assertEqual(len(fixture.requests), 2)

    def test_global_gate_holds_four_until_eof(self):
        ledger = self.directory / "batch-ledger.json"
        with RawFixture([
            b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\n", b"test",
        ], pause=0.06) as fixture:
            result = self.fetch(fixture.port, ledger=ledger, count=12)
            self.assertEqual(len(result["results"]), 12)
            self.assertTrue(all(r == {"error": 0, "length": 4} for r in result["results"]))
            self.assertEqual(result["native"]["maxActive"], 4)
            self.assertEqual(fixture.peak, 4)
            self.assertEqual(result["native"]["httpRequestSendsSettled"], 12)
            self.assertEqual(result["native"]["ledger"]["reservedBytes"], 12 * 256)
            self.assertEqual(result["native"]["ledger"]["unresolved"], [])

    def queue_scenario(self, mode):
        ledger = self.directory / (mode + ".json")
        with QueueFixture() as fixture:
            process = subprocess.Popen([
                str(self.queue_binary), f"http://127.0.0.1:{fixture.port}", str(ledger), mode,
            ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                def wait_until(predicate):
                    end = time.monotonic() + 5
                    while time.monotonic() < end:
                        if predicate():
                            return
                        self.assertIsNone(process.poll(), "native queue driver exited before checkpoint")
                        time.sleep(.01)
                    self.fail("native queue checkpoint deadline")

                checkpoint = Path(str(ledger) + ".checkpoint")
                wait_until(checkpoint.exists)
                wait_until(lambda: len(fixture.requests) == 4)
                before = json.loads(checkpoint.read_text())
                self.assertEqual((before["active"], before["started"], before["maxPending"]), (4, 4, 4))
                self.assertEqual(before["ledger"]["reservedBytes"], 1024)
                self.assertEqual(before["pending"], 3 if mode == "pending-cancel" else 4)
                self.assertEqual({r.split(b" ")[1] for r in fixture.requests},
                                 {f"/resource/tile/q_{i}".encode() for i in range(4)})
                # The server has four held bodies; no fifth exchange has arrived.
                if mode == "active-cancel":
                    Path(str(ledger) + ".cancel").write_text("cancel first active task")
                    after = Path(str(ledger) + ".after-cancel")
                    wait_until(after.exists)
                    value = json.loads(after.read_text())
                    self.assertEqual((value["active"], value["pending"], value["started"], value["released"]), (4, 3, 5, 1))
                    self.assertEqual(value["ledger"]["reservedBytes"], 1280)
                    wait_until(lambda: len(fixture.requests) == 5)
                fixture.release.set()
                output, error = process.communicate(timeout=8)
                self.assertEqual(process.returncode, 0, error)
                result = json.loads(output)
                native = result["native"]
                cancelled = {"pending-cancel": "4", "active-cancel": "0"}.get(mode)
                for key, value in result["results"].items():
                    self.assertEqual(value, {"error": -999, "length": 0} if key == cancelled else {"error": 0, "length": 4})
                admitted = 7 if mode == "pending-cancel" else 8
                self.assertEqual(len(fixture.requests), admitted)
                self.assertEqual((native["active"], native["pending"], native["maxActive"], native["released"]), (0, 0, 4, admitted))
                self.assertEqual(native["httpRequestSendsSettled"], admitted)
                self.assertEqual(native["ledger"]["reservedBytes"], admitted * 256)
                self.assertEqual(native["ledger"]["unresolved"], [])
                self.assertEqual(native["cancelledPending"], int(mode == "pending-cancel"))
                self.assertEqual(native["cancelledActive"], int(mode == "active-cancel"))
                if mode != "active-cancel":
                    self.assertEqual(fixture.peak, 4)
                if mode == "pending-cancel":
                    self.assertNotIn(b"/resource/tile/q_4", [r.split(b" ")[1] for r in fixture.requests])
            finally:
                if process.poll() is None:
                    process.kill()
                    process.communicate()

    def test_fifth_exchange_waits_before_any_held_body_finishes(self):
        self.queue_scenario("queue")

    def test_pending_double_cancel_never_sends_or_reserves(self):
        self.queue_scenario("pending-cancel")

    def test_active_double_cancel_releases_once_and_preserves_charge(self):
        self.queue_scenario("active-cancel")


if __name__ == "__main__":
    unittest.main()
