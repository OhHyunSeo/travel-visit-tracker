"""Run the real Swift request validator against the common app's prepared scopes."""

from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
APP = ROOT / "travel_visit_tracker"
ORIGIN = "https://tiles.openfreemap.org"
GENERATOR = """
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {regions} from './src/data/regions.ts';
import {prepareBackgroundMapOperation,validatePreparedBackgroundMapDownload} from './src/services/backgroundMapOperation.ts';
import {BackgroundMapOperationRepository} from './src/storage/backgroundMapOperationRepository.ts';

const origin = 'https://tiles.openfreemap.org';
const tileVersion = '20261025_080012_pt';
const digest = async bytes => createHash('sha256').update(bytes).digest('hex');
const style = {
  version: 8,
  sources: {
    openmaptiles: {type: 'vector', url: `${origin}/planet`},
    ne2_shaded: {type: 'raster', maxzoom: 6, tileSize: 256,
      tiles: [`${origin}/natural_earth/ne2sr/{z}/{x}/{y}.png`]},
  },
  glyphs: `${origin}/fonts/{fontstack}/{range}.pbf`,
  sprite: `${origin}/sprites/ofm_test/ofm`,
  layers: [{id: 'places', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place',
    layout: {'text-font': ['Noto Sans Regular']}}],
};
const tile = {tilejson: '3.0.0', tiles: [`${origin}/planet/${tileVersion}/{z}/{x}/{y}.pbf`],
  minzoom: 0, maxzoom: 14, bounds: [-180,-85.05113,180,85.05113], attribution: 'Test fixture'};
const bytes = {style: Buffer.from(JSON.stringify(style)), tileJson: Buffer.from(JSON.stringify(tile))};
const reference = {styleSha256: await digest(bytes.style), tileJsonSha256: await digest(bytes.tileJson), tileVersion};
const results = await Promise.all(regions.map(async ({id: regionId}) => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = new BackgroundMapOperationRepository({
      exec: async sql => db.exec(sql),
      run: async (sql, ...params) => db.prepare(sql).run(...params),
      first: async (sql, ...params) => db.prepare(sql).get(...params) ?? null,
      all: async (sql, ...params) => db.prepare(sql).all(...params),
    });
    await store.initialize();
    const prepared = await prepareBackgroundMapOperation(store,
      {operationId: '9729af8d-20ac-42db-ae59-3773944d5530',regionId,bytes,reference}, digest);
    if (prepared.kind !== 'prepared') throw new Error('Fixture preparation failed');
    let input;
    if (!(await validatePreparedBackgroundMapDownload(store, prepared, async (scope, style, metadata) => {
      input = {scope, style, saved: metadata, requests: []};
      return true;
    }))) throw new Error('Fixture has no prepared SQLite row');
    return input;
  } finally {
    db.close();
  }
}));
process.stdout.write(JSON.stringify(results));
"""


