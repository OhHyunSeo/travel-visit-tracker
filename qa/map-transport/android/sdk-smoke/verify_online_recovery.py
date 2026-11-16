"""Verify the same MapLibre view refreshed an expired fixture pack online."""

import argparse
import json
from pathlib import Path
import sqlite3
import zlib

from verify_device_capture import (JOURNAL_HEADER, JOURNAL_RECORD, LOG_LIMIT, RESERVATION, check_pack_log,
                                   check_render, check_transport_logs, fixture_messages, read_bounded)
from verify_pack_reopen import pack_database, verify_reopen


ONLINE_TILE_RGB = (52, 121, 206)


def check_online_journal(old_journal, full_journal):
    if not full_journal.startswith(old_journal) or len(full_journal) != len(old_journal) + 2 * JOURNAL_RECORD.size:
        raise ValueError('Expected two new reservations after the original journal')
    kinds = []
    tiles = 1
    for index in (3, 4):
        offset = JOURNAL_HEADER.size + (index - 1) * JOURNAL_RECORD.size
        row = full_journal[offset:offset + JOURNAL_RECORD.size]
        sequence, kind, reserved, count, checksum = JOURNAL_RECORD.unpack(row)
        tiles += kind == 1
        if (sequence, reserved, count, checksum) != (index, index * RESERVATION, tiles, zlib.crc32(row[:-4])):
            raise ValueError('Invalid online journal reservation')
        kinds.append(kind)
    if sorted(kinds) != [0, 1]:
        raise ValueError('Expected exactly one new style and one new tile reservation')


def verify_online(directory, pack, port, first_pid, map_pid):
    offline = verify_reopen(directory, pack, port, first_pid, map_pid, expire_pack=True, sdk_offline=True,
                           online_recovery=True)
    view = offline['viewIdentity']
    online_path = directory / 'online'
    reopen = directory / 'reopen'
    original = fixture_messages(read_bounded(reopen / 'app.log', LOG_LIMIT), map_pid)
    online = fixture_messages(read_bounded(online_path / 'app.log', LOG_LIMIT), map_pid)
    transition = [f'ONLINE_MAP id={pack["packId"]} view={view} connected=true', f'ONLINE_FRAME view={view}',
                  'ONLINE_TRANSPORT calls=2 attempts=4 tiles=2 reserved=16384']
    previous = online[:-len(transition)]
    if online[-len(transition):] != transition or (previous and previous != original[-len(previous):]):
        raise ValueError('Expected same view and PID with two online transport calls and a completed frame')

    style_bytes, tile_bytes, forwarded = check_transport_logs(online_path, port, raster_tile=True, ordered=False)
    old_journal = read_bounded(reopen / 'budget.journal', JOURNAL_HEADER.size + 2 * JOURNAL_RECORD.size)
    full_journal = read_bounded(online_path / 'budget.journal', JOURNAL_HEADER.size + 4 * JOURNAL_RECORD.size)
    check_online_journal(old_journal, full_journal)

    before = pack_database(directory / 'download', pack['packId'], port)
    after = pack_database(online_path, pack['packId'], port)
    if after['definition'] != before['definition'] or after['styleSha256'] != before['styleSha256']:
        raise ValueError('Online refresh changed the pack definition or style body')
    if after['tileSha256'] == before['tileSha256'] or (after['styleBodyBytes'], after['tileBodyBytes']) != (style_bytes, tile_bytes):
        raise ValueError('Online refresh did not store the expected changed tile and response lengths')
    if any(after[key][1] <= before[key][1] for key in ('styleStorage', 'tileStorage')):
        raise ValueError('Refreshed content does not have a newer expiration')
    frame = check_render(online_path / 'screen.png', raster_tile=True, expected_rgb=ONLINE_TILE_RGB)
    return {'offline': offline, 'online': {'packId': pack['packId'], 'pid': map_pid, 'viewIdentity': view,
                                         'transportCalls': 2, 'serverResponses': 2, 'newReservations': 2,
                                         'newReservedBytes': 2 * RESERVATION, 'styleBodyBytes': style_bytes,
                                         'tileBodyBytes': tile_bytes, 'forwardedBytes': forwarded,
                                         'tileSha256': after['tileSha256'], 'renderedFrame': frame}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('capture', type=Path)
    parser.add_argument('--port', required=True, type=int)
    parser.add_argument('--first-pid', required=True, type=int)
    parser.add_argument('--map-pid', required=True, type=int)
    args = parser.parse_args()
    try:
        pack = check_pack_log(read_bounded(args.capture / 'download/app.log', LOG_LIMIT), args.first_pid)
        result = verify_online(args.capture, pack, args.port, args.first_pid, args.map_pid)
    except (OSError, ValueError, sqlite3.Error) as error:
        parser.exit(1, f'Online recovery capture failed: {error}\n')
    print(json.dumps(result, sort_keys=True))
