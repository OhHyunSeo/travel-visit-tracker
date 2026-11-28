"""Host-only refusal tests. Never start adb or an emulator."""
import hashlib
import importlib.util
import os
import struct
import json
import pathlib
import tempfile
import sys
import unittest
from unittest import mock

from qa_avd_guard import (
    AvdGuardError, CLAIM, MARKER, MAX_INCREMENTAL_BYTES, claim_first_validation,
    inspect_owned_emulator, read_prepared_avd, validate_process_args, verify_pinned_transport,
)


class OwnedAvdGuardTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = pathlib.Path(self.temporary.name).resolve()
        self.android = self.base / 'android'
        self.sdk = self.base / 'sdk'
        self.image = self.sdk / 'system-images/android-37/test/arm64-v8a'
        self.image.mkdir(parents=True)
        self.name = 'TripPaintingMapTransportQA_012345abcdef'
        self.avd = self.android / '.build/avd' / (self.name + '.avd')
        self.avd.mkdir(parents=True)
        self.config = ('AvdId=' + self.name + '\nimage.sysdir.1=' + str(self.image) + '\n')
        (self.avd / 'config.ini').write_text(self.config)
        self.marker = {
            'schema': 1, 'purpose': 'trip-painting-map-transport-qa',
            'name': self.name, 'path': str(self.avd),
            'source': 'fresh-cached-sdk-system-image',
            'readyForFirstValidation': True,
            'verifiedIncrementalBoundBytes': MAX_INCREMENTAL_BYTES,
            'configSha256': hashlib.sha256(self.config.encode()).hexdigest(),
        }
        self.write_marker()
        self.binary = self.sdk / 'emulator/qemu/darwin-aarch64/qemu-system-aarch64'
        self.argv = [str(self.binary), '-avd', self.name, '-datadir', str(self.avd),
                     '-port', '5562', '-no-snapshot', '-no-window']

    def write_marker(self):
        (self.avd / MARKER).write_text(json.dumps(self.marker))

    def prepared(self):
        return read_prepared_avd(self.avd, self.android, self.sdk)

    def test_all_identity_parts_are_needed_for_the_allowed_shape(self):
        prepared = self.prepared()
        validate_process_args(self.argv, prepared, self.sdk, 5562)
        self.assertEqual(prepared['name'], self.name)

    def test_generic_personal_name_is_refused_even_inside_owned_root(self):
        renamed = self.avd.with_name('Medium_Phone_API_37.0.avd')
        self.avd.rename(renamed)
        with self.assertRaises(AvdGuardError):
            read_prepared_avd(renamed, self.android, self.sdk)

    def test_marker_outside_the_workspace_is_not_an_ownership_proof(self):
        outside = self.base / (self.name + '.avd')
        self.avd.rename(outside)
        with self.assertRaises(AvdGuardError):
            read_prepared_avd(outside, self.android, self.sdk)

    def test_symlinked_avd_or_marker_is_refused(self):
        original = self.avd.with_name('actual')
        self.avd.rename(original)
        self.avd.symlink_to(original, target_is_directory=True)
        with self.assertRaises(AvdGuardError):
            self.prepared()
        self.avd.unlink()
        original.rename(self.avd)
        marker = self.avd / MARKER
        marker.rename(self.avd / 'actual-marker')
        marker.symlink_to(self.avd / 'actual-marker')
        with self.assertRaises(AvdGuardError):
            self.prepared()

    def test_changed_config_or_invalid_marker_cannot_pass(self):
        for field, value in [('schema', True), ('source', 'old-avd-copy'),
                             ('readyForFirstValidation', False), ('name', 'wrong')]:
            with self.subTest(field=field):
                old = self.marker[field]
                self.marker[field] = value
                self.write_marker()
                with self.assertRaises(AvdGuardError):
                    self.prepared()
                self.marker[field] = old
        self.write_marker()
        (self.avd / 'config.ini').write_text(self.config + 'hw.ramSize=2048\n')
        with self.assertRaises(AvdGuardError):
            self.prepared()

    def test_missing_or_unbounded_allocation_evidence_refuses_native_use(self):
        for value in [None, True, 0, -1, MAX_INCREMENTAL_BYTES + 1]:
            with self.subTest(value=value):
                self.marker['verifiedIncrementalBoundBytes'] = value
                self.write_marker()
                with self.assertRaises(AvdGuardError):
                    self.prepared()

    def test_external_or_duplicate_storage_config_is_refused(self):
        for extra in ['disk.dataPartition.path=/personal/userdata.img\n',
                      'sdcard.path=../personal/sdcard.img\n',
                      'disk.cachePartition.path=<temp>\n',
                      'AvdId=' + self.name + '\n']:
            with self.subTest(extra=extra):
                body = self.config + extra
                (self.avd / 'config.ini').write_text(body)
                self.marker['configSha256'] = hashlib.sha256(body.encode()).hexdigest()
                self.write_marker()
                with self.assertRaises(AvdGuardError):
                    self.prepared()

    def test_external_system_image_is_refused(self):
        external = self.base / 'personal'; external.mkdir()
        body = self.config.replace(str(self.image), str(external))
        (self.avd / 'config.ini').write_text(body)
        self.marker['configSha256'] = hashlib.sha256(body.encode()).hexdigest()
        self.write_marker()
        with self.assertRaises(AvdGuardError):
            self.prepared()

    def test_same_name_with_another_live_data_path_is_refused(self):
        argv = list(self.argv); argv[4] = str(self.base / 'personal')
        with self.assertRaises(AvdGuardError):
            validate_process_args(argv, self.prepared(), self.sdk, 5562)

    def test_missing_or_duplicate_datadir_and_snapshot_flags_are_refused(self):
        variants = [self.argv + ['-datadir', str(self.avd)],
                    self.argv[:3] + self.argv[5:],
                    [v for v in self.argv if v != '-no-snapshot']]
        for argv in variants:
            with self.subTest(argv=argv), self.assertRaises(AvdGuardError):
                validate_process_args(argv, self.prepared(), self.sdk, 5562)

    def test_raw_qemu_or_external_storage_override_is_refused(self):
        for extra in [['-qemu', '-drive', 'file=/personal/userdata'],
                      ['-writable-system'], ['-data', '/personal/userdata'],
                      ['-snapshot', 'personal-snapshot'], ['-unknown', 'value']]:
            with self.subTest(extra=extra), self.assertRaises(AvdGuardError):
                validate_process_args(self.argv + extra, self.prepared(), self.sdk, 5562)

    def test_marker_is_one_use_and_preserves_a_previous_claim(self):
        prepared = self.prepared()
        claim_first_validation(prepared, 'synthetic-run')
        payload = (self.avd / CLAIM).read_bytes()
        with self.assertRaises(AvdGuardError):
            self.prepared()
        with self.assertRaises(AvdGuardError):
            claim_first_validation(prepared, 'another-run')
        self.assertEqual((self.avd / CLAIM).read_bytes(), payload)

    def test_missing_preparation_refuses_before_any_host_or_adb_process(self):
        (self.avd / MARKER).unlink()
        with mock.patch('qa_avd_guard.subprocess.run') as run:
            with self.assertRaises(AvdGuardError):
                inspect_owned_emulator('emulator-5562', self.avd, self.android,
                                       self.sdk, self.sdk / 'platform-tools/adb')
            run.assert_not_called()

    def test_physical_or_invalid_serial_refuses_before_process_inspection(self):
        for serial in ['physical-phone', 'emulator-5563', 'emulator-5562;bad', 'emulator-99999']:
            with self.subTest(serial=serial), mock.patch('qa_avd_guard.subprocess.run') as run:
                with self.assertRaises(AvdGuardError):
                    inspect_owned_emulator(serial, self.avd, self.android,
                                           self.sdk, self.sdk / 'platform-tools/adb')
                run.assert_not_called()

    def test_different_console_and_adb_owners_refuse_before_guest_query(self):
        replies = ['123', '456']
        with mock.patch('qa_avd_guard.shutil.which', side_effect=lambda value: '/bin/' + value), \
             mock.patch('qa_avd_guard._read_command', side_effect=replies) as read:
            with self.assertRaises(AvdGuardError):
                inspect_owned_emulator('emulator-5562', self.avd, self.android,
                                       self.sdk, self.sdk / 'platform-tools/adb')
            self.assertEqual(read.call_count, 2)

    def test_live_host_path_is_checked_before_readonly_guest_query(self):
        bad = list(self.argv); bad[4] = '/personal/avd'
        replies = ['123', '123', ' '.join(bad)]
        with mock.patch('qa_avd_guard.shutil.which', side_effect=lambda value: '/bin/' + value), \
             mock.patch('qa_avd_guard._read_command', side_effect=replies) as read:
            with self.assertRaises(AvdGuardError):
                inspect_owned_emulator('emulator-5562', self.avd, self.android,
                                       self.sdk, self.sdk / 'platform-tools/adb')
            self.assertEqual(read.call_count, 3)

    def test_harness_refuses_an_unowned_target_before_any_adb_or_app_command(self):
        source = pathlib.Path(__file__).with_name('run-validation.py')
        spec = importlib.util.spec_from_file_location('map_qa_validation_test', source)
        validation = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(validation)
        argv = [str(source), '--serial', 'emulator-5562', '--qa-avd-dir',
                str(self.base / 'personal.avd'), '--port', '3188']
        with mock.patch.object(sys, 'argv', argv), mock.patch('subprocess.run') as run:
            with self.assertRaises(AvdGuardError):
                validation.main()
            run.assert_not_called()

    def test_unavailable_host_inspection_tools_do_not_fall_back_to_serial(self):
        with mock.patch('qa_avd_guard.shutil.which', return_value=None), \
             mock.patch('qa_avd_guard._read_command') as read:
            with self.assertRaises(AvdGuardError):
                inspect_owned_emulator('emulator-5562', self.avd, self.android,
                                       self.sdk, self.sdk / 'platform-tools/adb')
            read.assert_not_called()

    def test_a_guest_name_mismatch_is_refused_after_host_path_verification(self):
        replies = ['123', '123', ' '.join(self.argv), 'host-start', '321', 'server-start', '7', 'personal-avd\nOK']
        with mock.patch('qa_avd_guard.shutil.which', side_effect=lambda value: '/bin/' + value), \
             mock.patch('qa_avd_guard._read_command', side_effect=replies):
            with self.assertRaises(AvdGuardError):
                inspect_owned_emulator('emulator-5562', self.avd, self.android,
                                       self.sdk, self.sdk / 'platform-tools/adb')

    def test_implicit_storage_symlinks_and_hardlinks_are_refused(self):
        original = self.base / 'personal-userdata.img'
        original.write_bytes(b'owned test fixture')
        target = self.avd / 'userdata-qemu.img'
        target.symlink_to(original)
        with self.assertRaises(AvdGuardError):
            self.prepared()
        target.unlink()
        os.link(original, target)
        with self.assertRaises(AvdGuardError):
            self.prepared()
        self.assertEqual(original.read_bytes(), b'owned test fixture')

    def test_external_or_protocol_qcow_backing_reference_is_refused(self):
        original = self.base / 'personal-userdata.img'
        original.write_bytes(b'owned test fixture')
        target = self.avd / 'userdata-qemu.img.qcow2'
        for name in [str(original), 'json:{"file":"personal"}']:
            encoded = name.encode()
            target.write_bytes(struct.pack('>4sIQI', b'QFI\xfb', 3, 72, len(encoded)) + b'\0' * 52 + encoded)
            with self.subTest(name=name), self.assertRaises(AvdGuardError):
                self.prepared()

    def test_owned_backing_reference_can_be_verified_without_reading_image_bodies(self):
        (self.avd / 'fresh-seed.img').write_bytes(b'owned test seed')
        name = b'fresh-seed.img'
        (self.avd / 'userdata-qemu.img.qcow2').write_bytes(struct.pack('>4sIQI', b'QFI\xfb', 3, 72, len(name)) + b'\0' * 52 + name)
        self.assertEqual(self.prepared()['name'], self.name)

    def test_changed_server_or_emulator_pid_blocks_pinned_transport(self):
        prepared = {**self.prepared(), 'serial': 'emulator-5562', 'hostPid': 123,
                    'hostStarted': 'host-start', 'adbServerPid': 321,
                    'adbServerStarted': 'server-start', 'transportId': 7}
        for replies in [['999'], ['123', '123', '999'],
                        ['123', '123', '321', 'changed-host-start']]:
            with self.subTest(replies=replies), \
                 mock.patch('qa_avd_guard.shutil.which', side_effect=lambda value: '/bin/' + value), \
                 mock.patch('qa_avd_guard._read_command', side_effect=replies):
                with self.assertRaises(AvdGuardError):
                    verify_pinned_transport(prepared, self.sdk)

    def test_cleanup_still_uninstalls_owned_qa_when_fixture_release_fails(self):
        source = pathlib.Path(__file__).with_name('run-validation.py')
        spec = importlib.util.spec_from_file_location('map_qa_cleanup_test', source)
        validation = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(validation)
        # Redirect all generated evidence into this test's owned temporary root.
        validation.__file__ = str(self.android / 'run-validation.py')
        argv = [str(source), '--serial', 'emulator-5562', '--qa-avd-dir', str(self.avd)]
        commands = []

        def command(parts, **kwargs):
            commands.append(parts)
            text = ''
            if parts[-1] == 'getprop sys.boot_completed':
                text = '1'
            elif 'settings get' in parts[-1]:
                text = '0'
            elif parts[-1] == 'cmd package list packages -U app.trippainting.maptransportqa':
                text = 'package:app.trippainting.maptransportqa uid:12345'
            return type('Reply', (), {'returncode': 0, 'stdout': text, 'stderr': ''})()

        class StatsResponse:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self): return b'{"active":0}'

        def fixture(url, **kwargs):
            if url.endswith('/stats'):
                return StatsResponse()
            raise OSError('synthetic fixture unavailable')

        proof = {**self.prepared(), 'transportId': 7}
        with mock.patch.object(sys, 'argv', argv), \
             mock.patch.object(validation, 'require_bounded_launch'), \
             mock.patch.object(validation, 'inspect_owned_emulator', return_value=proof), \
             mock.patch.object(validation, 'claim_first_validation'), \
             mock.patch.object(validation, 'verify_pinned_transport'), \
             mock.patch('subprocess.run', side_effect=command), \
             mock.patch.object(validation.urllib.request, 'urlopen', side_effect=fixture):
            with self.assertRaisesRegex(RuntimeError, 'Owned cleanup incomplete'):
                validation.main()
        self.assertTrue(any('uninstall' in parts for parts in commands))
        self.assertTrue(all('-t' in parts and '-s' not in parts for parts in commands))
        reports = list((self.android / '.build/validation').glob('run_*/cleanup.json'))
        self.assertEqual(len(reports), 1)
        self.assertEqual(json.loads(reports[0].read_text())['failures'][0]['step'], 'fixture-release')

    def test_valid_host_and_guest_identity_return_a_scoped_proof(self):
        replies = ['123', '123', ' '.join(self.argv), 'host-start', '321', 'server-start', '7', self.name + '\nOK']
        with mock.patch('qa_avd_guard.shutil.which', side_effect=lambda value: '/bin/' + value), \
             mock.patch('qa_avd_guard._read_command', side_effect=replies):
            result = inspect_owned_emulator('emulator-5562', self.avd, self.android,
                                            self.sdk, self.sdk / 'platform-tools/adb')
            self.assertEqual(result['hostPid'], 123)
            self.assertEqual(result['path'], str(self.avd))


if __name__ == '__main__':
    unittest.main()
