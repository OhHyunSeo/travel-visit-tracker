import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image, ImageDraw

from row_pan_trial import verify_row_pan


def capture(root):
    source = {'type': 'raster', 'bounds': [128.2,38.18,128.59,38.60], 'minzoom': 9, 'maxzoom': 9}
    baseline = {'pid': 900, 'phase': 'restored', 'viewIdentity': 88, 'connected': False,
                'source': source, 'center': [128.4,38.4], 'zoom': 9}
    (root / 'restored-source.json').write_text(json.dumps(baseline))
    for phase, latitude, seam in [('restored',38.4,500), ('pan-south',38.33,330), ('pan-north',38.47,516)]:
        folder = root if phase == 'restored' else root / phase
        folder.mkdir(exist_ok=True)
        image = Image.new('RGB',(320,640),(11,25,26));draw = ImageDraw.Draw(image)
        draw.rectangle((40,150,260,seam-1), fill=(217,93,47))
        if seam < 516:
            draw.rectangle((40,seam,260,515), fill=(52,121,206))
        image.save(folder / ('restored.png' if phase == 'restored' else 'screen.png'))
        if phase != 'restored':
            (folder / 'zoom9-source.json').write_text(json.dumps({**baseline, 'phase':'zoom9','center':[128.4,latitude]}))


class RowPanTest(unittest.TestCase):
    def test_requires_wider_southern_tile_and_same_moving_renderer(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);capture(root)
            self.assertGreater(verify_row_pan(root,900)['phases']['pan-south']['bottomTileSamples'],300)
            path=root/'pan-south/zoom9-source.json';data=json.loads(path.read_text())
            data['center'][1]=38.4;path.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError,'did not move'):
                verify_row_pan(root,900)
            capture(root);data=json.loads(path.read_text());data['viewIdentity']=89;path.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError,'renderer'):
                verify_row_pan(root,900)

    def test_a_camera_change_without_more_tile_pixels_is_insufficient(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);capture(root)
            (root/'pan-south/screen.png').write_bytes((root/'restored.png').read_bytes())
            with self.assertRaisesRegex(ValueError,'wider southern tile'):
                verify_row_pan(root,900)