@unittest.skipUnless(sys.platform == "darwin", "Apple Swift and CryptoKit request-scope check")
class MapRequestScopeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        temp = tempfile.TemporaryDirectory(prefix="tp-native-scope-")
        cls.addClassCleanup(temp.cleanup)
        directory = Path(temp.name)
        cls.probe = directory / "scope-probe"
        subprocess.run(["xcrun", "swiftc", "-module-cache-path", str(directory / "module-cache"),
                        str(APP / "plugins/ios/TripPaintingMapRequestScope.swift"),
                        str(HERE / "test-map-request-scope.swift"), "-o", str(cls.probe)],
                       check=True, capture_output=True, text=True, timeout=90)
        cls.cases = json.loads(subprocess.check_output(
            ["node", "--import", "tsx", "--input-type=module", "-e", GENERATOR],
            cwd=APP, text=True, timeout=30))

    def probe_cases(self, cases):
        return json.loads(subprocess.check_output([str(self.probe)], input=json.dumps(cases), text=True, timeout=30))

    def test_all_bundled_region_scopes_and_selected_tile_corners(self):
        cases = deepcopy(self.cases)
        expected = []
        self.assertEqual(len(cases), 228)
        for case in cases:
            scope = json.loads(case["scope"])
            checks = []
            for tile in scope["plan"]["tileRanges"]:
                address = scope["resources"][tile["source"]].format(z=tile["zoom"], x=tile["minX"], y=tile["maxY"])
                case["requests"].append({"address": address, "method": "GET"})
                checks.append(tile["source"] + "Tile")
            expected.append({"accepted": True, "resources": checks})
        self.assertEqual(self.probe_cases(cases), expected)

    def test_rejects_forged_policy_and_plan(self):
        base = self.cases[0]
        mutations = {
            "wrong-origin": ("origin", "https://example.invalid"),
            "invalid-operation": ("operationId", "other"),
            "invalid-digest": ("tileJsonSha256", "a" * 63),
            "scope-version": ("schemaVersion", 2),
            "scope-boolean": ("schemaVersion", True),
            "excess-byte-budget": ("limits/maxBodyBytes", 50_000_001),
            "excess-tile-budget": ("limits/maxTileAttempts", 2_501),
            "excess-concurrency": ("limits/maxConcurrentRequests", 5),
            "invalid-region": ("plan/regionId", "invalid"),
            "invalid-boundary-version": ("plan/boundaryPackVersion", "unknown"),
            "oversized-tile-range": ("plan/tileRanges/0/maxX", 512),
            "wrong-count": ("plan/estimatedTileCount", 1),
            "reversed-bounds": ("plan/bounds", [130, 37, 128, 38]),
            "swapped-ranges": ("plan/tileRanges", list(reversed(json.loads(base["scope"])["plan"]["tileRanges"]))),
            "higher-zoom": ("plan/maxZoom", 13),
            "wrong-vector-version": ("resources/vector", ORIGIN + "/planet/latest/{z}/{x}/{y}.pbf"),
            "foreign-sprite": ("resources/sprite", "https://example.invalid/sprites/test/ofm"),
            "extra-font": ("resources/fontStacks", ["Noto Sans Regular", "Noto Sans Bold"]),
        }
        for label, (path, value) in mutations.items():
            case = deepcopy(base)
            scope = json.loads(case["scope"])
            parent = scope
            parts = path.split("/")
            for part in parts[:-1]:
                parent = parent[int(part) if isinstance(parent, list) else part]
            parent[parts[-1]] = value
            case["scope"] = json.dumps(scope)
            with self.subTest(label=label):
                self.assertFalse(self.probe_cases([case])[0]["accepted"])

    def test_rejects_bad_style_bytes_and_remote_tilejson_even_with_a_matching_digest(self):
        case = deepcopy(self.cases[0])
        self.assertFalse(self.probe_cases([{**case, "style": case["style"] + " "}])[0]["accepted"])
        for key, value in [("url", ORIGIN + "/planet"), ("scheme", "tms")]:
            style = json.loads(case["style"])
            style["sources"]["openmaptiles"][key] = value
            changed_style = json.dumps(style)
            scope = json.loads(case["scope"])
            scope["localStyleSha256"] = sha256(changed_style.encode()).hexdigest()
            with self.subTest(key=key):
                self.assertFalse(self.probe_cases([{
                    **case, "style": changed_style, "scope": json.dumps(scope),
                }])[0]["accepted"])

    def test_rejects_style_coverage_changes_even_when_style_matches_its_recorded_hash(self):
        case = self.cases[0]
        changes = [
            {"bounds": [-180, -85, 0, 85]}, {"bounds": [-180, -91, 180, 85]},
            {"bounds": [-180, -85, True, 85]}, {"minzoom": True}, {"minzoom": 9},
            {"maxzoom": 11}, {"maxzoom": 14.5}, {"maxzoom": 23}, {"attribution": "   "},
        ]
        modified = []
        for change in changes:
            style = json.loads(case["style"])
            style["sources"]["openmaptiles"].update(change)
            style_json = json.dumps(style)
            scope, metadata = json.loads(case["scope"]), json.loads(case["saved"])
            scope["localStyleSha256"] = metadata["localStyleSha256"] = sha256(style_json.encode()).hexdigest()
            modified.append({**case, "scope": json.dumps(scope), "style": style_json, "metadata": json.dumps(metadata)})
        self.assertEqual(self.probe_cases(modified), [{"accepted": False, "resources": []}] * len(modified))

    def test_accepts_only_literal_scoped_get_addresses(self):
        case = deepcopy(self.cases[0])
        scope = json.loads(case["scope"])
        tile = scope["plan"]["tileRanges"][0]
        fmt = scope["resources"]["vector"]
        tile_url = fmt.format(z=tile["zoom"], x=tile["minX"], y=tile["minY"])
        sprite = scope["resources"]["sprite"] + "@2x.png"
        glyph = ORIGIN + "/fonts/Noto%20Sans%20Regular/65280-65535.pbf"
        requests = [
            (tile_url, "GET", "vectorTile"), (sprite, "GET", "sprite"), (glyph, "GET", "glyph"),
            (tile_url, "POST", None), (tile_url + "?extra=1", "GET", None),
            (tile_url + "#part", "GET", None), (tile_url.replace("https:", "http:"), "GET", None),
            (tile_url.replace(ORIGIN, ORIGIN + ":443"), "GET", None),
            (tile_url.replace(ORIGIN, "https://user@tiles.openfreemap.org"), "GET", None),
            (fmt.format(z=tile["zoom"], x=tile["maxX"] + 1, y=tile["minY"]), "GET", None),
            (fmt.format(z=tile["zoom"], x="0" + str(tile["minX"]), y=tile["minY"]), "GET", None),
            (sprite + "?changed=1", "GET", None), (glyph.replace("Regular", "Bold"), "GET", None),
            (glyph.replace("65280-65535", "65281-65536"), "GET", None),
        ]
        case["requests"] = [{"address": url, "method": method} for url, method, _ in requests]
        self.assertEqual(self.probe_cases([case]), [{"accepted": True, "resources": [entry[2] for entry in requests]}])

    def test_binds_the_scope_to_the_exact_sqlite_operation(self):
        cases = [{**case, "metadata": case["saved"]} for case in self.cases]
        self.assertEqual(self.probe_cases(cases), [{"accepted": True, "resources": []}] * len(cases))
        base = cases[0]
        metadata = json.loads(base["metadata"])
        mutations = [
            {"operationId": "8729af8d-20ac-42db-ae59-3773944d5530"},
            {"tileJsonSha256": "f" * 64}, {"localStyleSha256": "f" * 64},
            {"plan": json.loads(cases[1]["metadata"])["plan"]},
            {"kind": "other"}, {"schemaVersion": 2}, {"plan": "invalid"},
        ]
        modified = [{**base, "metadata": json.dumps({**metadata, **change})} for change in mutations]
        modified.append({**base, "style": base["style"] + " "})
        self.assertEqual(self.probe_cases(modified), [{"accepted": False, "resources": []}] * len(modified))


if __name__ == "__main__":
    unittest.main()
