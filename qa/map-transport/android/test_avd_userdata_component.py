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
        for extra in ({'backing-filename': '/outside'}, {'virtual-size': 0}, {'actual-size': True}, {'format': 'raw'},
                      {'format-specific': {'data': {'data-file': '/outside'}}}, {'snapshots': [{'id': '1'}]}):
            with self.subTest(extra=extra), self.assertRaises(ComponentError):
                inspect_qcow_info(base | extra)

    def test_header_has_no_backing_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'fixture.qcow2'
            header = bytearray(104)
            struct.pack_into('>4sIQIIQ', header, 0, b'QFI\xfb', 3, 0, 0, 16, VIRTUAL_BYTES)
            path.write_bytes(header)
            verify_qcow_header(path)
            struct.pack_into('>QI', header, 8, 128, 5)
            path.write_bytes(header)
            with self.assertRaisesRegex(ComponentError, 'standalone'):
                verify_qcow_header(path)

    def test_header_rejects_external_data_bit_and_snapshot_table(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'fixture.qcow2'
            for snapshots, offset, incompatible in ((0, 0, 4), (1, 4096, 0), (0, 4096, 0)):
                with self.subTest(snapshots=snapshots, offset=offset, incompatible=incompatible):
                    header = bytearray(104)
                    struct.pack_into('>4sIQIIQ', header, 0, b'QFI\xfb', 3, 0, 0, 16, VIRTUAL_BYTES)
                    struct.pack_into('>IQQ', header, 60, snapshots, offset, incompatible)
                    path.write_bytes(header)
                    with self.assertRaisesRegex(ComponentError, 'snapshots or unsupported'):
                        verify_qcow_header(path)
