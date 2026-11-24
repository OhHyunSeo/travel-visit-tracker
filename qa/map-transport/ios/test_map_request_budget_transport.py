"""Couple the product's request budget to the existing single-send loopback fixture."""

from collections import Counter
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

from test_http_exchange import QueueFixture
from test_map_request_scope import APP, GENERATOR, HERE


@unittest.skipUnless(sys.platform == "darwin", "Apple Foundation/Network ledger and transfer check")
class MapRequestBudgetTransportTests(unittest.TestCase):
    def test_cancel_keeps_the_fourth_permit_until_the_socket_settles(self):
        with tempfile.TemporaryDirectory(prefix="tp-budget-transport-") as temp:
            directory = Path(temp)
            exchange = directory / "exchange.o"
            subprocess.run(["xcrun", "clang", "-fobjc-arc", "-c", str(HERE / "TPHTTPExchange.m"),
                            "-o", str(exchange)], check=True, capture_output=True, timeout=30)
            binary = directory / "transport-probe"
            sources = APP / "plugins/ios"
            subprocess.run(["xcrun", "swiftc", "-module-cache-path", str(directory / "modules"),
                            "-import-objc-header", str(HERE / "TPHTTPExchange.h"),
                            str(sources / "TripPaintingMapRequestScope.swift"),
                            str(sources / "TripPaintingMapRequestBudget.swift"),
                            str(HERE / "test-map-budget-transport.swift"), str(exchange),
                            "-framework", "Network", "-framework", "Security", "-o", str(binary)],
                           check=True, capture_output=True, timeout=90)
            self.check_loopback([str(binary)], directory)

    def check_loopback(self, command, directory):
        cases = json.loads(subprocess.check_output(["node", "--import", "tsx", "--input-type=module", "-e", GENERATOR],
                                                   cwd=APP, text=True, timeout=30))
        case = cases[0]
        scope = json.loads(case["scope"])
        tile = scope["plan"]["tileRanges"][0]
        address = scope["resources"]["vector"].format(z=tile["zoom"], x=tile["minX"], y=tile["maxY"])
        payload = {**case, "metadata": case["saved"], "tile": address, "otherTile": address + "?modified=1"}
        with QueueFixture() as server, subprocess.Popen([*command, str(server.port), str(directory)],
                                                         stdin=subprocess.PIPE, stdout=subprocess.PIPE) as process:
            buffered = bytearray()

            def send(line):
                process.stdin.write(line.encode() + b"\n")
                process.stdin.flush()

            def receive():
                deadline = time.monotonic() + 5
                while b"\n" not in buffered:
                    left = max(0, deadline - time.monotonic())
                    self.assertTrue(select.select([process.stdout], [], [], left)[0], "no native event")
                    chunk = os.read(process.stdout.fileno(), 4096)
                    self.assertTrue(chunk, "the native probe exited before its next event")
                    buffered.extend(chunk)
                line, _, tail = buffered.partition(b"\n")
                buffered[:] = tail
                return json.loads(line)

            def wait_server(arrivals, active):
                deadline = time.monotonic() + 4
                while time.monotonic() < deadline:
                    with server.lock:
                        if len(server.requests) == arrivals and server.active == active:
                            return
                    time.sleep(.02)
                self.fail(f"server arrivals/active {(len(server.requests), server.active)} != {(arrivals, active)}")

            def charges():
                with sqlite3.connect(directory / "request-budget-v1.sqlite") as db:
                    return db.execute("SELECT tile_attempts,reserved_bytes FROM request_budget").fetchone()

            try:
                send(json.dumps(payload))
                self.assertEqual(receive(), {"event": "start", "outside": "outside scope",
                                             "slots": ["started"] * 4 + ["busy"]})
                wait_server(4, 4)
                self.assertEqual(charges(), (4, 1024))
                send("cancel")
                self.assertEqual(receive(), {"event": "cancel", "whileCancelling": "busy"})
                self.assertEqual(receive(), {"event": "terminal", "slot": 1, "sends": 1,
                                             "status": 0, "bytes": 0, "failed": True})
                wait_server(4, 3)
                self.assertEqual(charges(), (4, 1024))
                send("retry")
                self.assertEqual(receive(), {"event": "retry", "slot": "started"})
                wait_server(5, 4)
                self.assertEqual(charges(), (5, 1280))
                server.release.set()
                events = sorted([receive() for _ in range(4)], key=lambda event: event["slot"])
                self.assertEqual(events, [{"event": "terminal", "slot": slot, "sends": 1,
                                           "status": 200, "bytes": 4, "failed": False} for slot in range(2, 6)])
                wait_server(5, 0)
                self.assertEqual(server.peak, 4)
                self.assertEqual(charges(), (5, 1280))
                self.assertEqual(Counter(request.split(b"\r\n", 1)[0] for request in server.requests),
                                 Counter(f"GET /resource/budget/{number} HTTP/1.1".encode() for number in range(1, 6)))
                process.stdin.close()
                self.assertEqual(process.wait(timeout=5), 0)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait(timeout=5)
