"""Synthetic report regressions for the mixed SDK HTTPS validator."""

import base64
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest

from tls_mixed_result import ENCODED_GLYPH, EvidenceError, validate_waiting, verify


ORIGIN = "https://192.168.50.2:3091"
CERTIFICATE = b"synthetic-public-leaf-byte-binding"
PID = 1234
RUN = "mixed-fixture-run"
GLYPH = "/resource/glyph/QA/0-255.pbf"
STYLE = "/resource/style/mixed"
TILES = [f"/resource/tile/m_2_{x}_{y}" for x, y in ((0, 0), (0, 1), (1, 0),
                                                       (1, 1), (2, 0), (2, 1))]


def fixture_snapshot(paths, *, active, released, scale):
    rows = []
    for path in paths:
        held = path == GLYPH or path in TILES
        finished = released or not held
        size = {STYLE: 610, GLYPH: 45}.get(path, 93 if path.endswith(".png") else 105)
        if path.startswith(f"/resource/sprite/mixed{scale}."):
            size = 60 if path.endswith(".json") else 84
        rows.append({"path": path, "bytes": size, "bytesWritten": size if finished else 0,
                     "held": held, "finished": finished, "closedBeforeFinish": False,
                     "ua": "TripPaintingMapTransportQA/1.0", "receivedAuthHeader": False,
                     "cookieHeader": False, "alpn": "http/1.1", "tlsProtocol": "TLSv1.3"})
    return {"active": active, "maxActive": 4 if paths else 0, "heldActive": active,
            "heldReleased": released, "resourceCount": len(paths), "requests": rows}


def native_snapshot(server, pending):
    rows = server["requests"]
    active = server["active"]
    count = len(rows)
    settled = count - active
    body = sum(row["bytesWritten"] for row in rows)
    ledger = {"schema": 1, "origin": ORIGIN, "requests": count,
              "tiles": sum(row["path"] in TILES for row in rows), "reservedBytes": count * 1024,
              "maxRequests": 16, "maxTiles": 8, "maxReservedBytes": 16384, "reservationBytes": 1024,
              "fixtureResourceProfile": "mixed-v1",
              "fixtureTLSLeafDER": base64.b64encode(CERTIFICATE).decode("ascii"),
              "unresolved": [f"ABCDEFAB-0000-0000-0000-{index:012}" for index in range(active)]}
    return {"active": active, "pending": pending, "maxActive": 4, "maxPending": 2,
            "cancelledActive": 0, "cancelledPending": 0, "blockedBeforeDispatch": 0,
            "started": count, "released": settled, "httpRequestSendsSettled": settled,
            "receivedHTTPBytesSettled": body + settled * 150, "acceptedBodyBytes": body,
            "tlsVerifiedExchanges": settled, "mixedActiveSprites": 0, "ledgerOK": True,
            "transport": "pinned-private-tls-http1-fixture", "ledger": ledger}


def observations(*, finished_sprites=2, scale="@2x", glyph_open=True):
    sprites = [f"/resource/sprite/mixed{scale}.{extension}" for extension in ("json", "png")]
    open_paths = [GLYPH, *TILES[:3]] if glyph_open else TILES[:4]
    other_paths = [path for path in [GLYPH, *TILES] if path not in open_paths]
    waiting_paths = [STYLE, *sprites[:finished_sprites], *open_paths]
    final_paths = [*waiting_paths, *sprites[finished_sprites:], *other_paths]
    before = fixture_snapshot(waiting_paths, active=4, released=False, scale=scale)
    after = fixture_snapshot(final_paths, active=0, released=True, scale=scale)
    waiting = native_snapshot(before, pending=2)
    final = native_snapshot(after, pending=0)
    case = {"name": "SDK pinned HTTPS mixed resources", "pass": True,
            "styleLoaded": True, "fullyRendered": True,
            "styleEvidence": {"rasterSource": True, "rasterLayer": True,
                              "symbolSource": True, "symbolLayer": True},
            "waitingSnapshot": waiting, "native": final}
    return {"run.json": {"runID": RUN}, "launch.json": {"process": PID},
            "process-after.json": {"process": PID},
            "waiting.json": {"kind": "mixed-waiting", "runID": RUN, "process": PID,
                             "native": deepcopy(waiting)},
            "result.json": {"complete": True, "pass": True, "stage": "tls-mixed", "trialPhase": 2,
                            "runID": RUN, "process": PID, "mapCreated": True,
                            "delegateClass": "MLRNTransformRequest", "delegatePreserved": 1,
                            "transforms": 10, "rewrittenStyles": 0, "externalTileRequests": 0,
                            "cases": [case], "nativeAtFinish": deepcopy(final)},
            "server-initial.json": fixture_snapshot([], active=0, released=False, scale=scale),
            "server-before.json": before,
            "release.json": {"heldReleased": True, "releasedOpenBodies": 4},
            "server-final.json": after, "ledger.json": deepcopy(final["ledger"])}


class MixedSDKResultTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.folder = Path(directory.name)

    def verify(self, values, certificate=CERTIFICATE, *, encoded_glyph=False):
        for filename, value in values.items():
            (self.folder / filename).write_text(json.dumps(value), encoding="utf-8")
        return verify(self.folder, ORIGIN, certificate, encoded_glyph=encoded_glyph)

    def test_encoded_glyph_mode_requires_its_exact_server_path(self):
        values = observations()
        with self.assertRaisesRegex(EvidenceError, "unexpected mixed fixture resource path"):
            self.verify(values, encoded_glyph=True)
        for name in ("server-before.json", "server-final.json"):
            for row in values[name]["requests"]:
                if row["path"] == GLYPH:
                    row["path"] = ENCODED_GLYPH
        self.assertTrue(self.verify(values, encoded_glyph=True)["validated"])
        with self.assertRaisesRegex(EvidenceError, "unexpected mixed fixture resource path"):
            self.verify(values)

    def test_valid_sprite_scales_and_different_pre_release_scheduling(self):
        for scale in ("", "@2x"):
            for finished in range(3):
                for glyph_open in (False, True):
                    with self.subTest(scale=scale, sprites=finished, glyph_open=glyph_open):
                        values = observations(finished_sprites=finished, scale=scale, glyph_open=glyph_open)
                        summary = self.verify(values)
                        self.assertTrue(summary["validated"])
                        self.assertEqual(summary["verifiedHTTPSExchanges"], 10)
                        self.assertEqual((summary["tiles"], summary["glyphs"], summary["spriteResponses"]),
                                         (6, 1, 2))
                        self.assertEqual(summary["waitingReservedBytes"], (5 + finished) * 1024)
                        self.assertEqual(summary["finalReservedBytes"], 10240)
                        self.assertEqual(summary["acceptedBodyBytes"], sum(
                            row["bytes"] for row in values["server-final.json"]["requests"]))

    def test_waiting_requires_native_pending_and_matching_four_held_responses(self):
        for key, wrong in (("active", 3), ("pending", 0), ("pending", 4), ("started", 6),
                           ("mixedActiveSprites", 1), ("acceptedBodyBytes", 1),
                           ("httpRequestSendsSettled", 2), ("maxActive", 5), ("released", True)):
            with self.subTest(key=key, wrong=wrong):
                values = observations()
                native = values["waiting.json"]["native"]
                native[key] = wrong
                with self.assertRaises(EvidenceError):
                    validate_waiting(native, values["server-before.json"], ORIGIN, CERTIFICATE)

    def test_waiting_and_release_observations_are_independently_required(self):
        for filename, key, wrong in (("server-initial.json", "maxActive", 4),
                                     ("server-before.json", "heldActive", 3),
                                     ("server-before.json", "heldReleased", True),
                                     ("release.json", "releasedOpenBodies", 3),
                                     ("waiting.json", "runID", "previous-run")):
            with self.subTest(filename=filename, key=key):
                values = observations()
                values[filename][key] = wrong
                with self.assertRaises(EvidenceError):
                    self.verify(values)

    def test_exact_categories_and_same_density_sprite_pair_are_required(self):
        for path, wrong in ((GLYPH, "/resource/tile/m_2_3_3"),
                            ("/resource/sprite/mixed@2x.png", "/resource/sprite/mixed.png"),
                            ("/resource/sprite/mixed@2x.png", "/resource/sprite/mixed@2x.jpg"),
                            (TILES[-1], TILES[-2]), (TILES[-1], "/resource/tile/m_3_2_1")):
            with self.subTest(path=path, wrong=wrong):
                values = observations(finished_sprites=0, glyph_open=False)
                for row in values["server-final.json"]["requests"]:
                    if row["path"] == path:
                        row["path"] = wrong
                with self.assertRaises(EvidenceError):
                    self.verify(values)

    def test_fixture_rejects_aborted_partial_oversized_or_credentialed_responses(self):
        for key, wrong in (("finished", False), ("closedBeforeFinish", True), ("bytesWritten", 0),
                           ("bytes", 257), ("held", False), ("receivedAuthHeader", True),
                           ("cookieHeader", True), ("alpn", "h2"), ("tlsProtocol", "TLSv1.1"),
                           ("ua", "unexpected")):
            with self.subTest(key=key):
                values = observations()
                values["server-final.json"]["requests"][-1][key] = wrong
                with self.assertRaises(EvidenceError):
                    self.verify(values)

    def test_server_history_identity_cannot_change_after_release(self):
        values = observations()
        row = values["server-final.json"]["requests"][3]
        row["tlsProtocol"] = "TLSv1.2"
        with self.assertRaisesRegex(EvidenceError, "response identity"):
            self.verify(values)

    def test_native_raster_and_symbol_render_flags_are_required(self):
        for key, wrong in (("styleLoaded", False), ("fullyRendered", False),
                           ("styleEvidence", {"rasterSource": True, "rasterLayer": True,
                                              "symbolSource": True, "symbolLayer": 1})):
            with self.subTest(key=key):
                values = observations()
                values["result.json"]["cases"][0][key] = wrong
                with self.assertRaises(EvidenceError):
                    self.verify(values)

    def test_report_identity_and_independent_process_check_reject_stale_results(self):
        for filename, key, wrong in (("process-after.json", "process", PID + 1),
                                     ("launch.json", "process", True),
                                     ("result.json", "process", PID + 1),
                                     ("result.json", "stage", "tls-queue"),
                                     ("result.json", "transforms", 9)):
            with self.subTest(filename=filename, key=key):
                values = observations()
                values[filename][key] = wrong
                with self.assertRaises(EvidenceError):
                    self.verify(values)

    def test_ledger_requires_exact_profile_charge_leaf_and_archived_copy(self):
        for key, wrong in (("fixtureResourceProfile", "default"), ("reservationBytes", 256),
                           ("reservedBytes", 10239), ("tiles", 5), ("requests", 9),
                           ("maxReservedBytes", 8192), ("unresolved", ["unfinished"])):
            with self.subTest(key=key):
                values = observations()
                report = values["result.json"]
                native = report["cases"][0]["native"]
                native["ledger"][key] = wrong
                report["nativeAtFinish"] = deepcopy(native)
                values["ledger.json"] = deepcopy(native["ledger"])
                with self.assertRaises(EvidenceError):
                    self.verify(values)
        values = observations()
        values["ledger.json"]["tiles"] = 5
        with self.assertRaisesRegex(EvidenceError, "archived mixed reservation ledger"):
            self.verify(values)
        with self.assertRaisesRegex(EvidenceError, "public DER differs"):
            self.verify(observations(), certificate=b"other public leaf")

    def test_final_app_counters_must_match_all_completed_bodies(self):
        for key, wrong in (("pending", 1), ("released", 9), ("cancelledActive", 1),
                           ("tlsVerifiedExchanges", 9), ("acceptedBodyBytes", 1)):
            with self.subTest(key=key):
                values = observations()
                report = values["result.json"]
                native = report["cases"][0]["native"]
                native[key] = wrong
                report["nativeAtFinish"] = deepcopy(native)
                with self.assertRaises(EvidenceError):
                    self.verify(values)
