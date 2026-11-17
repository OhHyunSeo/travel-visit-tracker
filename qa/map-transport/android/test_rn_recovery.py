import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from rn_recovery import OPERATION_DB, OPERATION_ID, RECOVERY_TILE, rn_report, verify_recovery
from verify_device_capture import check_transport_logs


PACK_ID = '9f67419a-924b-4ce1-bc84-ae7521972798'
PID = 2451


def capture_log(*, saved_pack_id=PACK_ID, reopening=False):
    status = {'kind': 'complete', 'packId': PACK_ID, 'completedResourceCount': 2,
              'requiredResourceCount': 2, 'completedTileCount': 1}
    report = {'pass': True, 'states': ['idle', 'awaiting-pack', 'incomplete', 'complete'],
              'createdPackId': PACK_ID, 'savedPackId': saved_pack_id, 'status': status}
    if reopening:
        report['states'] = ['complete']
        del report['createdPackId']
    prefix = f'11-17 12:00:00.000  {PID}  2455 I TripMapRnFixture: '
    calls = 0 if reopening else 2
    return f'{prefix}TRANSPORT_READY\n{prefix}RECOVERY_REPORT calls={calls} json={json.dumps(report)}\n'.encode()


class ReactNativeRecoveryTest(unittest.TestCase):
    def test_rn_recovery_requires_the_matching_zoom_eight_tile(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            (path / 'relay.log').write_text('RELAY_READY port=39443\nRELAY_COMPLETE connections=2 forwarded=6397\n')
            prefix = 'STYLE_SERVER_READY port=39443\nSERVED_STYLE bytes=370\n'
            server = path / 'server.log'
            server.write_text(prefix + 'SERVED_TILE path=/resource/tile/0_0_0 bytes=1880\n')
            with self.assertRaisesRegex(ValueError, 'expected raster tile'):
                check_transport_logs(path, 39443, raster_tile=True, coordinates=RECOVERY_TILE)
            server.write_text(prefix + 'SERVED_TILE path=/resource/tile/8_219_98 bytes=1880\n')
            self.assertEqual(check_transport_logs(path, 39443, raster_tile=True, coordinates=RECOVERY_TILE), (370, 1880, 6397))

    def test_report_requires_original_pack_and_process(self):
        self.assertEqual(rn_report(capture_log(), PID)[0], PACK_ID)
        with self.assertRaisesRegex(ValueError, 'saved pack identity'):
            rn_report(capture_log(saved_pack_id='other'), PID)
        with self.assertRaisesRegex(ValueError, 'log identity'):
            rn_report(capture_log(), PID + 1)

    def test_reopen_reports_completion_without_transport(self):
        output = capture_log(reopening=True)
        self.assertEqual(rn_report(output, PID, reopening=True), (PACK_ID, ['complete']))
        with self.assertRaisesRegex(ValueError, 'transport count'):
            rn_report(output.replace(b'calls=0', b'calls=1'), PID, reopening=True)

    def test_report_pass_cannot_override_the_expo_and_sdk_databases(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            (path / 'app.log').write_bytes(capture_log())
            metadata = json.dumps({'operationId': OPERATION_ID})
            unrelated_pack = '9a48e870-a8ba-407e-93a0-69dfbf4213d5'
            with (patch('rn_recovery.check_journal'), patch('rn_recovery.check_transport_logs', return_value=(370, 1880, 6397)),
                  patch('rn_recovery.sqlite_rows') as sqlite_rows):
                sqlite_rows.return_value = [(1, metadata, unrelated_pack)]
                with self.assertRaisesRegex(ValueError, 'Expo SQLite'):
                    verify_recovery(path, 39443, PID)
                self.assertEqual(sqlite_rows.call_args.args[0].name, OPERATION_DB)
                mismatched = json.dumps({'id': unrelated_pack, 'metadata': metadata}).encode()
                sqlite_rows.side_effect = [[(1, metadata, PACK_ID)], [(1, mismatched)]]
                with self.assertRaisesRegex(ValueError, 'MapLibre SQLite metadata or ID'):
                    verify_recovery(path, 39443, PID)


if __name__ == '__main__':
    unittest.main()
