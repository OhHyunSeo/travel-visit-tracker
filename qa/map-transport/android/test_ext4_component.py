import hashlib
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

from ext4_component import BLOCK_BYTES, IMAGE_BYTES, LABEL, formatter_argv, inspect_image, verify_formatter
from single_writer_component import ComponentError


class Ext4ComponentTest(unittest.TestCase):
    def setUp(self):
        root = tempfile.TemporaryDirectory()
        self.addCleanup(root.cleanup)
        self.root = Path(root.name).resolve()
        self.image = self.root / 'fixture.ext4'
        with self.image.open('xb') as output:
            output.truncate(IMAGE_BYTES)
        self.initial = self.image.stat()

    def write_header(self, magic=0xEF53, blocks=IMAGE_BYTES // BLOCK_BYTES, high=0):
        header = bytearray(1024)
        struct.pack_into('<I', header, 4, blocks)
        struct.pack_into('<I', header, 24, 2)
        struct.pack_into('<H', header, 56, magic)
        struct.pack_into('<I', header, 0x150, high)
        header[120:120 + len(LABEL)] = LABEL
        with self.image.open('r+b') as output:
            output.seek(1024)
            output.write(header)

    def test_reads_expected_ext4_layout(self):
        self.write_header()
        layout = inspect_image(self.image, self.initial)
        self.assertEqual(layout['blocks'], 2048)
        self.assertEqual(layout['logicalBytes'], IMAGE_BYTES)

    def test_rejects_non_ext4_or_changed_block_count(self):
        for magic, blocks, high in ((0, 2048, 0), (0xEF53, 2049, 0), (0xEF53, 2048, 1)):
            with self.subTest(magic=magic, blocks=blocks, high=high):
                self.write_header(magic, blocks, high)
                with self.assertRaisesRegex(ComponentError, 'ext4|Ext4'):
                    inspect_image(self.image, self.initial)

    def test_rejects_link_and_growth(self):
        with self.image.open('r+b') as output:
            output.truncate(IMAGE_BYTES + 1)
        with self.assertRaisesRegex(ComponentError, 'identity or size'):
            inspect_image(self.image, self.initial)
        self.image.rename(self.root / 'elsewhere')
        self.image.symlink_to(self.root / 'elsewhere')
        with self.assertRaises(OSError):
            inspect_image(self.image, self.initial)

    def test_verifies_cached_binary_hash(self):
        tool = self.root / 'emulator/bin64/mkfs.ext4'
        tool.parent.mkdir(parents=True)
        tool.write_bytes(b'fake formatter')
        tool.chmod(0o700)
        with self.assertRaisesRegex(ComponentError, 'hash differs'):
            verify_formatter(self.root)
        with patch('ext4_component.FORMATTER_SHA256', hashlib.sha256(tool.read_bytes()).hexdigest()):
            self.assertEqual(verify_formatter(self.root), tool)
            tool.rename(tool.with_name('old'))
            tool.symlink_to(tool.with_name('old'))
            with self.assertRaisesRegex(ComponentError, 'regular executable'):
                verify_formatter(self.root)

    def test_fixed_command_names_only_the_disposable_image(self):
        tool = Path('/sdk/emulator/bin64/mkfs.ext4')
        argv = formatter_argv(tool, self.image)
        self.assertEqual(argv[-11:], [str(tool), '-q', '-F', '-b', '4096', '-E', 'nodiscard', '-L',
                                      'trip-fixture', str(self.image), '2048'])
        self.assertIn(str(IMAGE_BYTES), argv)
