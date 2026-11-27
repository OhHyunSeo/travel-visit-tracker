"""Compare a synthetic Android offline region across two stopped app processes."""

import argparse
from contextlib import closing
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import zlib

from verify_device_capture import (FRAME_EVENT, LOG_LIMIT, RESERVATION, check_journal, check_pack_log,
                                   check_render, check_transport_logs, fixture_messages, read_bounded)


DATABASE = 'mbgl-offline.db'
METADATA = b'trip-painting-offline-raster-z0-v1'


def body_size(blob, compressed):
    if compressed == 0:
        return len(blob)
    if compressed != 1:
        raise ValueError('Unknown SDK offline compression flag')
    decoder = zlib.decompressobj()
    try:
        size = len(decoder.decompress(blob, RESERVATION + 1))
    except zlib.error as error:
        raise ValueError('Invalid compressed offline resource') from error
    if not decoder.eof or decoder.unused_data or not 0 < size <= RESERVATION:
        raise ValueError('Offline resource exceeds its expected size or has trailing data')
    return size


def pack_database(directory, pack_id, port, *, metadata=METADATA, coordinates=(0, 0, 0), extra_coordinates=()):
    expected_tiles = sorted((coordinates, *extra_coordinates))
    with closing(sqlite3.connect((directory.resolve() / DATABASE).as_uri() + '?mode=ro', uri=True)) as connection:
        if connection.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
            raise ValueError('Invalid SDK offline database')
        if connection.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('Offline resource links have foreign key errors')
        regions = connection.execute('SELECT id, definition, description FROM regions').fetchall()
        if len(regions) != 1 or regions[0][0] != pack_id or regions[0][2] != metadata:
            raise ValueError('Expected the original synthetic region and metadata')
        style_url = f'https://127.0.0.1:{port}/resource/style/sdk'
        template = f'https://127.0.0.1:{port}/resource/tile/{{z}}_{{x}}_{{y}}'
        definition = json.loads(regions[0][1])
        if (definition.get('style_url'), definition.get('min_zoom'), definition.get('max_zoom')) != (
                style_url, expected_tiles[0][0], expected_tiles[-1][0]):
            raise ValueError('SDK region definition has an unexpected style or zoom')
        styles = connection.execute('''
            SELECT r.url, r.kind, r.data, r.compressed, r.expires, r.must_revalidate
            FROM region_resources p JOIN resources r ON p.resource_id = r.id WHERE p.region_id = ?
        ''', (pack_id,)).fetchall()
        tiles = connection.execute('''
            SELECT t.url_template, t.z, t.x, t.y, t.data, t.compressed, t.expires, t.must_revalidate
            FROM region_tiles p JOIN tiles t ON p.tile_id = t.id WHERE p.region_id = ? ORDER BY t.z, t.x, t.y
        ''', (pack_id,)).fetchall()
    if len(styles) != 1 or styles[0][:2] != (style_url, 1) or not styles[0][2]:
        raise ValueError('Expected one stored style linked to the pack')
    if ([row[:4] for row in tiles] != [(template, *tile) for tile in expected_tiles]
            or any(not row[4] for row in tiles)):
        raise ValueError('Expected all stored fixture tiles linked to the pack')
    style, tile = styles[0], tiles[0]
    result = {
        'definition': definition,
        'styleSha256': hashlib.sha256(style[2]).hexdigest(),
        'tileSha256': hashlib.sha256(tile[4]).hexdigest(),
        'styleStorage': style[3:],
        'tileStorage': tile[5:],
        'storedResourceBytes': len(style[2]) + sum(len(row[4]) for row in tiles),
        'storedTileBytes': sum(len(row[4]) for row in tiles),
        'styleBodyBytes': body_size(style[2], style[3]),
        'tileBodyBytes': sum(body_size(row[4], row[5]) for row in tiles),
    }
    if extra_coordinates:
        result['tiles'] = [{'coordinates': row[1:4], 'sha256': hashlib.sha256(row[4]).hexdigest(),
                            'storage': row[5:], 'bodyBytes': body_size(row[4], row[5])} for row in tiles]
    return result


