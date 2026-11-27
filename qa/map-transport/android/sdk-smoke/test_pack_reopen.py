import hashlib
import json
from pathlib import Path
import sqlite3
import struct
from tempfile import TemporaryDirectory
import unittest
import zlib

from verify_pack_reopen import DATABASE, METADATA, body_size, pack_database, verify_reopen
from verify_online_recovery import check_online_journal
from verify_device_capture import JOURNAL_HEADER, JOURNAL_RECORD


class PackReopenTest(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        with sqlite3.connect(self.root / DATABASE) as connection:
            connection.executescript('''
                CREATE TABLE regions (id INTEGER PRIMARY KEY, definition TEXT, description BLOB);
                CREATE TABLE resources (id INTEGER PRIMARY KEY, url TEXT, kind INT, data BLOB,
                                        compressed INT, expires INT, must_revalidate INT);
                CREATE TABLE tiles (id INTEGER PRIMARY KEY, url_template TEXT, z INT, x INT, y INT,
                                    data BLOB, compressed INT, expires INT, must_revalidate INT);
                CREATE TABLE region_resources (region_id INT REFERENCES regions(id), resource_id INT REFERENCES resources(id));
                CREATE TABLE region_tiles (region_id INT REFERENCES regions(id), tile_id INT REFERENCES tiles(id));
                INSERT INTO resources VALUES (1, 'https://127.0.0.1:39443/resource/style/sdk', 1, X'11', 0, 10, 0);
                INSERT INTO tiles VALUES (1, 'https://127.0.0.1:39443/resource/tile/{z}_{x}_{y}', 0, 0, 0, X'22', 0, 10, 0);
                INSERT INTO region_resources VALUES (1, 1);
                INSERT INTO region_tiles VALUES (1, 1);
            ''')
            connection.execute('INSERT INTO regions VALUES (1, ?, ?)', (
                '{"style_url":"https://127.0.0.1:39443/resource/style/sdk","min_zoom":0,"max_zoom":0}', METADATA,
            ))

    def test_read_only_database_reports_both_linked_body_hashes(self):
        content = pack_database(self.root, 1, 39443)
        self.assertEqual(content['styleSha256'], hashlib.sha256(b'\x11').hexdigest())
        self.assertEqual(content['tileSha256'], hashlib.sha256(b'\x22').hexdigest())

    def test_two_zooms_must_be_linked_to_the_same_pack(self):
        with sqlite3.connect(self.root / DATABASE) as connection:
            connection.execute('UPDATE regions SET definition=?', (json.dumps({
                'style_url': 'https://127.0.0.1:39443/resource/style/sdk', 'min_zoom': 8, 'max_zoom': 9}),))
            connection.execute('UPDATE tiles SET z=8,x=219,y=98')
            connection.execute('INSERT INTO tiles SELECT 2,url_template,9,438,197,?,0,10,0 FROM tiles WHERE id=1', (b'blue',))
            connection.execute('INSERT INTO region_tiles VALUES (1,2)')
        kwargs = dict(coordinates=(8,219,98), extra_coordinates=((9,438,197),))
        result = pack_database(self.root, 1, 39443, **kwargs)
        self.assertEqual([tile['coordinates'] for tile in result['tiles']], [(8,219,98), (9,438,197)])
        self.assertEqual(result['tileBodyBytes'], 5)
        with sqlite3.connect(self.root / DATABASE) as connection:
            connection.execute('DELETE FROM region_tiles WHERE tile_id=2')
        with self.assertRaisesRegex(ValueError, 'linked to the pack'):
            pack_database(self.root, 1, 39443, **kwargs)

    def test_adjacent_tiles_require_both_coordinates_at_zoom_nine(self):
        with sqlite3.connect(self.root / DATABASE) as connection:
            connection.execute('UPDATE regions SET definition=?', (json.dumps({
                'style_url': 'https://127.0.0.1:39443/resource/style/sdk', 'min_zoom': 9, 'max_zoom': 9}),))
            connection.execute('UPDATE tiles SET z=9,x=438,y=197')
            connection.execute('INSERT INTO tiles SELECT 2,url_template,9,439,197,?,0,10,0 FROM tiles WHERE id=1', (b'blue',))
            connection.execute('INSERT INTO region_tiles VALUES (1,2)')
        kwargs = dict(coordinates=(9,438,197), extra_coordinates=((9,439,197),))
        self.assertEqual(len(pack_database(self.root, 1, 39443, **kwargs)['tiles']),2)
        with sqlite3.connect(self.root / DATABASE) as connection:
            connection.execute('UPDATE tiles SET x=440 WHERE id=2')
        with self.assertRaisesRegex(ValueError, 'linked to the pack'):
            pack_database(self.root, 1, 39443, **kwargs)

    def test_row_tiles_require_both_y_coordinates_in_one_region(self):
        with sqlite3.connect(self.root / DATABASE) as connection:
            connection.execute('UPDATE regions SET definition=?', (json.dumps({
                'style_url': 'https://127.0.0.1:39443/resource/style/sdk', 'min_zoom': 9, 'max_zoom': 9}),))
            connection.execute('UPDATE tiles SET z=9,x=438,y=196')
            connection.execute('INSERT INTO tiles SELECT 2,url_template,9,438,197,?,0,10,0 FROM tiles WHERE id=1', (b'blue',))
            connection.execute('INSERT INTO region_tiles VALUES (1,2)')
        kwargs = dict(coordinates=(9,438,196), extra_coordinates=((9,438,197),))
        self.assertEqual(len(pack_database(self.root, 1, 39443, **kwargs)['tiles']),2)
        with sqlite3.connect(self.root / DATABASE) as connection:
            connection.execute('UPDATE tiles SET y=198 WHERE id=2')
        with self.assertRaisesRegex(ValueError, 'linked to the pack'):
            pack_database(self.root, 1, 39443, **kwargs)

    def test_rejects_tile_not_linked_to_pack(self):
        with sqlite3.connect(self.root / DATABASE) as connection:
            connection.execute('DELETE FROM region_tiles')
        with self.assertRaisesRegex(ValueError, 'linked to the pack'):
            pack_database(self.root, 1, 39443)

    def test_reopen_rejects_reused_pid_before_reading_evidence(self):
        with self.assertRaisesRegex(ValueError, 'different Android process'):
            verify_reopen(self.root, {}, 39443, 19, 19)

    def test_counts_logical_body_size_and_rejects_oversized_output(self):
        self.assertEqual(body_size(zlib.compress(b'tile'), 1), 4)
        with self.assertRaisesRegex(ValueError, 'expected size'):
            body_size(zlib.compress(b'x' * 4097), 1)

    def test_online_journal_preserves_original_and_accepts_tile_first(self):
        old = bytes(JOURNAL_HEADER.size + 2 * JOURNAL_RECORD.size)
        tile = struct.pack('>IIQI', 3, 1, 12288, 2)
        style = struct.pack('>IIQI', 4, 0, 16384, 2)
        updated = old + tile + struct.pack('>I', zlib.crc32(tile)) + style + struct.pack('>I', zlib.crc32(style))
        check_online_journal(old, updated)
        with self.assertRaisesRegex(ValueError, 'two new reservations'):
            check_online_journal(old, updated[:-JOURNAL_RECORD.size])
        with self.assertRaisesRegex(ValueError, 'Invalid online journal'):
            check_online_journal(old, updated[:-1] + bytes((updated[-1] ^ 1,)))
