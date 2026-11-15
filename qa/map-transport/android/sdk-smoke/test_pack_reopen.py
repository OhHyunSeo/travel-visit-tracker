import hashlib
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import unittest

from verify_pack_reopen import DATABASE, METADATA, pack_database, verify_reopen


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

    def test_rejects_tile_not_linked_to_pack(self):
        with sqlite3.connect(self.root / DATABASE) as connection:
            connection.execute('DELETE FROM region_tiles')
        with self.assertRaisesRegex(ValueError, 'linked to the pack'):
            pack_database(self.root, 1, 39443)

    def test_reopen_rejects_reused_pid_before_reading_evidence(self):
        with self.assertRaisesRegex(ValueError, 'different Android process'):
            verify_reopen(self.root, {}, 39443, 19, 19)
