import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from rn_recovery import ADJACENT_TILES, OPERATION_DB, OPERATION_ID, RECOVERY_TILE, RECOVERY_TILES, fixture_tiles, rn_report, verify_recovery
from verify_device_capture import check_transport_logs


PACK_ID = '9f67419a-924b-4ce1-bc84-ae7521972798'
PID = 2451


def capture_log(*, saved_pack_id=PACK_ID, reopening=False, multi_zoom=False):
    resources = 3 if multi_zoom else 2
    status = {'kind': 'complete', 'packId': PACK_ID, 'completedResourceCount': resources,
              'requiredResourceCount': resources, 'completedTileCount': resources - 1}
    report = {'pass': True, 'states': ['idle', 'awaiting-pack', 'incomplete', 'complete'],
              'createdPackId': PACK_ID, 'savedPackId': saved_pack_id, 'status': status}
    if reopening:
        report['states'] = ['complete']
        del report['createdPackId']
    prefix = f'11-17 12:00:00.000  {PID}  2455 I TripMapRnFixture: '
    calls = 0 if reopening else resources
    return f'{prefix}TRANSPORT_READY\n{prefix}RECOVERY_REPORT calls={calls} json={json.dumps(report)}\n'.encode()


class ReactNativeRecoveryTest(unittest.TestCase):
    def test_adjacent_tiles_require_the_two_neighbors_and_three_resources(self):
        self.assertEqual(fixture_tiles(8, False, True), ((9,438,197), (9,439,197)))
        with self.assertRaisesRegex(ValueError, 'either multi-zoom'):
            fixture_tiles(8, True, True)
        self.assertEqual(rn_report(capture_log(multi_zoom=True), PID, adjacent_tiles=True)[0], PACK_ID)
        with self.assertRaisesRegex(ValueError, 'transport count'):
            rn_report(capture_log(), PID, adjacent_tiles=True)
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            (path / 'relay.log').write_text('RELAY_READY port=39443\nRELAY_COMPLETE connections=3 forwarded=9000\n')
            server = path / 'server.log'
            content = ('STYLE_SERVER_READY port=39443\nSERVED_STYLE bytes=370\n'
                       'SERVED_TILE path=/resource/tile/9_438_197 bytes=1880\n'
                       'SERVED_TILE path=/resource/tile/9_439_197 bytes=1880\n')
            server.write_text(content)
            kwargs = dict(raster_tile=True, coordinates=ADJACENT_TILES[0], extra_coordinates=ADJACENT_TILES[1:])
            self.assertEqual(check_transport_logs(path, 39443, **kwargs), (370,3760,9000))
            server.write_text(content.replace('9_439_197', '8_219_98'))
            with self.assertRaisesRegex(ValueError, 'expected raster tile'):
                check_transport_logs(path, 39443, **kwargs)

    def test_multi_zoom_requires_two_completed_tiles_and_three_requests(self):
        self.assertEqual(rn_report(capture_log(multi_zoom=True), PID, multi_zoom=True)[0], PACK_ID)
        self.assertEqual(rn_report(capture_log(multi_zoom=True, reopening=True), PID,
                                   multi_zoom=True, reopening=True)[0], PACK_ID)
        with self.assertRaisesRegex(ValueError, 'transport count'):
            rn_report(capture_log(), PID, multi_zoom=True)

    def test_multi_zoom_server_requires_both_distinct_paths_in_either_tile_order(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            (path / 'relay.log').write_text('RELAY_READY port=39443\nRELAY_COMPLETE connections=3 forwarded=9000\n')
            prefix = 'STYLE_SERVER_READY port=39443\nSERVED_STYLE bytes=370\n'
            tiles = ['SERVED_TILE path=/resource/tile/9_438_197 bytes=1880\n',
                     'SERVED_TILE path=/resource/tile/8_219_98 bytes=1880\n']
            server = path / 'server.log'
            kwargs = dict(raster_tile=True, coordinates=RECOVERY_TILE, extra_coordinates=(RECOVERY_TILES[9],))
            server.write_text(prefix + ''.join(tiles))
            self.assertEqual(check_transport_logs(path, 39443, **kwargs), (370, 3760, 9000))
            server.write_text(prefix + tiles[0] * 2)
            with self.assertRaisesRegex(ValueError, 'expected raster tile'):
                check_transport_logs(path, 39443, **kwargs)

    def test_zoom_nine_server_log_rejects_a_zoom_eight_tile(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            (path / 'relay.log').write_text('RELAY_READY port=39443\nRELAY_COMPLETE connections=2 forwarded=6397\n')
            prefix = 'STYLE_SERVER_READY port=39443\nSERVED_STYLE bytes=370\n'
            server = path / 'server.log'
            server.write_text(prefix + 'SERVED_TILE path=/resource/tile/8_219_98 bytes=1880\n')
            with self.assertRaisesRegex(ValueError, 'expected raster tile'):
                check_transport_logs(path, 39443, raster_tile=True, coordinates=RECOVERY_TILES[9])
            server.write_text(prefix + 'SERVED_TILE path=/resource/tile/9_438_197 bytes=1880\n')
            self.assertEqual(check_transport_logs(path, 39443, raster_tile=True, coordinates=RECOVERY_TILES[9]), (370, 1880, 6397))

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
