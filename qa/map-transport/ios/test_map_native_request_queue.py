"""Check the bounded Swift queue with a loopback-only server and real SQLite ledger."""

from contextlib import contextmanager
import itertools
import json
import os
from pathlib import Path
import select
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.parse import quote, urlsplit

from test_http_exchange import QueueFixture
from test_map_request_scope import APP, GENERATOR, HERE


class Probe:
    def __init__(self, process):
        self.process = process
        self.buffer = bytearray()

    def send(self, payload):
        self.process.stdin.write(json.dumps(payload).encode() + b"\n")
        self.process.stdin.flush()

    def receive(self):
        deadline = time.monotonic() + 5
        while b"\n" not in self.buffer:
            left = max(0, deadline - time.monotonic())
            if not select.select([self.process.stdout], [], [], left)[0]:
                raise AssertionError("no native queue event")
            chunk = os.read(self.process.stdout.fileno(), 4096)
            if not chunk:
                raise AssertionError("the queue probe exited before its next event")
            self.buffer.extend(chunk)
        line, _, tail = self.buffer.partition(b"\n")
        self.buffer[:] = tail
        return json.loads(line)

    def finish(self):
        self.process.stdin.close()
        if self.process.wait(timeout=5) != 0:
            raise AssertionError(f"native queue probe exited {self.process.returncode}")
        if self.buffer or self.process.stdout.read():
            raise AssertionError("unexpected events after the last expected completion")


