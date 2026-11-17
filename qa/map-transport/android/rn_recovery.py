"""Collect and verify the isolated React Native background-map recovery trial."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import json
from pathlib import Path
import re
import sqlite3
import sys
import time

sys.path.append(str(Path(__file__).with_name('sdk-smoke')))

from avd_guest_component import FIXTURE_RELAY_PATH, RN_APK_LIMIT, RN_FIXTURE_PACKAGE, guest_command, pack_server, stage_relay
from capture_device import JOURNAL, check_installed_apk, running_pid, write_capture
from verify_device_capture import JOURNAL_HEADER, JOURNAL_RECORD, LOG_LIMIT, check_journal, check_transport_logs, read_apk, read_bounded
from verify_pack_reopen import DATABASE, pack_database


ACTIVITY = f'{RN_FIXTURE_PACKAGE}/app.trippainting.maptransportqa.RecoveryActivity'
OPERATION_DB = 'trip-painting-background-maps-v1.db'
OPERATION_ID = '9729af8d-20ac-42db-ae59-3773944d5530'
RECOVERY_TILE = (8, 219, 98)
TAG = 'TripMapRnFixture'
RN_LOG = re.compile(r'\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+(\d+)\s+\d+\s+I\s+' + TAG + r':\s*(.*)')
UUID = re.compile(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}')


def rn_report(log, pid):
    messages = []
    for line in log.decode().splitlines():
        if TAG + ':' not in line:
            continue
        match = RN_LOG.fullmatch(line)
        if not match or int(match[1]) != pid:
            raise ValueError('Invalid React Native fixture log identity')
        messages.append(match[2])
    if len(messages) != 2 or messages[0] != 'TRANSPORT_READY':
        raise ValueError('React Native fixture did not report transport startup and one recovery result')
    match = re.fullmatch(r'RECOVERY_REPORT calls=(\d+) json=(.+)', messages[1])
    if not match:
        raise ValueError('Invalid React Native recovery report')
    report = json.loads(match[2])
    if not isinstance(report, dict):
        raise ValueError('Invalid React Native recovery result')
    if report.get('pass') is not True:
        raise ValueError('React Native recovery failed: ' + str(report.get('error', 'unknown error'))[:384])
    expected = ['idle', 'awaiting-pack']
    if report.get('states') not in (expected + ['complete'], expected + ['incomplete', 'complete']):
        raise ValueError('Product recovery did not progress from a saved operation to the completed pack')
    pack_id = report.get('createdPackId')
    if not isinstance(pack_id, str) or not UUID.fullmatch(pack_id) or report.get('savedPackId') != pack_id:
        raise ValueError('Product saved pack identity differs from the SDK identity')
    if report.get('status') != {'kind': 'complete', 'packId': pack_id, 'completedResourceCount': 2,
                               'requiredResourceCount': 2, 'completedTileCount': 1} or int(match[1]) != 2:
        raise ValueError('Product completion or fixture transport count differs')
    return pack_id, report['states']


def sqlite_rows(path, query):
    read_bounded(path, 256 * 1024)
    with closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)) as connection:
        if connection.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
            raise ValueError(f'Invalid SQLite capture: {path.name}')
        return connection.execute(query).fetchall()


def verify_recovery(directory, port, pid):
    pack_id, states = rn_report(read_bounded(directory / 'app.log', LOG_LIMIT), pid)
    style_bytes, tile_bytes, forwarded = check_transport_logs(directory, port, raster_tile=True, coordinates=RECOVERY_TILE)
    check_journal(directory / 'budget.journal', raster_tile=True)
    rows = sqlite_rows(directory / OPERATION_DB, 'SELECT slot, metadata, pack_id FROM background_map_operation')
    if len(rows) != 1 or (rows[0][0], rows[0][2]) != (1, pack_id):
        raise ValueError('Expo SQLite does not contain the recovered pack ID')
    metadata = json.loads(rows[0][1])
    if not isinstance(metadata, dict) or metadata.get('operationId') != OPERATION_ID:
        raise ValueError('Saved operation identity differs from the synthetic fixture')
    regions = sqlite_rows(directory / DATABASE, 'SELECT id, description FROM regions')
    if len(regions) != 1 or not isinstance(regions[0][1], bytes):
        raise ValueError('MapLibre SQLite must contain exactly one synthetic region')
    region_id, description = regions[0]
    sdk = json.loads(description)
    if (not isinstance(sdk, dict) or sdk.get('id') != pack_id or not isinstance(sdk.get('metadata'), str)
            or json.loads(sdk['metadata']) != metadata):
        raise ValueError('MapLibre SQLite metadata or ID differs from the Expo SQLite operation')
    pack = pack_database(directory, region_id, port, metadata=description, coordinates=RECOVERY_TILE)
    if (pack['styleBodyBytes'], pack['tileBodyBytes']) != (style_bytes, tile_bytes):
        raise ValueError('Linked MapLibre SQLite payload sizes differ from the synthetic responses')
    return {'pid': pid, 'states': states, 'regionId': region_id, 'styleBodyBytes': style_bytes, 'tileBodyBytes': tile_bytes,
            'forwardedBytes': forwarded, 'transportCalls': 2, 'serverResponses': 2, 'reservations': 2,
            'completedResources': 2, 'completedTiles': 1, 'tileSha256': pack['tileSha256']}


def capture_recovery(key_path, apk, relay, java, identity, destination, expected_hash):
    port, apk_hash = read_apk(apk, RN_APK_LIMIT)
    if apk_hash != expected_hash:
        raise ValueError('React Native fixture APK hash changed')

    def command(limit, mode, *args, timeout=15):
        return guest_command(key_path, limit, mode, *args, timeout=timeout)

    destination.mkdir(mode=0o700)
    stage_relay(key_path, relay, raster_tile=True)
    server_source = Path(__file__).with_name('sdk-smoke') / 'FixtureStyleServer.java'
    relay_log = '/data/local/tmp/trip-rn-relay.log'
    relay_command = (f'CLASSPATH={FIXTURE_RELAY_PATH} app_process /system/bin FixtureLoopbackRelay {port} '
                     f'--raster-tile > {relay_log} 2>&1; cat {relay_log}')
    with pack_server(java, identity, server_source, port, destination / 'server.log', expire_pack=False, rn_recovery=True):
        with ThreadPoolExecutor(max_workers=1) as executor:
            relay_task = executor.submit(command, LOG_LIMIT, 'shell', 'sh', '-c', relay_command, timeout=40)
            try:
                ready = f'RELAY_READY port={port}\n'.encode('ascii')
                for _ in range(12):
                    if command(LOG_LIMIT, 'shell', 'sh', '-c', f'if [ -f {relay_log} ]; then cat {relay_log}; fi') == ready:
                        break
                    if relay_task.done():
                        raise ValueError('React Native fixture relay stopped before app launch')
                    time.sleep(.25)
                else:
                    raise ValueError('React Native fixture relay did not become ready')
                launch = command(4096, 'shell', 'am', 'start', '-W', '-n', ACTIVITY, timeout=22)
                write_capture(destination / 'launch.log', launch)
                if b'Status: ok' not in launch:
                    raise ValueError('React Native fixture activity did not start')
                pid = running_pid(command, RN_FIXTURE_PACKAGE)
                deadline = time.monotonic() + 27
                while time.monotonic() < deadline:
                    app = command(LOG_LIMIT, 'logcat', '-d', '--pid', str(pid), '-v', 'threadtime',
                                  '-s', TAG + ':V', 'AndroidRuntime:E', 'ReactNativeJS:E', '*:S')
                    if b'RECOVERY_REPORT ' in app or b'FATAL EXCEPTION' in app:
                        break
                    time.sleep(.25)
                write_capture(destination / 'app.log', app)
            except (OSError, ValueError):
                crash = command(LOG_LIMIT * 2, 'logcat', '-d', '-t', '180', '-v', 'threadtime',
                                '-s', TAG + ':V', 'AndroidRuntime:E', 'ReactNativeJS:E', '*:S')
                write_capture(destination / 'diagnostics.log', crash)
                raise
            finally:
                write_capture(destination / 'relay.log', relay_task.result())
    size = JOURNAL_HEADER.size + 2 * JOURNAL_RECORD.size
    write_capture(destination / 'budget.journal', command(size, 'exec-out', 'run-as', RN_FIXTURE_PACKAGE, 'cat', JOURNAL))
    if running_pid(command, RN_FIXTURE_PACKAGE) != pid:
        raise ValueError('React Native fixture process changed during capture')
    check_installed_apk(command, expected_hash, RN_FIXTURE_PACKAGE)
    command(256, 'shell', 'am', 'force-stop', RN_FIXTURE_PACKAGE)
    if command(128, 'shell', 'pidof', RN_FIXTURE_PACKAGE).strip():
        raise ValueError('React Native fixture process did not stop')
    for path in (f'files/{DATABASE}', f'files/SQLite/{OPERATION_DB}'):
        for suffix in ('', '-wal'):
            name = path + suffix
            output = command(256 * 1024, 'exec-out', 'run-as', RN_FIXTURE_PACKAGE, 'sh', '-c',
                             f'if [ -f {name} ]; then cat {name}; fi')
            if output or not suffix:
                write_capture(destination / Path(name).name, output)
    return verify_recovery(destination, port, pid)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('capture', type=Path)
    parser.add_argument('--port', required=True, type=int)
    parser.add_argument('--pid', required=True, type=int)
    args = parser.parse_args()
    try:
        print(json.dumps(verify_recovery(args.capture, args.port, args.pid), sort_keys=True))
    except (OSError, ValueError, sqlite3.Error) as error:
        parser.exit(1, f'React Native recovery capture failed: {error}\n')
