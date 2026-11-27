import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image, ImageDraw

from row_pan_trial import (COAST_PLAN, MIDPOINT_LONGITUDE, capture_row_pan, capture_settled,
                           check_coastal_start, midpoint_preparation_decision,
                           midpoint_preparation_plan, verify_row_pan)
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
    def test_midpoint_gate_includes_four_pixels_and_excludes_both_historical_starts(self):
        baseline = {'center': [128.40422065099693, 38.39305843344254]}
        for pixels in (-4, 0, 4):
            start = {'center': [MIDPOINT_LONGITUDE + pixels * 360 / 524288, baseline['center'][1]]}
            check_coastal_start(start, baseline, (720, 1280), midpoint=True)
        for longitude in (128.49197381196836, 128.5165696684727,
                          MIDPOINT_LONGITUDE - 4.01 * 360 / 524288,
                          MIDPOINT_LONGITUDE + 4.01 * 360 / 524288):
            start = {'center': [longitude, baseline['center'][1]]}
            check_coastal_start(start, baseline, (720, 1280), midpoint=False)
            with self.assertRaisesRegex(ValueError, 'Midpoint start condition not met'):
                check_coastal_start(start, baseline, (720, 1280), midpoint=True)

    def test_capture_saves_a_missed_start_without_sending_a_south_swipe(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            capture(root)
            baseline = json.loads((root / 'restored-source.json').read_text())
            start = {**baseline, 'center': [128.52, 38.4]}
            inputs = []

            def settled(command, target, package, activity, pid, original):
                (target / 'zoom9-source.json').write_text(json.dumps(start))

            with patch('row_pan_trial.samples', return_value=((720, 1280), 6000, 80)), \
                    patch('row_pan_trial.capture_settled', side_effect=settled), \
                    patch('row_pan_trial.require_foreground'), patch('row_pan_trial.running_pid', return_value=900), \
                    patch('row_pan_trial.time.sleep'):
                with self.assertRaisesRegex(ValueError, 'outside measured correction ranges'):
                    capture_row_pan(lambda *args: inputs.append(args), root, 'fixture', 'activity', 900, midpoint=True)
            self.assertEqual(len(inputs), 1)
            self.assertEqual(inputs[0][4:], ('453', '576', '285', '576', '500'))
            self.assertEqual(json.loads((root / 'row-pan-plan.json').read_text())['id'], 'coastal-midpoint-single-correction-v1')
            self.assertEqual(json.loads((root / 'pan-preparation/gesture.json').read_text()), [453, 576, 285, 576, 500])
            self.assertEqual(json.loads((root / 'pan-preparation/zoom9-source.json').read_text()), start)
            self.assertFalse((root / 'pan-start').exists())

    def test_correction_uses_the_smallest_input_with_matching_direction(self):
        for offset, action, end_x in ((-4, 'already-in-range', None), (4, 'already-in-range', None),
                                     (6.16, 'single-correction', 372), (-6.16, 'single-correction', 348),
                                     (8, 'single-correction', 376), (-8, 'single-correction', 344),
                                     (11.30, 'outside-calibration', None), (-11.28, 'outside-calibration', None)):
            with self.subTest(offset=offset):
                start = {'center': [MIDPOINT_LONGITUDE + offset * 360 / 524288, 38.4]}
                result = midpoint_preparation_decision(start)
                self.assertEqual(result['action'], action)
                self.assertEqual(result['gesture'], [360, 614, end_x, 614, 500] if end_x else None)

    def test_a_missed_correction_does_not_retry_or_send_south_swipe(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            capture(root)
            baseline = json.loads((root / 'restored-source.json').read_text())
            inputs = []

            def settled(command, target, package, activity, pid, original):
                offset = 6.16 if target.name == 'pan-preparation' else 4.2
                view = {**baseline, 'center': [MIDPOINT_LONGITUDE + offset * 360 / 524288, 38.4]}
                (target / 'zoom9-source.json').write_text(json.dumps(view))

            with patch('row_pan_trial.samples', return_value=((720, 1280), 6000, 80)), \
                    patch('row_pan_trial.capture_settled', side_effect=settled), \
                    patch('row_pan_trial.require_foreground'), patch('row_pan_trial.running_pid', return_value=900), \
                    patch('row_pan_trial.time.sleep'):
                with self.assertRaisesRegex(ValueError, 'Midpoint start condition not met'):
                    capture_row_pan(lambda *args: inputs.append(args), root, 'fixture', 'activity', 900, midpoint=True)
            self.assertEqual([item[4:] for item in inputs], [('453', '576', '285', '576', '500'),
                                                              ('360', '614', '372', '614', '500')])
            self.assertTrue((root / 'pan-start/zoom9-source.json').is_file())
            self.assertFalse((root / 'pan-return').exists())

    def test_shorter_preparation_replay_rejects_a_legacy_swipe_in_its_receipt(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            capture(root)
            start = root / 'pan-start'
            start.mkdir()
            (start / 'gesture.json').write_text(json.dumps([453, 576, 273, 576, 500]))
            (root / 'row-pan-plan.json').write_text(json.dumps(midpoint_preparation_plan()))
            (root / 'map-log-capacity.txt').write_text('ring buffer is 8 MiB')
            (root / 'map-log-before-row-pan.log').write_text(
                '11-26 09:30:49.445  900  901 I TripProductMapQa: MAP_OFFLINE connected=false\n'
                '11-26 09:30:49.446  900  901 I TripProductMapQa: MAP_ROUTE /(tabs)/index\n')
            with self.assertRaisesRegex(ValueError, 'preparation swipe differs'):
                verify_row_pan(root, 900, require_midpoint=True)

    def test_coastal_start_uses_its_own_four_times_baseline_and_the_frozen_plan(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);capture(root)
            start=root/'pan-start';start.mkdir()
            source=json.loads((root/'restored-source.json').read_text())
            source.update(phase='zoom9',center=[128.52,38.4])
            (start/'zoom9-source.json').write_text(json.dumps(source))
            (start/'screen.png').write_bytes((root/'pan-south/screen.png').read_bytes())
            for phase in ('pan-south','pan-north'):
                path=root/phase/'zoom9-source.json';data=json.loads(path.read_text())
                data['center'][0]=128.52;path.write_text(json.dumps(data))
            (root/'row-pan-plan.json').write_text(json.dumps(COAST_PLAN))
            with patch('row_pan_trial.verify_settling'):
                # The prepared baseline has as many blue samples as the south;
                # comparing against the old narrow baseline would incorrectly pass.
                with self.assertRaisesRegex(ValueError,'wider southern tile'):
                    verify_row_pan(root,900)
                plan={**COAST_PLAN,'durationMs':100}
                (root/'row-pan-plan.json').write_text(json.dumps(plan))
                with self.assertRaisesRegex(ValueError,'predeclared coastal plan'):
                    verify_row_pan(root,900)
                (root/'row-pan-plan.json').unlink()
                with self.assertRaisesRegex(ValueError,'captured together'):
                    verify_row_pan(root,900)

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
