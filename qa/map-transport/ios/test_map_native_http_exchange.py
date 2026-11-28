"""Run the native Swift exchange against the explicitly loopback-only fixture."""

from pathlib import Path
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from urllib.parse import urlsplit

import test_map_request_budget_transport as budget_fixture
from test_http_exchange import RawFixture


@unittest.skipUnless(sys.platform == "darwin", "Apple Foundation/Network native transfer check")
class MapNativeHTTPExchangeTests(budget_fixture.MapRequestBudgetTransportTests):
    @classmethod
    def setUpClass(cls):
        temporary = tempfile.TemporaryDirectory(prefix="tp-native-map-exchange-")
        cls.addClassCleanup(temporary.cleanup)
        directory = Path(temporary.name)
        cls.binary = directory / "native-map-exchange-probe"
        sources = budget_fixture.APP / "plugins/ios"
        subprocess.run(["xcrun", "swiftc", "-D", "TP_MAP_TRANSPORT_FIXTURE",
                        "-module-cache-path", str(directory / "modules"),
                        str(sources / "TripPaintingMapRequestScope.swift"),
                        str(sources / "TripPaintingMapRequestBudget.swift"),
                        str(sources / "TripPaintingMapHTTPResponse.swift"),
                        str(sources / "TripPaintingMapHTTPExchange.swift"),
                        str(budget_fixture.HERE / "test-map-native-http-exchange.swift"),
                        "-framework", "Network", "-framework", "Security", "-o", str(cls.binary)],
                       check=True, timeout=90)

    def test_cancel_keeps_the_fourth_permit_until_the_socket_settles(self):
        with tempfile.TemporaryDirectory(prefix="tp-native-held-map-ledger-") as temp:
            self.check_loopback([str(self.binary)], Path(temp), check_wire_requests=self.check_wire, check_replay=True)

    def test_redirect_and_oversize_keep_the_charge_without_delivering_body(self):
        cases = json.loads(subprocess.check_output(["node", "--import", "tsx", "--input-type=module", "-e",
                                                   budget_fixture.GENERATOR], cwd=budget_fixture.APP,
                                                  text=True, timeout=30))
        case = cases[0]
        scope = json.loads(case["scope"])
        tile = scope["plan"]["tileRanges"][0]
        address = scope["resources"]["vector"].format(z=tile["zoom"], x=tile["minX"], y=tile["maxY"])
        payload = {**case, "metadata": case["saved"], "tile": address, "otherTile": address + "?modified=1"}

        for error in ("unsupportedResponse", "oversizedBody"):
            with self.subTest(error=error), tempfile.TemporaryDirectory(prefix="tp-native-refused-map-ledger-") as temp:
                with RawFixture([]) as server:
                    if error == "unsupportedResponse":
                        destination = f"http://127.0.0.1:{server.port}/redirect-must-not-arrive"
                        reply = (f"HTTP/1.1 302 Found\r\nLocation: {destination}\r\n"
                                 "Content-Length: 4\r\nConnection: close\r\n\r\nmove").encode("ascii")
                    else:
                        reply = b"HTTP/1.1 200 OK\r\nContent-Length: 257\r\nConnection: close\r\n\r\n" + b"x" * 257
                    server.chunks = [reply]
                    run = subprocess.run([str(self.binary), str(server.port), temp, "--single"],
                                         input=json.dumps(payload) + "\n", text=True, capture_output=True,
                                         check=True, timeout=15)
                start, terminal = [json.loads(line) for line in run.stdout.splitlines()]
                self.assertEqual(start, {"event": "start", "slot": "started"})
                self.assertGreater(terminal.pop("httpBytes"), 0)
                self.assertEqual(terminal, {"event": "terminal", "error": error, "sends": 1, "bytes": 0})
                self.check_wire(server.requests, address, request_count=1)
                with sqlite3.connect(Path(temp) / "request-budget-v1.sqlite") as db:
                    charges = db.execute("SELECT tile_attempts,reserved_bytes FROM request_budget").fetchone()
                self.assertEqual(charges, (1, 256))

    def check_wire(self, requests, scoped_address, *, request_count=5):
        self.assertEqual(len(requests), request_count)
        url = urlsplit(scoped_address)
        expected_line = f"GET {url.path} HTTP/1.1".encode("ascii")
        for request in requests:
            lines = request.split(b"\r\n")
            self.assertEqual(lines[0], expected_line)
            self.assertEqual(lines[-2:], [b"", b""])
            fields = {}
            for line in lines[1:-2]:
                name, value = line.split(b": ", 1)
                name = name.lower()
                self.assertNotIn(name, fields)
                fields[name] = value
            self.assertEqual(set(fields), {b"host", b"user-agent", b"accept-encoding", b"connection"})
            self.assertEqual(fields[b"host"], b"tiles.openfreemap.org")
            self.assertEqual(fields[b"user-agent"],
                             b"TripPaintingOfflineMaps (+https://github.com/OhHyunSeo/travel-visit-tracker)")
            self.assertEqual(fields[b"accept-encoding"], b"identity")
            self.assertEqual(fields[b"connection"], b"close")
