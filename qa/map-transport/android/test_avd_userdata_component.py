from pathlib import Path
import struct
import tempfile
import unittest

from avd_userdata_component import VIRTUAL_BYTES, inspect_qcow_info, verify_qcow_header
from single_writer_component import ComponentError


class UserdataInfoTest(unittest.TestCase):
    def test_reads_standalone_allocation(self):
        self.assertEqual(inspect_qcow_info({'format': 'qcow2', 'virtual-size': VIRTUAL_BYTES, 'actual-size': 917_504}), 917_504)

    def test_rejects_backing_capacity_or_allocation_mismatch(self):
        base = {'format': 'qcow2', 'virtual-size': VIRTUAL_BYTES, 'actual-size': 917_504}
        for extra in ({'backing-filename': '/outside'}, {'virtual-size': 0}, {'actual-size': True}, {'format': 'raw'}):
            with self.subTest(extra=extra), self.assertRaises(ComponentError):
                inspect_qcow_info(base | extra)

    def test_header_has_no_backing_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'fixture.qcow2'
            path.write_bytes(struct.pack('>4sIQIIQ', b'QFI\xfb', 3, 0, 0, 16, VIRTUAL_BYTES))
            verify_qcow_header(path)
            path.write_bytes(struct.pack('>4sIQIIQ', b'QFI\xfb', 3, 128, 5, 16, VIRTUAL_BYTES))
            with self.assertRaisesRegex(ComponentError, 'standalone'):
                verify_qcow_header(path)
