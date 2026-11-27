import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from row_pan_trial import capture_settled
from product_map_trial import verify_map_log
from row_return_trial import world
from small_pan_trial import PLAN, STEPS, gesture, horizontal_corrections, verify_small_pan
from test_row_pan_trial import capture


def at_screen_delta(center, delta):
    y=world(center)[1]-delta
    return [center[0],math.degrees(math.atan(math.sinh(math.pi*(1-2*y/524288))))]


def fixture(root):
    capture(root)
    original=json.loads((root/'restored-source.json').read_text())
    png=(root/'restored.png').read_bytes()
    def sample(folder,center,phase):
        folder.mkdir(parents=True)
        data=json.dumps({**original,'phase':phase,'center':center}).encode()
        (folder/f'{phase}-source.json').write_bytes(data);(folder/'screen.png').write_bytes(png)
        for index in range(3):
            child=folder/'observations'/f'{index:02d}';child.mkdir(parents=True)
            (child/f'{phase}-source.json').write_bytes(data);(child/'screen.png').write_bytes(png)
        (folder/'settling.json').write_text(json.dumps({'attempts':3,'selectedAttempt':2,'stable':True}))
    sample(root/'small-pan-start',[128.52,38.4],'zoom9')
    (root/'small-pan-plan.json').write_text(json.dumps(PLAN))
    current=[128.52,38.4]
    for index,(label,delta) in enumerate(STEPS):
        path=root/'small-pan'/f'{index:02d}-{label}';path.mkdir(parents=True)
        (path/'gesture.json').write_text(json.dumps(gesture((320,640),delta)))
        sample(path/'before-passive',current,'saved')
        response=0 if abs(delta)<=12 else math.copysign(7,delta)
        current=at_screen_delta(current,response)
        sample(path/'after-passive',current,'saved')
        current=at_screen_delta(current,.25)
        sample(path/'after-zoom9',current,'zoom9')


class SmallPanTest(unittest.TestCase):
    def test_horizontal_candidates_require_same_direction_repeats_and_stable_observers(self):
        def reading(finger, travel, drift=0):
            return {'fingerX': finger, 'passiveScreenDelta': [travel, 0], 'reassertScreenDelta': [drift, 0]}

        rows = [reading(0, 0), reading(12, 3), reading(12, 3.5),
                reading(-12, -3), reading(-12, 1), reading(16, 5), reading(16, 8), reading(-16, -7)]
        self.assertEqual(gesture((720, 1280), -12, horizontal=True), [360, 614, 348, 614, 500])
        self.assertEqual(gesture((720, 1280), 16, horizontal=True), [360, 614, 376, 614, 500])
        self.assertEqual(horizontal_corrections(rows), [
            {'fingerX': 12, 'measuredResponsePixels': [3, 3.5], 'applicableErrorMagnitudePixels': [4, 6.75]}])
        self.assertEqual(horizontal_corrections([*rows, reading(0, .3)]), [])
        self.assertEqual(horizontal_corrections([*rows, reading(0, 0, .3)]), [])

    def test_missing_startup_and_extra_transport_are_still_rejected(self):
        prefix='11-24 09:30:49.445  900  901 I TripProductMapQa: '
        offline=prefix+'MAP_OFFLINE connected=false\n';route=prefix+'MAP_ROUTE /(tabs)/index\n'
        verify_map_log((offline+route).encode(),900,product_tab=True)
        for data in (route,offline+route+prefix+'TRANSPORT_CALL\n'):
            with self.assertRaisesRegex(ValueError,'phase order'):
                verify_map_log(data.encode(),900,product_tab=True)

    def test_passive_collection_never_requests_camera_zoom(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);capture(root)
            baseline=json.loads((root/'restored-source.json').read_text())
            png=(root/'restored.png').read_bytes();target=root/'passive';target.mkdir()
            requests=[]
            def source(command,path,phase,package,activity,*,camera_zoom=None):
                requests.append((phase,camera_zoom))
                (path/f'{phase}-source.json').write_text(json.dumps({**baseline,'phase':phase}))
            with patch('row_pan_trial.capture_source',side_effect=source),patch('row_pan_trial.require_foreground'), \
                    patch('row_pan_trial.running_pid',return_value=900),patch('row_pan_trial.time.sleep'):
                capture_settled(lambda *args:png if 'screencap' in args else b'',target,'fixture','activity',900,baseline,phase='saved')
            self.assertEqual(requests,[('saved',None)]*3)
            self.assertFalse(json.loads((target/'settling.json').read_text())['cameraReasserted'])

    def test_zero_response_and_reassertion_drift_are_separate_observations(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);fixture(root)
            report=verify_small_pan(root,900)
            self.assertTrue(report['observationsOnly'])
            for row in report['steps'][:5]:
                self.assertAlmostEqual(row['passiveScreenDelta'][1],0,places=6)
                self.assertAlmostEqual(row['reassertScreenDelta'][1],.25,places=6)
            self.assertAlmostEqual(report['steps'][5]['passiveScreenDelta'][1],-7,places=6)
            self.assertAlmostEqual(report['steps'][6]['passiveScreenDelta'][1],7,places=6)

    def test_a_different_distance_or_duration_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);fixture(root)
            path=root/'small-pan/01-up10/gesture.json';move=json.loads(path.read_text())
            move[-1]=100;path.write_text(json.dumps(move))
            with self.assertRaisesRegex(ValueError,'distance or duration'):
                verify_small_pan(root,900)

    def test_reasserted_snapshot_cannot_be_presented_as_passive(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);fixture(root)
            path=root/'small-pan/01-up10/after-passive/observations/00/saved-source.json'
            data=json.loads(path.read_text());data['phase']='zoom9';path.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError,'renderer'):
                verify_small_pan(root,900)

    def test_cli_rejects_the_mode_before_accessing_an_sdk(self):
        script=Path(__file__).with_name('avd_boot_component.py')
        run=subprocess.run([sys.executable,'-B',str(script),'--sdk-root','/missing-sdk', '--rn-small-pan'],capture_output=True,text=True)
        self.assertEqual(run.returncode,2)
        self.assertIn('--rn-small-pan requires --rn-row-tiles',run.stderr)
        horizontal=subprocess.run([sys.executable,'-B',str(script),'--sdk-root','/missing-sdk','--rn-horizontal-small-pan'],
                                  capture_output=True,text=True)
        self.assertEqual(horizontal.returncode,2)
        self.assertIn('--rn-horizontal-small-pan requires --rn-small-pan',horizontal.stderr)
