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
            str(sources / "TripPaintingMapQueuedResource.swift"),
            str(sources / "TripPaintingOfflineMapRequestGuard.swift"),
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

    def operation_style_address(self):
        scope = json.loads(self.payload["scope"])
        return (f"https://offline-style.trip-painting.invalid/v2/{scope['operationId']}/"
                f"{scope['localStyleSha256']}/style.json")

    def resource_requests(self, *numbers):
        prefix = self.operation_style_address().removesuffix("/style.json") + "/resource"
        return [{"number": number, "address": prefix + urlsplit(self.payload["tiles"][number - 1]).path}
                for number in numbers]

    def resource_starts(self, probe, requests, charges, accepted=True):
        probe.send({"startResources": requests})
        for request in requests:
            self.assertEqual(probe.receive(), {"event": "resourceStart", "number": request["number"],
                                               "accepted": accepted})
        self.assertEqual(probe.receive(), {"event": "checkpoint", "charges": charges})

    def resource_result(self, request):
        return {"event": "resourceResult", **request, "status": 200, "length": "4", "body": "test"}

    def activate_session(self, probe):
        probe.send({"blockStyleRequests": True, "registerActiveOperation": True})
        self.assertEqual(probe.receive(), {"event": "registeredActiveOperation",
                                           "address": self.operation_style_address()})
        self.assertEqual(probe.receive(), {"event": "checkpoint", "charges": [0, 0]})

    def session_starts(self, probe, requests, charges):
        probe.send({"startSessionRequests": requests})
        for request in requests:
            self.assertEqual(probe.receive(), {"event": "sessionStarted", "number": request["number"]})
        self.assertEqual(probe.receive(), {"event": "checkpoint", "charges": charges})

    def session_error(self, number, code):
        return {"event": "sessionResult", "number": number, "bodyBytes": 0,
                "errorDomain": "NSURLErrorDomain", "errorCode": code}

    def test_urlsession_active_operation_serves_style_and_only_its_resource_aliases(self):
        style_address = self.operation_style_address()
        allowed = self.resource_requests(1)[0]
        provider = self.payload["tiles"][0]
        operation_id = json.loads(self.payload["scope"])["operationId"]
        unrelated = allowed["address"].replace(operation_id, "7729af8d-20ac-42db-ae59-3773944d5530")
        with self.fixture() as (probe, server, ledger):
            self.activate_session(probe)
            self.checkpoint(probe, [0, 0], fetchStyle=style_address)
            style = probe.receive()
            self.assertEqual((style["event"], style["address"], style["status"], style["mimeType"]),
                             ("styleResult", style_address, 200, "application/json"))
            self.assertEqual(style["length"], str(len(style["body"].encode())))
            vector = json.loads(self.payload["scope"])["resources"]["vector"]
            path_prefix = style_address.removesuffix("/style.json") + "/resource"
            self.assertEqual(json.loads(style["body"])["sources"]["openmaptiles"]["tiles"],
                             [path_prefix + urlsplit(vector).path])

            denied = [{"number": 2, "address": provider}, {"number": 3, "address": unrelated}]
            self.session_starts(probe, denied, [0, 0])
            self.assertCountEqual([probe.receive() for _ in denied],
                                  [self.session_error(number, -1009) for number in (2, 3)])
            self.wait_server(server, 0, 0)

            self.session_starts(probe, [allowed], [0, 0])
            self.assertEqual(self.wire_path(self.wait_server(server, 1, 1)[0]), urlsplit(provider).path)
            server.release.set()
            self.assertEqual(probe.receive(), {"event": "sessionResult", **allowed, "bodyBytes": 4,
                                               "status": 200, "length": "4", "body": "test"})
            self.wait_server(server, 1, 0)
            self.assertEqual(self.charges(ledger), (1, 256))

    def test_urlsession_task_cancel_closes_held_transport_without_data(self):
        with self.fixture() as (probe, server, ledger):
            self.activate_session(probe)
            self.session_starts(probe, self.resource_requests(1), [0, 0])
            self.wait_server(server, 1, 1)

            self.checkpoint(probe, [1, 256], cancelSessionRequest=1)
            self.assertEqual(probe.receive(), self.session_error(1, -999))
            self.wait_server(server, 1, 0)
            self.assertFalse(server.release.is_set())
            self.assertEqual(self.charges(ledger), (1, 256))

    def test_urlsession_unregister_fails_active_and_pending_and_stops_new_admission(self):
        old_operation = json.loads(self.payload["scope"])["operationId"]
        replacement_operation = "7729af8d-20ac-42db-ae59-3773944d5530"
        with self.fixture() as (probe, server, ledger):
            self.activate_session(probe)
            self.session_starts(probe, self.resource_requests(1, 2, 3, 4, 5, 6), [0, 0])
            self.wait_server(server, 4, 4)
            deadline = time.monotonic() + 5
            while True:
                probe.send({"inspectPendingRequests": True})
                pending = probe.receive()
                self.assertEqual(pending["event"], "pendingRequests")
                self.assertEqual(probe.receive(), {"event": "checkpoint", "charges": [4, 1024]})
                if pending["count"] == 2:
                    break
                self.assertLess(time.monotonic(), deadline, "two URLSession requests must be waiting")
                time.sleep(.01)

            probe.send({"watchReplacementOperation": replacement_operation, "unregisterActiveOperation": True})
            self.assertEqual(probe.receive(), {"event": "unregisteredActiveOperation", "removed": True})
            self.assertEqual(probe.receive(), {"event": "checkpoint", "charges": [4, 1024]})
            replacement_address = self.operation_style_address().replace(old_operation, replacement_operation)
            expected = [self.session_error(number, -999) for number in range(1, 7)]
            expected += [{"event": "replacementWhileRetiring", "admitted": False},
                         {"event": "replacementAfterRetirement", "settled": 4, "oldAdmitted": False,
                          "newAddress": replacement_address}]
            observed = [probe.receive() for _ in expected]
            self.assertCountEqual(observed, expected)
            self.assertLess(observed.index(expected[-2]), observed.index(expected[-1]))
            self.wait_server(server, 4, 0)

            self.session_starts(probe, self.resource_requests(7), [4, 1024])
            self.assertEqual(probe.receive(), self.session_error(7, -1009))
            self.checkpoint(probe, [4, 1024], fetchStyle=self.operation_style_address())
            self.assertEqual(probe.receive(), {"event": "styleResult", "errorDomain": "NSURLErrorDomain",
                                               "errorCode": -1009})
            self.assertFalse(server.release.is_set())
            self.wait_server(server, 4, 0)
            self.assertEqual(self.charges(ledger), (4, 1024))
            self.assertEqual(self.charges(ledger.parent / "replacement" / ledger.name), (0, 0))

    def test_queued_resource_returns_at_its_alias_and_rejects_another_context(self):
        scope = json.loads(self.payload["scope"])
        provider_url = self.payload["tiles"][0]
        valid = self.resource_requests(1)[0]
        other_id = "7729af8d-20ac-42db-ae59-3773944d5530"
        wrong_scope_url = valid["address"].replace(scope["operationId"], other_id)
        with self.fixture() as (probe, server, ledger):
            self.resource_starts(probe, [{"number": 2, "address": provider_url},
                                         {"number": 3, "address": wrong_scope_url}], [0, 0], accepted=False)
            for context in ({"address": valid["address"]},
                            {"address": wrong_scope_url, "otherOperationID": other_id}):
                probe.send({"checkResourceContext": context})
                self.assertEqual(probe.receive(), {"event": "resourceContext", "accepted": False})
                self.assertEqual(probe.receive(), {"event": "checkpoint", "charges": [0, 0]})
            self.wait_server(server, 0, 0)

            self.resource_starts(probe, [valid], [1, 256])
            self.assertEqual(self.wire_path(self.wait_server(server, 1, 1)[0]), urlsplit(provider_url).path)
            server.release.set()
            self.assertEqual(probe.receive(), self.resource_result(valid))
            self.wait_server(server, 1, 0)
            self.assertEqual(self.charges(ledger), (1, 256))

    def test_queued_resource_cancels_pending_and_live_without_consumer_callbacks(self):
        addresses = self.resource_requests(1, 2, 3, 4, 5, 6)
        with self.fixture() as (probe, server, ledger):
            self.resource_starts(probe, addresses, [4, 1024])
            self.wait_server(server, 4, 4)
            self.checkpoint(probe, [4, 1024], cancelResource=5)
            self.checkpoint(probe, [4, 1024], cancelResource=1)
            requests = self.wait_server(server, 5, 4)
            self.assertCountEqual(map(self.wire_path, requests),
                                  [urlsplit(self.payload["tiles"][index]).path for index in (0, 1, 2, 3, 5)])
            server.release.set()
            self.assertCountEqual([probe.receive() for _ in range(4)],
                                  [self.resource_result(addresses[index]) for index in (1, 2, 3, 5)])
            self.wait_server(server, 5, 0)
            self.assertEqual(self.charges(ledger), (5, 1280))

    def test_queued_resource_suppresses_a_success_cancelled_after_native_terminal(self):
        with self.fixture() as (probe, server, ledger):
            self.resource_starts(probe, self.resource_requests(1), [1, 256])
            self.wait_server(server, 1, 1)
            self.checkpoint(probe, [1, 256], cancelResourceAtTerminal=1)
            server.release.set()
            self.assertEqual(probe.receive(), {"event": "resourceTransportTerminal", "number": 1,
                                               "sends": 1, "status": 200, "bytes": 4})
            self.assertEqual(probe.receive(), {"event": "resourceDeliveryDrained", "number": 1})
            self.wait_server(server, 1, 0)
            self.assertEqual(self.charges(ledger), (1, 256))

    def test_queued_resource_closes_after_a_success_with_active_and_waiting_requests(self):
        with self.fixture() as (probe, server, ledger):
            self.resource_starts(probe, self.resource_requests(1, 2, 3, 4, 5, 6), [4, 1024])
            addresses = [urlsplit(address).path for address in self.payload["tiles"][:4]]
            requests = self.wait_server(server, 4, 4)
            self.assertCountEqual(map(self.wire_path, requests), addresses)
            self.checkpoint(probe, [4, 1024], closeResourcesAtTerminal=4)
            server.release.set()

            self.assertEqual(probe.receive(), {"event": "resourceClosedAtTerminal", "status": 200,
                                               "bytes": 4, "charges": [4, 1024]})
            self.assertEqual(probe.receive(), {"event": "resourceCloseDrained", "active": 4, "sends": 4})
            self.resource_starts(probe, self.resource_requests(7), [4, 1024], accepted=False)
            self.wait_server(server, 4, 0)
            self.assertEqual(self.charges(ledger), (4, 1024))

    def test_urlsession_guard_serves_only_the_registered_operation_style(self):
        scope = json.loads(self.payload["scope"])
        root = (f"https://offline-style.trip-painting.invalid/v2/{scope['operationId']}/"
                f"{scope['localStyleSha256']}")
        address = root + "/style.json"
        checkpoint = {"event": "checkpoint", "charges": [0, 0]}
        denied = {"event": "styleResult", "errorDomain": "NSURLErrorDomain", "errorCode": -1009}
        with self.fixture() as (probe, server, ledger):
            probe.send({"registerOperationStyle": True})
            self.assertEqual(probe.receive(), {"event": "registeredStyle", "address": None})
            self.assertEqual(probe.receive(), checkpoint)

            self.checkpoint(probe, [0, 0], blockStyleRequests=True, fetchStyle=address)
            self.assertEqual(probe.receive(), denied)

            probe.send({"describeRoute": True, "registerOperationStyle": True})
            route = probe.receive()
            self.assertEqual(route["event"], "route")
            self.assertEqual(route["styleURL"], address)
            self.assertEqual(probe.receive(), {"event": "registeredStyle", "address": address})
            self.assertEqual(probe.receive(), checkpoint)

            self.checkpoint(probe, [0, 0], fetchStyle=address)
            result = probe.receive()
            self.assertEqual(result, {"event": "styleResult", "address": address, "status": 200,
                                      "length": str(len(route["style"].encode())),
                                      "mimeType": "application/json", "body": route["style"]})
            sources = json.loads(result["body"])["sources"]
            for source, kind in (("openmaptiles", "vector"), ("ne2_shaded", "raster")):
                self.assertEqual(sources[source]["tiles"],
                                 [root + "/resource" + urlsplit(scope["resources"][kind]).path])

            wrong_job = address.replace(scope["operationId"], "7729af8d-20ac-42db-ae59-3773944d5530")
            resource = root + "/resource" + urlsplit(self.payload["tiles"][0]).path
            for wrong_address in (wrong_job, address + "?changed=1", address + "/", resource):
                self.checkpoint(probe, [0, 0], fetchStyle=wrong_address)
                self.assertEqual(probe.receive(), denied)
            self.wait_server(server, 0, 0)
            self.assertEqual(self.charges(ledger), (0, 0))

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
