import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from rn_recovery import collect_post_map
from product_map_trial import capture_product_map


class PostMapChecksTest(unittest.TestCase):
    def test_visual_failure_still_collects_and_reports_persistence(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            def visual():
                raise ValueError('wider tile criterion failed')
            def persistence():
                (root/'synthetic.db').write_bytes(b'final checkpoint')
                return {'packPreserved':True}
            with self.assertRaisesRegex(ValueError,'visual: wider tile'):
                collect_post_map(root,visual,persistence)
            report=json.loads((root/'post-map-checks.json').read_text())
            self.assertFalse(report['visual']['passed'])
            self.assertEqual(report['persistence'],{'passed':True,'result':{'packPreserved':True}})
            self.assertEqual((root/'synthetic.db').read_bytes(),b'final checkpoint')

    def test_visual_success_cannot_hide_persistence_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            def persistence():
                raise OSError('capture stopped')
            with self.assertRaisesRegex(ValueError,'persistence: capture stopped'):
                collect_post_map(root,lambda:{'pixels':1000},persistence)
            report=json.loads((root/'post-map-checks.json').read_text())
            self.assertTrue(report['visual']['passed'])
            self.assertFalse(report['persistence']['passed'])

    def test_pan_failure_keeps_the_visit_storage_audit_and_map_log(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            log=(b'11-24 09:30:49.445  900  901 I TripProductMapQa: MAP_OFFLINE connected=false\n'
                 b'11-24 09:30:49.446  900  901 I TripProductMapQa: MAP_ROUTE /(tabs)/index\n')
            def command(limit,*args,**kwargs):
                if 'logcat' in args:return log
                if 'sh' in args:return b'absent\n'
                return b'<hierarchy/>'
            with patch('product_map_trial.wait_for_frame',return_value=(720,1280)), \
                    patch('product_map_trial.toggle_center',return_value=(360,1000)), \
                    patch('product_map_trial.require_foreground'), \
                    patch('row_pan_trial.capture_row_pan',side_effect=ValueError('visual gate failed')):
                with self.assertRaisesRegex(ValueError,'visual gate failed'):
                    capture_product_map(command,root,'fixture.package','fixture/activity',900,product_tab=True,row_tiles=True,row_pan=True)
            self.assertEqual((root/'visit-storage.txt').read_bytes(),b'absent\n')
            self.assertEqual((root/'map.log').read_bytes(),log)
