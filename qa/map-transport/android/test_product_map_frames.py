import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

from PIL import Image, ImageDraw

from product_map_frames import BACKGROUND_RGB, RASTER_TILE_RGB, SELECTED_REGION_RGB, UNSELECTED_COLORS, verify_product_map_frames
from product_map_trial import MAP_TITLE, TAB_BUTTONS, TOGGLE_LABEL, toggle_center, verify_product_map


def frame(path, tile=None, background=BACKGROUND_RGB, region=SELECTED_REGION_RGB, raster=RASTER_TILE_RGB):
    image = Image.new('RGB', (320, 640), background)
    draw = ImageDraw.Draw(image)
    if tile:
        draw.rectangle(tile, fill=raster)
    # A fill covers the middle of the tile just as region polygons can.
    draw.rectangle((132, 248, 185, 395), fill=region)
    image.save(path)


class ProductMapFramesTest(unittest.TestCase):
    def test_multi_zoom_frames_require_each_zoom_color(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            for phase in ('initial', 'disabled'):
                frame(path / f'{phase}.png', region=UNSELECTED_COLORS[0])
            for phase in ('saved', 'restored', 'zoom9'):
                frame(path / f'{phase}.png', (40, 150, 260, 515), region=(52, 117, 195), raster=(52, 121, 206))
            frame(path / 'zoom8.png', (40, 150, 260, 515), region=UNSELECTED_COLORS[1])
            result = verify_product_map_frames(path, product_tab=True, multi_zoom=True)
            self.assertEqual(set(result['zoomTileSamples']), {'8', '9'})
            frame(path / 'zoom8.png', (40, 150, 260, 515), region=(52, 117, 195), raster=(52, 121, 206))
            with self.assertRaisesRegex(ValueError, 'zoom 8 cached tile'):
                verify_product_map_frames(path, product_tab=True, multi_zoom=True)

    def test_zoom_nine_uses_its_own_tile_color(self):
        with tempfile.TemporaryDirectory() as directory:
            capture = Path(directory)
            for phase in ('initial', 'disabled'):
                frame(capture / f'{phase}.png', region=UNSELECTED_COLORS[0])
            for phase in ('saved', 'restored'):
                frame(capture / f'{phase}.png', (40, 150, 260, 515), region=(52, 117, 195), raster=(52, 121, 206))
            self.assertGreater(verify_product_map_frames(capture, product_tab=True, zoom=9)['tileSamples']['saved'], 40)
            with self.assertRaisesRegex(ValueError, 'expected saved background'):
                verify_product_map_frames(capture, product_tab=True, zoom=8)

    def test_product_tab_requires_the_real_button_and_map_title(self):
        label = TAB_BUTTONS['initial']
        node = (f'<node package="qa.map" text="{MAP_TITLE}"/>'
                '<node package="qa.map" clickable="true" enabled="true" bounds="[0,520][320,580]">'
                f'<node package="qa.map" text="{label}"/></node>')
        layout = ('<hierarchy>' + node + '</hierarchy>').encode()
        self.assertEqual(toggle_center(layout, 'qa.map', (320, 640), title=label), (160, 550))
        with self.assertRaisesRegex(ValueError, 'saved-background switch'):
            toggle_center(layout, 'qa.map', (320, 640), title=TAB_BUTTONS['saved'])
        with self.assertRaisesRegex(ValueError, 'map tab title'):
            toggle_center(layout.replace(MAP_TITLE.encode(), b'other'), 'qa.map', (320, 640), title=label)

    def test_product_tab_starts_on_default_boundaries(self):
        with tempfile.TemporaryDirectory() as directory:
            capture = Path(directory)
            area = (40, 150, 260, 515)
            for phase in ('initial', 'disabled'):
                frame(capture / f'{phase}.png', region=UNSELECTED_COLORS[0])
            for phase in ('saved', 'restored'):
                frame(capture / f'{phase}.png', area, region=UNSELECTED_COLORS[1])
            self.assertEqual(verify_product_map_frames(capture, product_tab=True)['tileSamples']['initial'], 0)
            frame(capture / 'initial.png', area, region=UNSELECTED_COLORS[1])
            with self.assertRaisesRegex(ValueError, 'expected initial background'):
                verify_product_map_frames(capture, product_tab=True)

    def test_switch_target_stays_in_the_fixture_and_capture_bounds(self):
        node = f'<node package="qa.map" content-desc="{TOGGLE_LABEL}" clickable="true" enabled="true" bounds="[0,20][320,80]"/>'
        layout = ('<hierarchy>' + node + '</hierarchy>').encode()
        self.assertEqual(toggle_center(layout, 'qa.map', (320, 640)), (160, 50))
        with self.assertRaisesRegex(ValueError, 'QA package'):
            toggle_center(layout, 'other.map', (320, 640))
        with self.assertRaisesRegex(ValueError, 'outside'):
            toggle_center(layout, 'qa.map', (319, 640))

    def test_offline_map_log_rejects_a_network_call(self):
        with tempfile.TemporaryDirectory() as directory:
            capture = Path(directory)
            prefix = '11-17 22:50:00.000  2451  2455 I TripProductMapQa: '
            rows = ['MAP_OFFLINE connected=false', 'MAP_PHASE saved', 'MAP_PHASE disabled', 'MAP_PHASE restored']
            log = capture / 'map.log'
            log.write_text(''.join(prefix + row + '\n' for row in rows))
            with patch('product_map_trial.verify_product_map_frames', return_value={}):
                self.assertEqual(verify_product_map(capture, 2451)['transportCalls'], 0)
            log.write_text(log.read_text() + prefix + 'TRANSPORT_CALL\n')
            with self.assertRaisesRegex(ValueError, 'transport count'):
                verify_product_map(capture, 2451)

    def test_saved_tile_disappears_and_returns_in_the_same_area(self):
        with tempfile.TemporaryDirectory() as directory:
            capture = Path(directory)
            tile = (40, 150, 260, 515)
            frame(capture / 'saved.png', tile)
            frame(capture / 'disabled.png')
            frame(capture / 'restored.png', tile)
            checked = verify_product_map_frames(capture)
            self.assertGreater(checked['tileSamples']['saved'], 40)
            self.assertEqual(checked['tileSamples']['disabled'], 0)
            self.assertEqual(checked['restoredOverlap'], checked['tileSamples']['saved'])

            frame(capture / 'disabled.png', tile)
            with self.assertRaisesRegex(ValueError, 'expected disabled background'):
                verify_product_map_frames(capture)

    def test_retains_camera_position_and_rejects_a_blank_disabled_frame(self):
        with tempfile.TemporaryDirectory() as directory:
            capture = Path(directory)
            frame(capture / 'saved.png', (40, 150, 105, 515))
            frame(capture / 'disabled.png')
            frame(capture / 'restored.png', (205, 150, 270, 515))
            with self.assertRaisesRegex(ValueError, 'same map area'):
                verify_product_map_frames(capture)
            frame(capture / 'disabled.png', background=(0, 0, 0))
            with self.assertRaisesRegex(ValueError, 'expected disabled background'):
                verify_product_map_frames(capture)


if __name__ == '__main__':
    unittest.main()
