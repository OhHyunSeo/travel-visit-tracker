"""Compare a synthetic Android offline region across two stopped app processes."""

import argparse
from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3

from verify_device_capture import FRAME_EVENT, LOG_LIMIT, check_journal, check_pack_log, check_render, check_transport_logs, fixture_messages, read_bounded


DATABASE = 'mbgl-offline.db'
METADATA = b'trip-painting-offline-raster-z0-v1'


def pack_database(directory, pack_id, port):
    with closing(sqlite3.connect((directory.resolve() / DATABASE).as_uri() + '?mode=ro', uri=True)) as connection:
        if connection.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
            raise ValueError('Invalid SDK offline database')
        if connection.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('Offline resource links have foreign key errors')
        regions = connection.execute('SELECT id, definition, description FROM regions').fetchall()
        if len(regions) != 1 or regions[0][0] != pack_id or regions[0][2] != METADATA:
            raise ValueError('Expected the original synthetic region and metadata')
        style_url = f'https://127.0.0.1:{port}/resource/style/sdk'
        template = f'https://127.0.0.1:{port}/resource/tile/{{z}}_{{x}}_{{y}}'
        definition = json.loads(regions[0][1])
        if (definition.get('style_url'), definition.get('min_zoom'), definition.get('max_zoom')) != (style_url, 0, 0):
            raise ValueError('SDK region definition has an unexpected style or zoom')
        styles = connection.execute('''
            SELECT r.url, r.kind, r.data, r.compressed, r.expires, r.must_revalidate
            FROM region_resources p JOIN resources r ON p.resource_id = r.id WHERE p.region_id = ?
        ''', (pack_id,)).fetchall()
        tiles = connection.execute('''
            SELECT t.url_template, t.z, t.x, t.y, t.data, t.compressed, t.expires, t.must_revalidate
            FROM region_tiles p JOIN tiles t ON p.tile_id = t.id WHERE p.region_id = ?
        ''', (pack_id,)).fetchall()
    if len(styles) != 1 or styles[0][:2] != (style_url, 1) or not styles[0][2]:
        raise ValueError('Expected one stored style linked to the pack')
    if len(tiles) != 1 or tiles[0][:4] != (template, 0, 0, 0) or not tiles[0][4]:
        raise ValueError('Expected one stored zoom-zero tile linked to the pack')
    style, tile = styles[0], tiles[0]
    return {
        'definition': definition,
        'styleSha256': hashlib.sha256(style[2]).hexdigest(),
        'tileSha256': hashlib.sha256(tile[4]).hexdigest(),
        'styleStorage': style[3:],
        'tileStorage': tile[5:],
    }


def verify_reopen(directory, pack, port, first_pid, second_pid):
    if min(first_pid, second_pid) <= 0 or first_pid == second_pid:
        raise ValueError('Reopen must use a different Android process')
    download = directory / 'download'
    reopen = directory / 'reopen'
    check_transport_logs(download, port, raster_tile=True)
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
    if messages != ['TRANSPORT_READY', summary, 'STYLE_LOADED attempts=2 tiles=1 reserved=8192', FRAME_EVENT,
                    'REOPEN_TRANSPORT calls=0 attempts=2 tiles=1 reserved=8192']:
        raise ValueError('Reopen did not report the original pack, complete frame and zero transport calls')
    before = pack_database(download, pack['packId'], port)
    if pack_database(reopen, pack['packId'], port) != before:
        raise ValueError('The saved region or resource data changed during reopen')
    return {'firstPid': first_pid, 'reopenedPid': second_pid, 'packId': pack['packId'],
            'renderedFrame': check_render(reopen / 'screen.png', raster_tile=True),
            'styleSha256': before['styleSha256'], 'tileSha256': before['tileSha256'],
            'transportCalls': 0, 'newReservations': 0, 'newServerResponses': 0}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('capture', type=Path)
    parser.add_argument('--port', required=True, type=int)
    parser.add_argument('--first-pid', required=True, type=int)
    parser.add_argument('--reopened-pid', required=True, type=int)
    args = parser.parse_args()
    try:
        pack = check_pack_log(read_bounded(args.capture / 'download/app.log', LOG_LIMIT), args.first_pid)
        result = verify_reopen(args.capture, pack, args.port, args.first_pid, args.reopened_pid)
    except (OSError, ValueError, sqlite3.Error) as error:
        parser.exit(1, f'Pack reopen capture failed: {error}\n')
    print(json.dumps(result, sort_keys=True))
