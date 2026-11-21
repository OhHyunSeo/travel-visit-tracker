import json
from pathlib import Path
import tempfile
import unittest

from product_map_frames import TAB_PHASES
from product_map_sources import verify_source_bounds


BOUNDS = [128.4, 38.0, 128.7, 38.3]
SOURCE = {'type': 'raster', 'minzoom': 8, 'maxzoom': 8,
          'tiles': ['https://127.0.0.1:39443/resource/tile/{z}_{x}_{y}']}
METADATA = {'plan': json.dumps({'bounds': BOUNDS, 'minZoom': 8, 'maxZoom': 8})}
STYLE = json.dumps({'sources': {'fixture': SOURCE}})


def captures(directory):
    for phase in TAB_PHASES:
        source = {**SOURCE, 'bounds': BOUNDS} if phase in ('saved', 'restored') else None
        snapshot = {'pid': 1234, 'phase': phase, 'connected': False, 'viewIdentity': 4567, 'source': source}
        (directory / f'{phase}-source.json').write_text(json.dumps(snapshot))


class ProductSourceBoundsTest(unittest.TestCase):
    def test_requires_the_saved_bounds_in_the_native_renderer(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            captures(path)
            self.assertEqual(verify_source_bounds(path, 1234, METADATA, STYLE)['bounds'], BOUNDS)
            file = path / 'saved-source.json'
            data = json.loads(file.read_text())
            data['source']['bounds'] = [-180, -85, 180, 85]
            file.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError, 'tile bounds'):
                verify_source_bounds(path, 1234, METADATA, STYLE)

    def test_rejects_changed_tile_urls_and_source_on_boundary_map(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            captures(path)
            file = path / 'restored-source.json'
            data = json.loads(file.read_text())
            data['source']['tiles'] = ['https://fixture.invalid/{z}/{x}/{y}']
            file.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError, 'tile URLs'):
                verify_source_bounds(path, 1234, METADATA, STYLE)
            captures(path)
            file = path / 'disabled-source.json'
            data = json.loads(file.read_text())
            data['source'] = SOURCE
            file.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError, 'Boundary-only'):
                verify_source_bounds(path, 1234, METADATA, STYLE)

    def test_rejects_a_different_process_or_connection_state(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            captures(path)
            with self.assertRaisesRegex(ValueError, 'different process'):
                verify_source_bounds(path, 4321, METADATA, STYLE)
            file = path / 'restored-source.json'
            data = json.loads(file.read_text())
            data['connected'] = True
            file.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError, 'connection state'):
                verify_source_bounds(path, 1234, METADATA, STYLE)


if __name__ == '__main__':
    unittest.main()
