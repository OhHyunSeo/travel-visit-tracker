import hashlib
from pathlib import Path
import tempfile
import unittest

from avd_config_component import stage_fixture_apk
from single_writer_component import ComponentError


class StageFixtureApkTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.source = self.root / 'source.apk'
        self.source.write_bytes(b'checked synthetic APK')
        self.digest = hashlib.sha256(self.source.read_bytes()).hexdigest()

    def test_stages_checked_bytes_once(self):
        size = stage_fixture_apk(self.source, self.digest, self.root)
        self.assertEqual(size, self.source.stat().st_size)
        self.assertEqual((self.root / 'fixture.apk').read_bytes(), self.source.read_bytes())
        with self.assertRaises(FileExistsError):
            stage_fixture_apk(self.source, self.digest, self.root)

    def test_wrong_digest_leaves_no_staged_copy(self):
        with self.assertRaisesRegex(ComponentError, 'size or hash differs'):
            stage_fixture_apk(self.source, '0' * 64, self.root)
        self.assertFalse((self.root / 'fixture.apk').exists())
