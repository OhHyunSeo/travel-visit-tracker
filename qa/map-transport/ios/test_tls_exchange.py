"""Mac loopback TLS/ALPN probes, not SDK/phone/HTTP2/provider acceptance."""
import json
from pathlib import Path
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import unittest

ROOT = Path(__file__).resolve().parent


class TLSFixture:
    def __init__(self, certificate, key, protocols=("http/1.1",), response=None, handshake_hold=False):
        self.context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self.context.minimum_version = ssl.TLSVersion.TLSv1_2
        self.context.load_cert_chain(certificate, key)
        self.context.set_alpn_protocols(list(protocols))
        self.socket = socket.socket()
        self.socket.bind(("127.0.0.1", 0))
        self.socket.listen()
        self.socket.settimeout(.1)
        self.port = self.socket.getsockname()[1]
        self.response = response if response is not None else b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\ntest"
        self.handshake_hold = handshake_hold
        self.requests, self.protocols, self.connections, self.workers = [], [], [], []
        self.accepted = 0
        self.stopped = threading.Event()
        self.thread = threading.Thread(target=self.run)

    def __enter__(self):
        self.thread.start()
        return self

    def run(self):
        while not self.stopped.is_set():
            try:
                connection, _ = self.socket.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            self.accepted += 1
            self.connections.append(connection)
            worker = threading.Thread(target=self.serve, args=(connection,))
            self.workers.append(worker)
            worker.start()

    def serve(self, connection):
        connection.settimeout(1)
        wrapped = None
        try:
            if self.handshake_hold:
                self.stopped.wait(2)
                return
            wrapped = self.context.wrap_socket(connection, server_side=True)
            self.protocols.append(wrapped.selected_alpn_protocol())
            request = bytearray()
            while b"\r\n\r\n" not in request and len(request) < 4096:
                body = wrapped.recv(1024)
                if not body:
                    return
                request.extend(body)
            self.requests.append(bytes(request))
            wrapped.sendall(self.response)
            # Send TLS close_notify so EOF is an authenticated record boundary.
            wrapped.unwrap().close()
        except (OSError, TimeoutError):
            pass
        finally:
            if wrapped:
                wrapped.close()
            connection.close()

    def __exit__(self, *_):
        self.stopped.set()
        self.socket.close()
        self.thread.join(3)
        for connection in self.connections:
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        for worker in self.workers:
            worker.join(3)
            if worker.is_alive():
                raise RuntimeError("Owned TLS fixture worker did not stop")


