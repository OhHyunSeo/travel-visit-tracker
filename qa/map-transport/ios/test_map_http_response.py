"""Exercise iOS's response parser directly on a Mac without sockets or devices."""

import base64
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


HERE = Path(__file__).resolve().parent
PARSER = HERE.parents[2] / "travel_visit_tracker/plugins/ios/TripPaintingMapHTTPResponse.swift"


def response(*fields, body=b"", status=b"HTTP/1.1 200 OK"):
    return b"\r\n".join((status, *fields, b"", b"")) + body


@unittest.skipUnless(sys.platform == "darwin", "Apple Foundation response parser")
class MapHTTPResponseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        temporary = tempfile.TemporaryDirectory(prefix="tp-map-http-response-")
        cls.addClassCleanup(temporary.cleanup)
        directory = Path(temporary.name)
        cls.binary = directory / "map-http-response-probe"
        subprocess.run(["xcrun", "swiftc", "-module-cache-path", str(directory / "modules"),
                        str(PARSER), str(HERE / "test-map-http-response.swift"), "-o", str(cls.binary)],
                       check=True, capture_output=True, text=True, timeout=90)

    def evaluate(self, maximum, *chunks):
        payload = [{"maximumBodyBytes": maximum,
                    "chunks": [base64.b64encode(chunk).decode("ascii") for chunk in chunks]}]
        run = subprocess.run([str(self.binary)], input=json.dumps(payload), text=True,
                             capture_output=True, check=True, timeout=10)
        return json.loads(run.stdout)[0]

    def test_fragmented_header_and_binary_body_with_eof_probe(self):
        body = b"\x00\xfe\r\n"
        raw = response(b"Content-Length: 4", b"Content-Type: application/octet-stream",
                       b"Set-Cookie: fixture-only=1", b"X-Fixture-Trace: removed", body=body)
        # Split inside every status token, field, terminator, and body byte.
        result = self.evaluate(len(body), *(raw[index:index + 1] for index in range(len(raw))))
        self.assertNotIn("rejectedAt", result)
        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(result["url"], "https://fixture.invalid/map")
        self.assertEqual(base64.b64decode(result["body"]), body)
        self.assertEqual(result["headers"]["content-type"], "application/octet-stream")
        self.assertNotIn("set-cookie", result["headers"])
        self.assertNotIn("x-fixture-trace", result["headers"])
        self.assertEqual(len(result["readLimits"]), len(raw) + 1)
        self.assertTrue(all(limit > 0 for limit in result["readLimits"]))

    def test_read_windows_clip_to_the_declared_body_and_probe_eof(self):
        head = response(b"Content-Length: 17000", b"Content-Encoding: Identity")
        first_read = head + b"a" * (512 - len(head))
        prefix_size = len(first_read) - len(head)
        final_read = b"c" * (17_000 - prefix_size - 16_384)
        result = self.evaluate(17_000, first_read, b"b" * 16_384, final_read)
        self.assertEqual(result["readLimits"], [512, 16_384, len(final_read), 1])
        self.assertEqual(result["terminalReadLimit"], 0)
        self.assertEqual(base64.b64decode(result["body"]), first_read[len(head):] + b"b" * 16_384 + final_read)
        self.assertNotIn("content-encoding", result["headers"])

    def test_zero_length_and_large_canonical_content_length(self):
        for body in (b"", b"tile" * 3_000):
            with self.subTest(body_bytes=len(body)):
                length = f"Content-Length: {len(body)}".encode("ascii")
                result = self.evaluate(max(1, len(body)), response(length, body=body))
                self.assertEqual(base64.b64decode(result["body"]), body)
                self.assertGreater(result["readLimits"][-1], 0)

    def test_requires_complete_header_and_exact_body_at_eof(self):
        for partial in (b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n",
                        response(b"Content-Length: 4", body=b"abc")):
            with self.subTest(partial=partial):
                result = self.evaluate(4, partial)
                self.assertEqual(result["rejectedAt"], "finish")
                self.assertNotIn("body", result)

    def test_rejects_tail_in_same_or_later_read(self):
        exact = response(b"Content-Length: 4", body=b"abcd")
        for chunks in ((exact + b"!",), (exact, b"!")):
            with self.subTest(reads=len(chunks)):
                result = self.evaluate(4, *chunks)
                self.assertEqual(result["rejectedAt"], "append")
                self.assertEqual(result["terminalReadLimit"], 0)
                self.assertNotIn("body", result)

    def test_rejects_unsupported_or_ambiguous_framing(self):
        examples = {
            "over budget": response(b"Content-Length: 5"),
            "missing length": response(b"Content-Type: application/octet-stream"),
            "noncanonical length": response(b"Content-Length: 04"),
            "length overflow": response(b"Content-Length: 99999999999999999999999999999999"),
            "redirect": response(b"Content-Length: 0", b"Location: https://fixture.invalid/other",
                                 status=b"HTTP/1.1 302 Found"),
            "unsupported version": response(b"Content-Length: 0", status=b"HTTP/1.0 200 OK"),
            "chunked": response(b"Content-Length: 0", b"Transfer-Encoding: chunked"),
            "compressed": response(b"Content-Length: 0", b"Content-Encoding: gzip"),
            "duplicate length": response(b"Content-Length: 0", b"content-length: 0"),
            "duplicate unrelated field": response(b"Content-Length: 0", b"X-Fixture: a", b"x-fixture: b"),
            "control in field": response(b"Content-Length: 0", b"X-Fixture: a\x00b"),
            "folded field": response(b"Content-Length: 0", b"X-Fixture: value", b" continuation"),
        }
        for label, raw in examples.items():
            with self.subTest(label=label):
                result = self.evaluate(4, raw)
                self.assertEqual(result["rejectedAt"], "append")
                self.assertNotIn("body", result)

    def test_header_bound_includes_the_terminator(self):
        fields = (b"Content-Length: 0",)
        prefix = b"X-Fixture: "
        unpadded = response(*fields, prefix)
        padding = b"a" * (8192 - len(unpadded))
        exact = response(*fields, prefix + padding)
        oversized = response(*fields, prefix + padding + b"a")
        self.assertEqual(len(exact), 8192)
        self.assertEqual(base64.b64decode(self.evaluate(4, exact)["body"]), b"")
        self.assertEqual(self.evaluate(4, oversized)["rejectedAt"], "append")
