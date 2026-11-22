"""Collect and verify the isolated React Native background-map recovery trial."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import errno
import hashlib
import json
from pathlib import Path
import re
import socket
import sqlite3
import sys
import time
import zlib

sys.path.append(str(Path(__file__).with_name('sdk-smoke')))

from avd_guest_component import FIXTURE_RELAY_PATH, RN_APK_LIMIT, RN_FIXTURE_PACKAGE, RN_TAB_APK_LIMIT, guest_command, pack_server, stage_relay
from capture_device import JOURNAL, check_installed_apk, running_pid, write_capture
from verify_device_capture import JOURNAL_HEADER, JOURNAL_RECORD, LOG_LIMIT, RESERVATION, check_journal, check_transport_logs, read_apk, read_bounded
from verify_pack_reopen import DATABASE, pack_database


ACTIVITY = f'{RN_FIXTURE_PACKAGE}/app.trippainting.maptransportqa.RecoveryActivity'
OPERATION_DB = 'trip-painting-background-maps-v1.db'
OPERATION_ID = '9729af8d-20ac-42db-ae59-3773944d5530'
RECOVERY_TILE = (8, 219, 98)
RECOVERY_TILES = {8: RECOVERY_TILE, 9: (9, 438, 197)}
ADJACENT_TILES = ((9, 438, 197), (9, 439, 197))
ROW_TILES = ((9, 438, 196), (9, 438, 197))
TAG = 'TripMapRnFixture'
RN_LOG = re.compile(r'\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+(\d+)\s+\d+\s+I\s+' + TAG + r':\s*(.*)')
UUID = re.compile(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}')


def fixture_tiles(zoom, multi_zoom, adjacent_tiles, row_tiles=False):
    if sum(map(bool, (multi_zoom, adjacent_tiles, row_tiles))) > 1:
        raise ValueError('Choose either multi-zoom or adjacent tiles, or row tiles')
    if row_tiles:
        return ROW_TILES
    if adjacent_tiles:
        return ADJACENT_TILES
    return (RECOVERY_TILE, RECOVERY_TILES[9]) if multi_zoom else (RECOVERY_TILES[zoom],)


def rn_report(log, pid, *, reopening=False, multi_zoom=False, adjacent_tiles=False, row_tiles=False):
    resources = 3 if multi_zoom or adjacent_tiles or row_tiles else 2
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
    sequences = (['complete'],) if reopening else (expected + ['complete'], expected + ['incomplete', 'complete'])
    if report.get('states') not in sequences:
        raise ValueError('Product recovery did not progress from a saved operation to the completed pack')
    pack_id = report.get('savedPackId' if reopening else 'createdPackId')
    if not isinstance(pack_id, str) or not UUID.fullmatch(pack_id) or report.get('savedPackId') != pack_id:
        raise ValueError('Product saved pack identity differs from the SDK identity')
    if reopening and 'createdPackId' in report:
        raise ValueError('The reopened process created a pack')
    if report.get('status') != {'kind': 'complete', 'packId': pack_id, 'completedResourceCount': resources,
                               'requiredResourceCount': resources, 'completedTileCount': resources - 1} or int(match[1]) != (0 if reopening else resources):
        raise ValueError('Product completion or fixture transport count differs')
    return pack_id, report['states']


def sqlite_rows(path, query):
    read_bounded(path, 256 * 1024)
    with closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)) as connection:
        if connection.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
            raise ValueError(f'Invalid SQLite capture: {path.name}')
        return connection.execute(query).fetchall()


def saved_pack(directory, port, pack_id, *, zoom=8, multi_zoom=False, adjacent_tiles=False, row_tiles=False):
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
    return region_id, description, pack_database(directory, region_id, port, metadata=description, coordinates=fixture_tiles(zoom, multi_zoom, adjacent_tiles, row_tiles)[0],
                                                    extra_coordinates=fixture_tiles(zoom, multi_zoom, adjacent_tiles, row_tiles)[1:])


def verify_recovery(directory, port, pid, *, zoom=8, multi_zoom=False, adjacent_tiles=False, row_tiles=False):
    resources = 3 if multi_zoom or adjacent_tiles or row_tiles else 2
    pack_id, states = rn_report(read_bounded(directory / 'app.log', LOG_LIMIT), pid, multi_zoom=multi_zoom, adjacent_tiles=adjacent_tiles, row_tiles=row_tiles)
    style_bytes, tile_bytes, forwarded = check_transport_logs(directory, port, raster_tile=True,
        coordinates=fixture_tiles(zoom, multi_zoom, adjacent_tiles, row_tiles)[0],
        extra_coordinates=fixture_tiles(zoom, multi_zoom, adjacent_tiles, row_tiles)[1:])
    check_journal(directory / 'budget.journal', raster_tile=True, tile_count=resources - 1)
    region_id, _, pack = saved_pack(directory, port, pack_id, zoom=zoom, multi_zoom=multi_zoom, adjacent_tiles=adjacent_tiles, row_tiles=row_tiles)
    if (pack['styleBodyBytes'], pack['tileBodyBytes']) != (style_bytes, tile_bytes):
        raise ValueError('Linked MapLibre SQLite payload sizes differ from the synthetic responses')
    return {'pid': pid, 'zoom': 9 if adjacent_tiles or row_tiles else zoom, 'states': states, 'regionId': region_id, 'styleBodyBytes': style_bytes, 'tileBodyBytes': tile_bytes,
            'forwardedBytes': forwarded, 'transportCalls': resources, 'serverResponses': resources, 'reservations': resources,
            'completedResources': resources, 'completedTiles': resources - 1, 'tileSha256': pack['tileSha256'],
            **({'zoomRange': [9, 9] if adjacent_tiles or row_tiles else [8, 9], 'tiles': pack['tiles']}
               if multi_zoom or adjacent_tiles or row_tiles else {})}


def verify_reopened(directory, port, first_pid, pid, *, zoom=8, multi_zoom=False, adjacent_tiles=False, row_tiles=False):
    resources = 3 if multi_zoom or adjacent_tiles or row_tiles else 2
    if pid <= 0 or pid == first_pid:
        raise ValueError('Pack reopen requires a new fixture process')
    reopened = directory / 'reopen'
    first_id, _ = rn_report(read_bounded(directory / 'app.log', LOG_LIMIT), first_pid, multi_zoom=multi_zoom, adjacent_tiles=adjacent_tiles, row_tiles=row_tiles)
    restored_id, states = rn_report(read_bounded(reopened / 'app.log', LOG_LIMIT), pid, reopening=True, multi_zoom=multi_zoom, adjacent_tiles=adjacent_tiles, row_tiles=row_tiles)
    if first_id != restored_id or saved_pack(directory, port, first_id, zoom=zoom, multi_zoom=multi_zoom, adjacent_tiles=adjacent_tiles, row_tiles=row_tiles) != saved_pack(reopened, port, restored_id, zoom=zoom, multi_zoom=multi_zoom, adjacent_tiles=adjacent_tiles, row_tiles=row_tiles):
        raise ValueError('Pack ID or stored MapLibre content changed after restart')
    size = JOURNAL_HEADER.size + resources * JOURNAL_RECORD.size
    if read_bounded(directory / 'budget.journal', size) != read_bounded(reopened / 'budget.journal', size):
        raise ValueError('Reopening changed the request journal')
    if read_bounded(reopened / 'server-closed.txt', 32) != b'before=refused\nafter=refused\n':
        raise ValueError('Missing proof that the synthetic HTTPS port was closed')
    return {'pid': pid, 'states': states, 'completedResources': resources, 'completedTiles': resources - 1,
            'transportCalls': 0, 'newReservations': 0, 'newServerResponses': 0}


def verify_saved_style(directory):
    rows = sqlite_rows(directory / OPERATION_DB, 'SELECT style_json, metadata FROM background_map_operation')
    if len(rows) != 1 or not isinstance(rows[0][0], str):
        raise ValueError('Product map did not persist the saved style')
    style, metadata = rows[0]
    digest = hashlib.sha256(style.encode()).hexdigest()
    saved_metadata = json.loads(metadata)
    if not isinstance(saved_metadata, dict) or saved_metadata.get('localStyleSha256') != digest:
        raise ValueError('Product map style differs from the saved style digest')
    rows = sqlite_rows(directory / DATABASE, '''
        SELECT r.data, r.compressed FROM resources r JOIN region_resources link ON link.resource_id=r.id
        WHERE r.kind=1
    ''')
    if len(rows) != 1:
        raise ValueError('Expected one style linked to the saved MapLibre pack')
    body, compressed = rows[0]
    if compressed:
        decoder = zlib.decompressobj()
        try:
            body = decoder.decompress(body, RESERVATION + 1)
        except zlib.error as error:
            raise ValueError('Invalid compressed MapLibre style') from error
        if not decoder.eof or decoder.unused_data:
            raise ValueError('Invalid compressed MapLibre style')
    if body != style.encode():
        raise ValueError('Product map style bytes differ from the linked MapLibre style')
    return digest


def verify_captured_bounds(directory, pid, *, multi_zoom=False, adjacent_tiles=False, row_tiles=False):
    from product_map_sources import verify_source_bounds

    rows = sqlite_rows(directory / OPERATION_DB, 'SELECT style_json, metadata FROM background_map_operation')
    if len(rows) != 1 or not isinstance(rows[0][0], str):
        raise ValueError('Missing stored style for renderer bounds verification')
    style, metadata = rows[0]
    return verify_source_bounds(directory, pid, json.loads(metadata), style, multi_zoom=multi_zoom)


def capture_app_report(command, destination, *, reopening=False, product_map=False, product_tab=False, zoom=8, multi_zoom=False, adjacent_tiles=False, row_tiles=False):
    args = ['--ez', 'fixture-reopen', 'true'] if reopening else []
    if product_map:
        args += ['--ez', 'fixture-product-map', 'true']
    if product_tab:
        args += ['--ez', 'fixture-product-tab', 'true']
    args += ['--ei', 'fixture-zoom', str(zoom)]
    if multi_zoom:
        args += ['--ez', 'fixture-multi-zoom', 'true']
    if adjacent_tiles:
        args += ['--ez', 'fixture-adjacent-tiles', 'true']
    if row_tiles:
        args += ['--ez', 'fixture-row-tiles', 'true']
    launch = command(4096, 'shell', 'am', 'start', '-W', '-n', ACTIVITY, *args, timeout=22)
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
    return pid


def require_server_closed(port):
    with socket.socket() as probe:
        probe.settimeout(2)
        if probe.connect_ex(('127.0.0.1', port)) != errno.ECONNREFUSED:
            raise ValueError('Synthetic HTTPS port must refuse connections')


def capture_recovery(key_path, apk, relay, java, identity, destination, expected_hash, *, reopening=False,
                     product_map=False, product_tab=False, source_bounds=False, zoom=8, multi_zoom=False, adjacent_tiles=False, row_tiles=False):
    port, apk_hash = read_apk(apk, RN_TAB_APK_LIMIT if product_tab else RN_APK_LIMIT)
    if apk_hash != expected_hash:
        raise ValueError('React Native fixture APK hash changed')

    def command(limit, mode, *args, timeout=15):
        return guest_command(key_path, limit, mode, *args, timeout=timeout)

    destination.mkdir(mode=0o700)
    stage_relay(key_path, relay, raster_tile=True, multi_zoom=multi_zoom or adjacent_tiles or row_tiles)
    server_source = Path(__file__).with_name('sdk-smoke') / 'FixtureStyleServer.java'
    relay_log = '/data/local/tmp/trip-rn-relay.log'
    relay_mode = '--multi-zoom' if multi_zoom or adjacent_tiles or row_tiles else '--raster-tile'
    relay_command = (f'CLASSPATH={FIXTURE_RELAY_PATH} app_process /system/bin FixtureLoopbackRelay {port} '
                     f'{relay_mode} > {relay_log} 2>&1; cat {relay_log}')
    with pack_server(java, identity, server_source, port, destination / 'server.log', expire_pack=False, rn_recovery=True, rn_zoom=zoom, multi_zoom=multi_zoom, adjacent_tiles=adjacent_tiles, row_tiles=row_tiles):
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
                pid = capture_app_report(command, destination, zoom=zoom, multi_zoom=multi_zoom, adjacent_tiles=adjacent_tiles, row_tiles=row_tiles)
            except (OSError, ValueError):
                crash = command(LOG_LIMIT * 2, 'logcat', '-d', '-t', '180', '-v', 'threadtime',
                                '-s', TAG + ':V', 'AndroidRuntime:E', 'ReactNativeJS:E', '*:S')
                write_capture(destination / 'diagnostics.log', crash)
                raise
            finally:
                write_capture(destination / 'relay.log', relay_task.result())
    capture_saved_files(command, destination, pid, expected_hash, multi_zoom=multi_zoom, adjacent_tiles=adjacent_tiles, row_tiles=row_tiles)
    result = verify_recovery(destination, port, pid, zoom=zoom, multi_zoom=multi_zoom, adjacent_tiles=adjacent_tiles, row_tiles=row_tiles)
    if reopening:
        require_server_closed(port)
        reopened = destination / 'reopen'
        reopened.mkdir(mode=0o700)
        reopened_pid = capture_app_report(command, reopened, reopening=True, product_map=product_map,
                                           product_tab=product_tab, zoom=zoom, multi_zoom=multi_zoom, adjacent_tiles=adjacent_tiles, row_tiles=row_tiles)
        screen_key = 'productTab' if product_tab else 'productMap'
        if product_map or product_tab:
            from product_map_trial import capture_product_map
            result[screen_key] = capture_product_map(command, reopened, RN_FIXTURE_PACKAGE, ACTIVITY, reopened_pid,
                                                     product_tab=product_tab, source_bounds=source_bounds, zoom=zoom, multi_zoom=multi_zoom, adjacent_tiles=adjacent_tiles, row_tiles=row_tiles)
        capture_saved_files(command, reopened, reopened_pid, expected_hash, multi_zoom=multi_zoom, adjacent_tiles=adjacent_tiles, row_tiles=row_tiles)
        require_server_closed(port)
        write_capture(reopened / 'server-closed.txt', b'before=refused\nafter=refused\n')
        result['reopened'] = verify_reopened(destination, port, pid, reopened_pid, zoom=zoom, multi_zoom=multi_zoom, adjacent_tiles=adjacent_tiles, row_tiles=row_tiles)
        if product_map or product_tab:
            old_style = verify_saved_style(destination)
            if old_style != verify_saved_style(reopened):
                raise ValueError('The saved style changed during the product map switch')
            result[screen_key]['styleSha256'] = old_style
        if source_bounds:
            result[screen_key]['sourceCoverage'] = verify_captured_bounds(reopened, reopened_pid, multi_zoom=multi_zoom, adjacent_tiles=adjacent_tiles, row_tiles=row_tiles)
    return result


def capture_saved_files(command, destination, pid, expected_hash, *, multi_zoom=False, adjacent_tiles=False, row_tiles=False):
    resources = 3 if multi_zoom or adjacent_tiles or row_tiles else 2
    size = JOURNAL_HEADER.size + resources * JOURNAL_RECORD.size
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


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('capture', type=Path)
    parser.add_argument('--port', required=True, type=int)
    parser.add_argument('--pid', required=True, type=int)
    parser.add_argument('--reopened-pid', type=int)
    parser.add_argument('--product-map', action='store_true')
    parser.add_argument('--product-tab', action='store_true')
    parser.add_argument('--source-bounds', action='store_true')
    parser.add_argument('--zoom', type=int, choices=(8, 9), default=8)
    parser.add_argument('--multi-zoom', action='store_true')
    parser.add_argument('--adjacent-tiles', action='store_true')
    parser.add_argument('--row-tiles', action='store_true')
    args = parser.parse_args()
    if (args.product_map or args.product_tab) and args.reopened_pid is None:
        parser.error('Screen verification requires --reopened-pid')
    if args.product_map and args.product_tab:
        parser.error('Choose one screen verification mode')
    if args.source_bounds and not args.product_tab:
        parser.error('--source-bounds requires --product-tab')
    if args.multi_zoom and (not args.source_bounds or args.zoom != 8):
        parser.error('--multi-zoom requires --source-bounds and default --zoom 8')
    if args.adjacent_tiles and (not args.source_bounds or args.multi_zoom or args.zoom != 8):
        parser.error('--adjacent-tiles requires --source-bounds and excludes other zoom options')
    if args.row_tiles and (not args.source_bounds or args.multi_zoom or args.adjacent_tiles or args.zoom != 8):
        parser.error('--row-tiles requires --source-bounds and excludes other tile modes')
    try:
        result = verify_recovery(args.capture, args.port, args.pid, zoom=args.zoom, multi_zoom=args.multi_zoom, adjacent_tiles=args.adjacent_tiles, row_tiles=args.row_tiles)
        if args.reopened_pid is not None:
            result['reopened'] = verify_reopened(args.capture, args.port, args.pid, args.reopened_pid, zoom=args.zoom, multi_zoom=args.multi_zoom, adjacent_tiles=args.adjacent_tiles, row_tiles=args.row_tiles)
        if args.product_map or args.product_tab:
            from product_map_trial import verify_product_map
            screen_key = 'productTab' if args.product_tab else 'productMap'
            result[screen_key] = verify_product_map(args.capture / 'reopen', args.reopened_pid,
                                                   product_tab=args.product_tab, package=RN_FIXTURE_PACKAGE, zoom=args.zoom, multi_zoom=args.multi_zoom, adjacent_tiles=args.adjacent_tiles, row_tiles=args.row_tiles)
            old_style = verify_saved_style(args.capture)
            if old_style != verify_saved_style(args.capture / 'reopen'):
                raise ValueError('The saved style changed during the product map switch')
            result[screen_key]['styleSha256'] = old_style
        if args.source_bounds:
            result[screen_key]['sourceCoverage'] = verify_captured_bounds(args.capture / 'reopen', args.reopened_pid, multi_zoom=args.multi_zoom, adjacent_tiles=args.adjacent_tiles, row_tiles=args.row_tiles)
        print(json.dumps(result, sort_keys=True))
    except (OSError, ValueError, sqlite3.Error) as error:
        parser.exit(1, f'React Native recovery capture failed: {error}\n')