@unittest.skipUnless(sys.platform == "darwin", "Apple Foundation/Network/Security native TLS host test")
class TLSExchangeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        build = ROOT / ".build"
        build.mkdir(exist_ok=True)
        cls.temporary = tempfile.TemporaryDirectory(prefix="tls-exchange-", dir=build)
        cls.directory = Path(cls.temporary.name)
        cls.binary = cls.directory / "tls-test"
        sdk = subprocess.check_output(["xcrun", "--sdk", "macosx", "--show-sdk-path"], text=True).strip()
        try:
            subprocess.run([
                "xcrun", "clang", "-fobjc-arc", "-fblocks", "-Wall", "-Wextra", "-Werror",
                "-Wno-unused-parameter", "-Wno-incompatible-pointer-types", "-isysroot", sdk,
                "-framework", "Foundation", "-framework", "Network", "-framework", "Security",
                str(ROOT / "test-tls-exchange.m"), str(ROOT / "TPHTTPExchange.m"), "-o", str(cls.binary),
            ], check=True, capture_output=True, text=True)
            for name, san in (("correct", "IP:127.0.0.1"), ("other", "IP:127.0.0.1"), ("wrong-host", "DNS:example.invalid")):
                cls.make_certificate(name, san)
            cls.make_issued_certificate()
            (cls.directory / "invalid.der").write_bytes(b"invalid synthetic DER")
            (cls.directory / "empty.der").write_bytes(b"")
            (cls.directory / "oversized.der").write_bytes(b"x" * 16385)
        except Exception:
            cls.temporary.cleanup()
            raise

    @classmethod
    def make_certificate(cls, name, san):
        config = cls.directory / (name + ".cnf")
        config.write_text("[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=Loopback QA\n[ext]\nsubjectAltName=" + san + "\nbasicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n")
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-config", str(config), "-keyout", str(cls.directory / (name + ".key")), "-out", str(cls.directory / (name + ".pem"))], check=True, capture_output=True)
        subprocess.run(["openssl", "x509", "-in", str(cls.directory / (name + ".pem")), "-outform", "DER", "-out", str(cls.directory / (name + ".der"))], check=True, capture_output=True)

    @classmethod
    def make_issued_certificate(cls):
        cls.make_certificate("anchor", "IP:127.0.0.1")
        config = cls.directory / "anchor.cnf"
        config.write_text(config.read_text().replace("CN=Loopback QA", "CN=Loopback QA Anchor").replace("CA:false", "CA:true").replace("digitalSignature,keyEncipherment", "digitalSignature,keyCertSign,cRLSign"))
        subprocess.run(["openssl", "req", "-x509", "-new", "-key", str(cls.directory / "anchor.key"), "-days", "1", "-config", str(config), "-out", str(cls.directory / "anchor.pem")], check=True, capture_output=True)
        subprocess.run(["openssl", "x509", "-in", str(cls.directory / "anchor.pem"), "-outform", "DER", "-out", str(cls.directory / "anchor.der")], check=True, capture_output=True)
        issued = cls.directory / "issued.cnf"
        issued.write_text((cls.directory / "correct.cnf").read_text().replace("CN=Loopback QA", "CN=Loopback QA Leaf"))
        subprocess.run(["openssl", "req", "-new", "-newkey", "rsa:2048", "-nodes", "-config", str(issued), "-keyout", str(cls.directory / "issued.key"), "-out", str(cls.directory / "issued.csr")], check=True, capture_output=True)
        subprocess.run(["openssl", "x509", "-req", "-in", str(cls.directory / "issued.csr"), "-CA", str(cls.directory / "anchor.pem"), "-CAkey", str(cls.directory / "anchor.key"), "-set_serial", "2", "-days", "1", "-extfile", str(issued), "-extensions", "ext", "-out", str(cls.directory / "issued.pem")], check=True, capture_output=True)
        leaf = cls.directory / "issued.pem"
        leaf.write_bytes(leaf.read_bytes() + (cls.directory / "anchor.pem").read_bytes())

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()  # Only this suite's fresh certificate/key/binary directory.

    def fixture(self, name="correct", **kwargs):
        return TLSFixture(self.directory / (name + ".pem"), self.directory / (name + ".key"), **kwargs)

    def fetch(self, port, name="correct", url=None, timeout=1.5, cancellation=0):
        result = subprocess.run([str(self.binary), url or f"https://127.0.0.1:{port}/resource/tile/test", str(self.directory / (name + ".der")), str(timeout), str(cancellation)], check=True, capture_output=True, text=True, timeout=10)
        value = json.loads(result.stdout)
        self.assertEqual(value["completions"], 1)
        return value

    def test_trusted_leaf_hostname_and_single_http1_write(self):
        with self.fixture() as fixture:
            result = self.fetch(fixture.port)
            self.assertEqual((result["error"], result["length"], result["sends"]), (0, 4, 1))
            self.assertTrue(result["trustAccepted"])
            self.assertEqual(result["alpn"], "http/1.1")
            self.assertEqual(fixture.protocols, ["http/1.1"])
            self.assertEqual(len(fixture.requests), 1)
            self.assertIn(b"User-Agent: TripPaintingMapTransportQA/1.0\r\n", fixture.requests[0])
            self.assertNotIn(b"Authorization:", fixture.requests[0])
            self.assertNotIn(b"Cookie:", fixture.requests[0])

    def test_wrong_leaf_or_hostname_never_sends_http(self):
        for server, trusted in (("other", "correct"), ("wrong-host", "wrong-host")):
            with self.subTest(server=server), self.fixture(server) as fixture:
                result = self.fetch(fixture.port, trusted)
                self.assertNotEqual(result["error"], 0)
                self.assertEqual((result["length"], result["sends"]), (0, 0))
                self.assertFalse(result["trustAccepted"])
                self.assertEqual(fixture.requests, [])

    def test_trusted_ca_chain_does_not_replace_exact_leaf_pin(self):
        with self.fixture("issued") as fixture:
            result = self.fetch(fixture.port, "anchor")
            self.assertTrue(result["chainTrusted"])
            self.assertFalse(result["trustAccepted"])
            self.assertNotEqual(result["error"], 0)
            self.assertEqual((result["length"], result["sends"]), (0, 0))
            self.assertEqual(fixture.requests, [])

    def test_missing_or_negotiated_h2_alpn_refused_before_http(self):
        for protocols in ((), ("h2",)):
            with self.subTest(protocols=protocols), self.fixture(protocols=protocols) as fixture:
                result = self.fetch(fixture.port)
                self.assertEqual((result["error"], result["sends"], result["length"]), (11, 0, 0))
                self.assertTrue(result["trustAccepted"])
                self.assertEqual(result["alpn"], "h2" if protocols else "none")
                self.assertEqual(fixture.protocols, ["h2" if protocols else None])
                self.assertEqual(fixture.requests, [])

    def test_invalid_der_public_dns_lan_and_plaintext_refused_before_connect(self):
        with self.fixture() as fixture:
            local = f"https://127.0.0.1:{fixture.port}/resource/tile/test"
            attempts = [(local, name) for name in ("invalid", "empty", "oversized")]
            attempts += [(url, "correct") for url in ("https://example.invalid:443/resource/tile/test", "https://8.8.8.8:443/resource/tile/test", "https://192.168.1.1:443/resource/tile/test", f"http://127.0.0.1:{fixture.port}/resource/tile/test")]
            for url, name in attempts:
                with self.subTest(url=url):
                    result = self.fetch(fixture.port, name, url=url)
                    self.assertEqual((result["error"], result["sends"]), (1, 0))
            self.assertEqual(fixture.accepted, 0)

    def test_handshake_deadline_and_double_cancel_complete_once(self):
        for cancellation in (0, .08):
            with self.subTest(cancellation=cancellation), self.fixture(handshake_hold=True) as fixture:
                start = time.monotonic()
                result = self.fetch(fixture.port, timeout=.25, cancellation=cancellation)
                self.assertLess(time.monotonic() - start, 1.5)
                self.assertEqual(result["error"], 10 if cancellation else 3)
                self.assertEqual((result["sends"], result["length"]), (0, 0))
                self.assertEqual(fixture.requests, [])

    def test_authenticated_tls_still_rejects_partial_and_extra_http_body_without_replay(self):
        for response in (b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\nte", b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\ntestextra"):
            with self.subTest(response=response), self.fixture(response=response) as fixture:
                result = self.fetch(fixture.port)
                self.assertNotEqual(result["error"], 0)
                self.assertEqual((result["length"], result["sends"]), (0, 1))
                self.assertEqual(len(fixture.requests), 1)


if __name__ == "__main__":
    unittest.main()
