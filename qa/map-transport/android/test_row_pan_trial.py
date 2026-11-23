import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image, ImageDraw

from row_pan_trial import capture_settled, verify_row_pan
from row_pan_observations import frame_metrics, observation, verify_settling


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

    def test_overlay_pixels_do_not_replace_the_existing_bare_raster_threshold(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);capture(root)
            path=root/'pan-south/screen.png'
            with Image.open(path) as image:
                ImageDraw.Draw(image).rectangle((40,330,260,515),fill=(52,117,195))
                image.save(path)
            metrics=frame_metrics(path.read_bytes())
            self.assertGreater(metrics['bottomOverlaySamples'],1000)
            self.assertEqual(metrics['bottomTileSamples'],0)
            with self.assertRaisesRegex(ValueError,'wider southern tile'):
                verify_row_pan(root,900)

    def test_settling_checks_raw_observations_and_rejects_a_substituted_final_frame(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);capture(root);phase=root/'pan-south'
            baseline=json.loads((root/'restored-source.json').read_text())
            for index in range(3):
                folder=phase/'observations'/f'{index:02d}';folder.mkdir(parents=True)
                for name in ('screen.png','zoom9-source.json'):
                    (folder/name).write_bytes((phase/name).read_bytes())
            (phase/'settling.json').write_text(json.dumps({'attempts':3,'stable':True,'selectedAttempt':2}))
            self.assertEqual(verify_settling(phase,baseline,900)['stableFrames'],3)
            (phase/'screen.png').write_bytes((root/'restored.png').read_bytes())
            with self.assertRaisesRegex(ValueError,'different frame'):
                verify_settling(phase,baseline,900)
            (phase/'screen.png').write_bytes((phase/'observations/02/screen.png').read_bytes())
            path=phase/'observations/01/zoom9-source.json';data=json.loads(path.read_text())
            data['center'][1]+=.00001;path.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError,'three consecutive'):
                verify_settling(phase,baseline,900)

    def test_capture_does_not_select_a_transient_good_frame(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);capture(root);phase=root/'pan-south'
            baseline=json.loads((root/'restored-source.json').read_text())
            good=observation(phase)
            transient={**good,'frame':{**good['frame'],'sampleGridSha256':'different'}}
            with patch('row_pan_trial.capture_source'), patch('row_pan_trial.require_foreground'), \
                    patch('row_pan_trial.running_pid',return_value=900), patch('row_pan_trial.time.sleep'), \
                    patch('row_pan_trial.observation',side_effect=[good,good,transient,good,good,transient]):
                command=lambda *args:(phase/'screen.png').read_bytes() if 'screencap' in args else b''
                with self.assertRaisesRegex(ValueError,'bounded observation window'):
                    capture_settled(command,phase, 'fixture.package','fixture/activity',900,baseline)
            report=json.loads((phase/'settling.json').read_text())
            self.assertEqual(report['attempts'],6)
            self.assertFalse(report['stable'])
            self.assertIsNone(report['selectedAttempt'])
