import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from row_return_trial import RETURN_POLICY, return_gesture, verify_row_return
from test_row_pan_trial import capture


class ReturnTrialTest(unittest.TestCase):
    def test_controller_is_bounded_and_stops_inside_the_declared_tolerance(self):
        self.assertIsNone(return_gesture([128.52,38.393],[128.52,38.393],(720,1280)))
        move=return_gesture([128.52,38.298],[128.52,38.393],(720,1280))
        self.assertGreater(move[3],move[1]);self.assertLessEqual(move[3],1280*.65)
        with self.assertRaisesRegex(ValueError,'bound'):
            return_gesture([128.3,38.2],[128.52,38.5],(720,1280))

    def test_matching_camera_without_restored_tile_samples_is_insufficient(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);capture(root)
            start=root/'pan-start';start.mkdir()
            baseline=json.loads((root/'pan-north/zoom9-source.json').read_text())
            baseline['center']=[128.4,38.4]
            south=root/'pan-south/zoom9-source.json'
            data=json.loads(south.read_text());data['center']=[128.4,38.36];south.write_text(json.dumps(data))
            (start/'screen.png').write_bytes((root/'restored.png').read_bytes())
            folder=root/'pan-return/attempts/00';folder.mkdir(parents=True)
            (folder/'zoom9-source.json').write_text(json.dumps(baseline))
            (folder/'gesture.json').write_text(json.dumps(return_gesture([128.4,38.36],baseline['center'],(320,640))))
            (folder/'screen.png').write_bytes((root/'pan-south/screen.png').read_bytes())
            (root/'pan-return/return-report.json').write_text(json.dumps({'policy':RETURN_POLICY,'dimensions':[320,640],'attempts':1,'selectedAttempt':0}))
            with patch('row_return_trial.verify_settling'):
                with self.assertRaisesRegex(ValueError,'overlap'):
                    verify_row_return(root,baseline,900)
                (folder/'screen.png').write_bytes((start/'screen.png').read_bytes())
                self.assertEqual(verify_row_return(root,baseline,900)['cameraErrorPixels'],[0,0])
                baseline['center'][1]+=.002
                with self.assertRaisesRegex(ValueError,'controller|tolerance'):
                    verify_row_return(root,baseline,900)