@unittest.skipUnless(sys.platform == "darwin", "Apple Foundation/Network native queue check")
class MapNativeRequestQueueTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        temporary = tempfile.TemporaryDirectory(prefix="tp-native-map-queue-")
        cls.addClassCleanup(temporary.cleanup)
        directory = Path(temporary.name)
        cls.binary = directory / "native-map-queue-probe"
        sources = APP / "plugins/ios"
        subprocess.run([
            "xcrun", "swiftc", "-swift-version", "6", "-D", "TP_MAP_TRANSPORT_FIXTURE",
            "-module-cache-path", str(directory / "modules"),
            str(sources / "TripPaintingMapRequestScope.swift"),
            str(sources / "TripPaintingMapRequestBudget.swift"),
            str(sources / "TripPaintingMapHTTPResponse.swift"),
            str(sources / "TripPaintingMapHTTPExchange.swift"),
            str(sources / "TripPaintingMapRequestQueue.swift"),
            str(HERE / "test-map-native-request-queue.swift"),
            "-framework", "Network", "-framework", "Security", "-o", str(cls.binary),
        ], check=True, timeout=90)
        case = json.loads(subprocess.check_output(["node", "--import", "tsx", "--input-type=module", "-e", GENERATOR],
                                                 cwd=APP, text=True, timeout=30))[0]
        scope = json.loads(case["scope"])
        template = scope["resources"]["vector"]
        tiles = (
            template.format(z=tile["zoom"], x=x, y=y)
            for tile in scope["plan"]["tileRanges"] if tile["source"] == "vector"
            for x in range(tile["minX"], tile["maxX"] + 1)
            for y in range(tile["minY"], tile["maxY"] + 1)
        )
        cls.payload = {**case, "tiles": list(itertools.islice(tiles, 7))}
        if len(cls.payload["tiles"]) != 7:
            raise AssertionError("fixture scope is missing distinct vector tile URLs")

    @contextmanager
    def fixture(self):
        with tempfile.TemporaryDirectory(prefix="tp-native-map-queue-ledger-") as directory, QueueFixture() as server:
            with subprocess.Popen([str(self.binary), str(server.port), directory],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE) as process:
                probe = Probe(process)
                probe.send(self.payload)
                try:
                    yield probe, server, Path(directory) / "request-budget-v1.sqlite"
                    probe.finish()
                finally:
                    if process.poll() is None:
                        process.kill()
                        process.wait(timeout=5)

    def checkpoint(self, probe, charges, **command):
        probe.send(command)
        self.assertEqual(probe.receive(), {"event": "checkpoint", "charges": charges})

    def terminal(self, number, error=None):
        event = {"event": "terminal", "number": number}
        if error is not None:
            return {**event, "error": error}
        return {**event, "status": 200, "sends": 1, "body": "test"}

    def wait_server(self, server, arrivals, active):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            with server.lock:
                actual = (len(server.requests), server.active)
                if actual == (arrivals, active):
                    return list(server.requests)
            time.sleep(.01)
        self.fail(f"server arrivals/active {actual} != {(arrivals, active)}")

    def wire_path(self, request):
        line, *headers = request.split(b"\r\n")
        self.assertCountEqual(headers, [
            b"Host: tiles.openfreemap.org",
            b"User-Agent: TripPaintingOfflineMaps (+https://github.com/OhHyunSeo/travel-visit-tracker)",
            b"Accept-Encoding: identity", b"Connection: close", b"", b"",
        ])
        method, path, protocol = line.split(b" ")
        self.assertEqual((method, protocol), (b"GET", b"HTTP/1.1"))
        return path.decode()

    def charges(self, ledger):
        with sqlite3.connect(ledger) as database:
            return database.execute("SELECT tile_attempts, reserved_bytes FROM request_budget").fetchone()

    def test_prepared_route_rewrites_only_validated_resources_and_reaches_the_queue(self):
        scope = json.loads(self.payload["scope"])
        resources = scope["resources"]
        root = (f"https://offline-style.trip-painting.invalid/v2/{scope['operationId']}/"
                f"{scope['localStyleSha256']}")

        def alias(address):
            return root + "/resource" + urlsplit(address).path

        expected_style = json.loads(self.payload["style"])
        expected_style["glyphs"] = alias(resources["glyphs"])
        expected_style["sprite"] = alias(resources["sprite"])
        expected_style["sources"]["openmaptiles"]["tiles"] = [alias(resources["vector"])]
        expected_style["sources"]["ne2_shaded"]["tiles"] = [alias(resources["raster"])]

        vector = self.payload["tiles"][0]
        vector_range = next(item for item in scope["plan"]["tileRanges"] if item["source"] == "vector")
        raster_range = next(item for item in scope["plan"]["tileRanges"] if item["source"] == "raster")
        raster = resources["raster"].format(z=raster_range["zoom"], x=raster_range["minX"], y=raster_range["minY"])
        glyph = resources["glyphs"].format(fontstack=quote(resources["fontStacks"][0]), range="0-255")
        sprite = resources["sprite"] + ".json"
        outside_scope = resources["vector"].format(z=vector_range["zoom"], x=vector_range["minX"] - 1,
                                                     y=vector_range["minY"])
        other_operation = "7729af8d-20ac-42db-ae59-3773944d5530"
        rejected = [
            {"address": vector},
            {"address": alias(vector).replace(scope["operationId"], other_operation)},
            {"address": alias(vector).replace(scope["localStyleSha256"], "f" * 64)},
            {"address": alias(vector) + "?extra=1"},
            {"address": alias(vector) + "#fragment"},
            {"address": alias(outside_scope)},
            {"address": alias(vector), "method": "POST"},
            {"address": alias(vector), "body": "fixture request body"},
        ]

        with self.fixture() as (probe, server, ledger):
            probe.send({"describeRoute": True})
            route = probe.receive()
            self.assertEqual(route["event"], "route")
            self.assertEqual(route["styleURL"], root + "/style.json")
            self.assertEqual(json.loads(route["style"]), expected_style)
            self.assertEqual(probe.receive(), {"event": "checkpoint", "charges": [0, 0]})

            for number, request in enumerate(rejected, 10):
                with self.subTest(rejected=number):
                    probe.send({"routedRequest": {"number": number, **request}})
                    self.assertEqual(probe.receive(), {"event": "routeRejected", "number": number})
                    self.assertEqual(probe.receive(), {"event": "checkpoint", "charges": [0, 0]})
            self.wait_server(server, 0, 0)
            self.assertEqual(self.charges(ledger), (0, 0))

            admitted = [vector, raster, glyph, sprite]
            for number, address in enumerate(admitted, 1):
                self.checkpoint(probe, [min(number, 2), 256 * number],
                                routedRequest={"number": number, "address": alias(address)})
            requests = self.wait_server(server, 4, 4)
            self.assertCountEqual(map(self.wire_path, requests), [urlsplit(address).path for address in admitted])
            server.release.set()
            self.assertCountEqual([probe.receive() for _ in admitted],
                                  [self.terminal(number) for number in range(1, 5)])
            self.wait_server(server, 4, 0)
            self.assertEqual(self.charges(ledger), (2, 1024))

    def test_unreserved_pending_cancellation_then_fifo_after_terminal(self):
        expected_paths = [urlsplit(url).path for url in self.payload["tiles"]]
        with self.fixture() as (probe, server, ledger):
            self.checkpoint(probe, [4, 1024], add=list(range(1, 8)))
            initial_requests = self.wait_server(server, 4, 4)
            self.assertCountEqual(map(self.wire_path, initial_requests), expected_paths[:4])
            self.checkpoint(probe, [4, 1024], cancel=5)
            self.assertEqual(probe.receive(), self.terminal(5, "cancelled"))
            self.assertEqual(self.charges(ledger), (4, 1024))

            # The checkpoint is emitted in the same queue turn as cancellation, before transport can settle.
            self.checkpoint(probe, [4, 1024], cancel=1)
            self.assertEqual(probe.receive(), self.terminal(1, "cancelled"))
            fifth = self.wait_server(server, 5, 4)[-1]
            self.assertEqual(self.wire_path(fifth), expected_paths[5])
            self.assertEqual(self.charges(ledger), (5, 1280))

            self.checkpoint(probe, [5, 1280], cancel=2)
            self.assertEqual(probe.receive(), self.terminal(2, "cancelled"))
            sixth = self.wait_server(server, 6, 4)[-1]
            self.assertEqual(self.wire_path(sixth), expected_paths[6])
            self.assertEqual(self.charges(ledger), (6, 1536))
            server.release.set()
            self.assertCountEqual([probe.receive() for _ in range(4)],
                                  [self.terminal(number) for number in (3, 4, 6, 7)])
            self.wait_server(server, 6, 0)
            self.assertEqual(self.charges(ledger), (6, 1536))

    def test_overflow_validation_and_close_never_send_waiting_requests(self):
        with self.fixture() as (probe, server, ledger):
            self.checkpoint(probe, [4, 1024], add=list(range(1, 69)))
            self.wait_server(server, 4, 4)
            self.checkpoint(probe, [4, 1024], add=[69])
            self.assertEqual(probe.receive(), self.terminal(69, "queueFull"))
            self.checkpoint(probe, [4, 1024], add=[70], outsideScope=True)
            self.assertEqual(probe.receive(), self.terminal(70, "outsideScope"))
            self.checkpoint(probe, [4, 1024], add=[71], bytes=0)
            self.assertEqual(probe.receive(), self.terminal(71, "invalidReservation"))

            self.checkpoint(probe, [4, 1024], close=True)
            self.assertCountEqual([probe.receive() for _ in range(68)],
                                  [self.terminal(number, "cancelled") for number in range(1, 69)])
            self.wait_server(server, 4, 0)
            self.checkpoint(probe, [4, 1024], add=[72])
            self.assertEqual(probe.receive(), self.terminal(72, "closed"))
            self.assertEqual(self.charges(ledger), (4, 1024))

    def test_pending_fails_closed_when_the_reserved_body_budget_is_exhausted(self):
        with self.fixture() as (probe, server, ledger):
            self.checkpoint(probe, [4, 50_000_000], add=list(range(1, 5)), bytes=12_500_000)
            self.wait_server(server, 4, 4)
            self.checkpoint(probe, [4, 50_000_000], add=[5])
            self.checkpoint(probe, [4, 50_000_000], cancel=1)
            self.assertCountEqual([probe.receive(), probe.receive()],
                                  [self.terminal(1, "cancelled"), self.terminal(5, "exhausted")])
            self.wait_server(server, 4, 3)
            server.release.set()
            self.assertCountEqual([probe.receive() for _ in range(3)],
                                  [self.terminal(number) for number in (2, 3, 4)])
            self.wait_server(server, 4, 0)
            self.assertEqual(self.charges(ledger), (4, 50_000_000))
