"""Run the native Swift exchange against the explicitly loopback-only fixture."""

from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from urllib.parse import urlsplit

import test_map_request_budget_transport as budget_fixture


@unittest.skipUnless(sys.platform == "darwin", "Apple Foundation/Network native transfer check")
class MapNativeHTTPExchangeTests(budget_fixture.MapRequestBudgetTransportTests):
    def test_cancel_keeps_the_fourth_permit_until_the_socket_settles(self):
        with tempfile.TemporaryDirectory(prefix="tp-native-map-exchange-") as temp:
            directory = Path(temp)
            binary = directory / "native-map-exchange-probe"
            sources = budget_fixture.APP / "plugins/ios"
            subprocess.run(["xcrun", "swiftc", "-D", "TP_MAP_TRANSPORT_FIXTURE",
                            "-module-cache-path", str(directory / "modules"),
                            str(sources / "TripPaintingMapRequestScope.swift"),
                            str(sources / "TripPaintingMapRequestBudget.swift"),
                            str(sources / "TripPaintingMapHTTPResponse.swift"),
                            str(sources / "TripPaintingMapHTTPExchange.swift"),
                            str(budget_fixture.HERE / "test-map-native-http-exchange.swift"),
                            "-framework", "Network", "-framework", "Security", "-o", str(binary)],
                           check=True, timeout=90)
            self.check_loopback([str(binary)], directory, check_wire_requests=self.check_wire, check_replay=True)

    def check_wire(self, requests, scoped_address):
        self.assertEqual(len(requests), 5)
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