def verify_reopen(directory, pack, port, first_pid, second_pid, *, expire_pack=False, sdk_offline=False,
                  online_recovery=False):
    if min(first_pid, second_pid) <= 0 or first_pid == second_pid:
        raise ValueError('Reopen must use a different Android process')
    download = directory / 'download'
    reopen = directory / 'reopen'
    style_body_bytes, tile_body_bytes, _ = check_transport_logs(download, port, raster_tile=True)
    check_journal(download / 'budget.journal', raster_tile=True)
    original = check_pack_log(read_bounded(download / 'app.log', LOG_LIMIT), first_pid)
    if any(pack.get(name) != value for name, value in original.items()):
        raise ValueError('Saved download result does not match the first process log')
    if (download / 'budget.journal').read_bytes() != (reopen / 'budget.journal').read_bytes():
        raise ValueError('The reopened process changed the request journal')
    if (download / 'server.log').read_bytes() != (reopen / 'server.log').read_bytes():
        raise ValueError('The server log changed during reopen')
    summary = (f'PACK_REOPENED id={pack["packId"]} resources=2 tiles=1 required=2 '
               f'resourceBytes={pack["storedResourceBytes"]} tileBytes={pack["storedTileBytes"]}')
    messages = fixture_messages(read_bounded(reopen / 'app.log', LOG_LIMIT), second_pid)
    expected = ['TRANSPORT_READY']
    if sdk_offline:
        expected.append('REOPEN_SDK_OFFLINE connected=false')
    expected.extend((summary, 'STYLE_LOADED attempts=2 tiles=1 reserved=8192', FRAME_EVENT))
    view = None
    if online_recovery and len(messages) >= 2:
        offline_view = re.fullmatch(r'OFFLINE_MAP view=([1-9][0-9]*)', messages[-2])
        if not offline_view:
            raise ValueError('Offline map view was not identified')
        view = int(offline_view[1])
        expected.append(messages[-2])
    transport = re.fullmatch(r'REOPEN_TRANSPORT calls=(0|[1-9][0-9]{0,4}) attempts=2 tiles=1 reserved=8192',
                             messages[-1] if messages else '')
    if messages[:-1] != expected or not transport:
        raise ValueError('Reopen did not report the original pack, complete frame and transport count')
    calls = int(transport[1])
    if (sdk_offline or not expire_pack) and calls:
        raise ValueError('A cache-only reopen unexpectedly reached the fixture transport')
    before = pack_database(download, pack['packId'], port)
    if (before['styleBodyBytes'], before['tileBodyBytes']) != (style_body_bytes, tile_body_bytes):
        raise ValueError('Saved response lengths differ from the fixture server lengths')
    if (before['storedResourceBytes'], before['storedTileBytes']) != (pack['storedResourceBytes'], pack['storedTileBytes']):
        raise ValueError('SQLite stored lengths differ from SDK progress')
    if not online_recovery and pack_database(reopen, pack['packId'], port) != before:
        raise ValueError('The saved region or resource data changed during reopen')
    if expire_pack:
        epoch = read_bounded(reopen / 'guest-epoch.txt', 32).strip()
        expiration = (before['styleStorage'][1], before['tileStorage'][1])
        if not epoch.isdigit() or any(not isinstance(value, int) or value >= int(epoch) for value in expiration):
            raise ValueError('Both SQLite resources must have expired before reopen')
    result = {'firstPid': first_pid, 'reopenedPid': second_pid, 'packId': pack['packId'], 'expiredBeforeReopen': expire_pack,
            'sdkOffline': sdk_offline,
            'renderedFrame': check_render(reopen / 'screen.png', raster_tile=True),
            'styleSha256': before['styleSha256'], 'tileSha256': before['tileSha256'],
            'transportCalls': calls, 'newReservations': 0, 'newServerResponses': 0}
    if view is not None:
        result['viewIdentity'] = view
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('capture', type=Path)
    parser.add_argument('--port', required=True, type=int)
    parser.add_argument('--first-pid', required=True, type=int)
    parser.add_argument('--reopened-pid', required=True, type=int)
    parser.add_argument('--expire-pack', action='store_true')
    parser.add_argument('--sdk-offline', action='store_true')
    args = parser.parse_args()
    if args.sdk_offline and not args.expire_pack:
        parser.error('--sdk-offline requires --expire-pack')
    try:
        pack = check_pack_log(read_bounded(args.capture / 'download/app.log', LOG_LIMIT), args.first_pid)
        result = verify_reopen(args.capture, pack, args.port, args.first_pid, args.reopened_pid,
                               expire_pack=args.expire_pack, sdk_offline=args.sdk_offline)
    except (OSError, ValueError, sqlite3.Error) as error:
        parser.exit(1, f'Pack reopen capture failed: {error}\n')
    print(json.dumps(result, sort_keys=True))
