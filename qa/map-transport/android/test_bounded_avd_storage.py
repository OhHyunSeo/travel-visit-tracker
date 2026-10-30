"""Host-only storage blockers; no disk images, mounts, emulator or ADB."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import sys
import tempfile
import types
import unittest
from unittest import mock

import bounded_avd_storage as storage


class BoundedPreparationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name).resolve()
        self.android = self.root / 'android'
        self.android.mkdir()
        self.sdk = self.root / 'sdk'
        self.image = self.sdk / 'system-images/android-37.0/test/arm64-v8a'
        self.image.mkdir(parents=True)
        for name in ('system.img', 'vendor.img', 'kernel-ranchu', 'ramdisk.img'):
            (self.image / name).write_bytes(b'never read this image body')
        (self.image / 'source.properties').write_text('AndroidVersion.ApiLevel=37\n')
        (self.image / 'package.xml').write_text('<localPackage/>')

    def plan(self):
        return storage.build_preparation_plan(self.android, self.sdk, self.image)

    def test_successful_metadata_inspection_is_still_explicitly_blocked(self):
        plan = self.plan()
        self.assertFalse(plan['nativeLaunchAllowed'])
        self.assertFalse(plan['preparationMarkerIssued'])
        codes = {value['code'] for value in plan['blockers']}
        self.assertIn('NO_VERIFIED_WRITE_CONFINEMENT', codes)
        self.assertIn('NO_FIXED_CAPACITY_VOLUME', codes)
        self.assertNotIn('HOST_TOTAL_GROWTH_NOT_BOUNDED', codes)
        self.assertTrue(plan['limitations'])
        self.assertLess(plan['candidateOnly']['volumeBytesIncludingFilesystem'],
                        storage.MAX_INCREMENTAL_BYTES)
        self.assertFalse(plan['candidateOnly']['allocationVerified'])

    def test_missing_factory_userdata_is_not_claimed_as_a_boot_failure(self):
        before = self.plan()
        self.assertIsNone(before['cachedImageFiles']['userdata.img'])
        self.assertIn('FACTORY_USERDATA_PRODUCER_UNVERIFIED',
                      {value['code'] for value in before['blockers']})
        (self.image / 'userdata.img').write_bytes(b'fresh synthetic SDK seed')
        after = self.plan()
        self.assertNotIn('FACTORY_USERDATA_PRODUCER_UNVERIFIED',
                         {value['code'] for value in after['blockers']})
        self.assertIn('FIRST_BOOT_SPACE_UNVERIFIED',
                      {value['code'] for value in after['blockers']})
        self.assertFalse(after['nativeLaunchAllowed'])

    def test_image_bodies_are_neither_read_nor_copied(self):
        actual_open = pathlib.Path.open

        def limited_open(path, *args, **kwargs):
            if path.name in storage.IMAGE_FILES:
                raise AssertionError('Image body read is not part of a preflight')
            return actual_open(path, *args, **kwargs)

        with mock.patch.object(pathlib.Path, 'open', limited_open), \
             mock.patch('subprocess.run') as run:
            plan = self.plan()
        run.assert_not_called()
        self.assertFalse(plan['cachedImageFiles']['system.img']['bodyReadOrCopied'])

    def test_personal_and_parent_traversal_image_paths_are_refused(self):
        personal = self.root / 'personal.avd'
        personal.mkdir()
        for image in [personal, self.image / '../../../../personal.avd']:
            with self.subTest(image=image), self.assertRaises(storage.BoundedStorageError):
                storage.build_preparation_plan(self.android, self.sdk, image)

    def test_symlinked_sdk_inputs_are_refused_without_reading_targets(self):
        personal = self.root / 'personal.img'
        personal.write_bytes(b'original unchanged')
        image = self.image / 'system.img'
        image.unlink()
        image.symlink_to(personal)
        with self.assertRaises(storage.BoundedStorageError):
            self.plan()
        self.assertEqual(personal.read_bytes(), b'original unchanged')
        image.unlink()
        image.write_bytes(b'fresh synthetic seed')
        alias = self.image.parent / 'aliased-image'
        alias.symlink_to(self.image, target_is_directory=True)
        with self.assertRaises(storage.BoundedStorageError):
            storage.build_preparation_plan(self.android, self.sdk, alias)

    def test_missing_or_oversized_metadata_does_not_become_prepared(self):
        path = self.image / 'package.xml'
        path.unlink()
        with self.assertRaises(storage.BoundedStorageError):
            self.plan()
        path.write_bytes(b'x' * (storage.MAX_METADATA_BYTES + 1))
        with self.assertRaises(storage.BoundedStorageError):
            self.plan()

    def test_metadata_read_remains_bounded_if_file_grows_after_stat(self):
        original = storage._regular_file
        metadata = self.image / 'source.properties'

        def grow(path):
            result = original(path)
            if path == metadata:
                path.write_bytes(b'x' * (storage.MAX_METADATA_BYTES + 1))
            return result

        with mock.patch.object(storage, '_regular_file', side_effect=grow), \
             self.assertRaisesRegex(storage.BoundedStorageError, 'changed beyond'):
            self.plan()

    def test_metadata_symlink_fifo_or_regular_replacement_is_refused_after_stat(self):
        original = storage._regular_file
        metadata = self.image / 'source.properties'
        private = self.root / 'private-original'
        private.write_bytes(b'private body must not be read')
        for replacement in ['symlink', 'fifo', 'regular', 'hardlink']:
            metadata.unlink(missing_ok=True)
            metadata.write_text('existing cached metadata')

            def replace(path):
                result = original(path)
                if path == metadata:
                    path.unlink()
                    if replacement == 'symlink':
                        path.symlink_to(private)
                    elif replacement == 'fifo':
                        os.mkfifo(path)
                    elif replacement == 'hardlink':
                        os.link(private, path)
                    else:
                        path.write_text('different inode')
                return result

            with self.subTest(replacement=replacement), \
                 mock.patch.object(storage, '_regular_file', side_effect=replace), \
                 self.assertRaises(storage.BoundedStorageError):
                self.plan()
            self.assertEqual(private.read_bytes(), b'private body must not be read')

    def test_reused_inode_with_changed_size_or_timestamps_is_refused(self):
        path = self.image / 'source.properties'
        expected = path.stat()
        values = {name: getattr(expected, name) for name in (
            'st_mode', 'st_nlink', 'st_dev', 'st_ino', 'st_size',
            'st_mtime_ns', 'st_ctime_ns')}
        for field in ('st_size', 'st_mtime_ns', 'st_ctime_ns'):
            changed = types.SimpleNamespace(**{**values, field: values[field] + 1})
            with self.subTest(field=field), \
                 mock.patch.object(storage.os, 'fstat', return_value=changed), \
                 self.assertRaisesRegex(storage.BoundedStorageError, 'changed since'):
                storage._bounded_metadata(path, expected)

    def test_metadata_changed_during_read_is_refused(self):
        path = self.image / 'source.properties'
        expected = path.stat()
        values = {name: getattr(expected, name) for name in (
            'st_mode', 'st_nlink', 'st_dev', 'st_ino', 'st_size',
            'st_mtime_ns', 'st_ctime_ns')}
        after = types.SimpleNamespace(**{**values, 'st_ctime_ns': expected.st_ctime_ns + 1})
        with mock.patch.object(storage.os, 'fstat', side_effect=[expected, after]), \
             self.assertRaisesRegex(storage.BoundedStorageError, 'changed while'):
            storage._bounded_metadata(path, expected)

    def test_low_headroom_and_missing_boot_inputs_are_separate_blockers(self):
        (self.image / 'ramdisk.img').unlink()
        free = type('Space', (), {'f_bavail': 1024, 'f_frsize': 4096})()
        with mock.patch.object(storage.os, 'statvfs', return_value=free):
            plan = self.plan()
        self.assertEqual(plan['workspaceFreeBytes'], 4_194_304)
        self.assertIn('INSUFFICIENT_CONSERVATIVE_HEADROOM',
                      {value['code'] for value in plan['blockers']})
        missing = next(value for value in plan['blockers']
                       if value['code'] == 'CACHED_BOOT_INPUT_MISSING')
        self.assertEqual(missing['files'], ['ramdisk.img'])

    def test_readonly_preflight_creates_no_files_and_preserves_inputs(self):
        def inventory():
            return {str(path.relative_to(self.root)):
                    hashlib.sha256(path.read_bytes()).hexdigest()
                    for path in self.root.rglob('*') if path.is_file()}

        before = inventory()
        with mock.patch('subprocess.run') as run, mock.patch('os.system') as system:
            self.plan()
        run.assert_not_called()
        system.assert_not_called()
        self.assertEqual(inventory(), before)
        self.assertFalse((self.android / '.build').exists())

    def test_cli_reports_blocked_with_nonzero_status_and_no_output_files(self):
        argv = ['bounded_avd_storage.py', '--sdk-root', str(self.sdk),
                '--system-image', str(self.image)]
        output = io.StringIO()
        with mock.patch.object(sys, 'argv', argv), \
             mock.patch.object(storage, '__file__', str(self.android / 'bounded_avd_storage.py')), \
             contextlib.redirect_stdout(output), mock.patch('subprocess.run') as run:
            status = storage.main()
        self.assertEqual(status, 2)
        self.assertEqual(json.loads(output.getvalue())['status'], 'BLOCKED')
        run.assert_not_called()
        self.assertEqual(list(self.android.iterdir()), [])

    def test_marker_numbers_and_environment_flags_cannot_authorize_native_commands(self):
        # The actual harness must refuse even when the old identity check would
        # accept a forged "verified" number. No host command or output directory.
        path = pathlib.Path(__file__).with_name('run-validation.py')
        spec = importlib.util.spec_from_file_location('map_storage_refusal_test', path)
        validation = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(validation)
        validation.__file__ = str(self.android / 'run-validation.py')
        argv = [str(path), '--serial', 'emulator-5562', '--qa-avd-dir', str(self.android)]
        with mock.patch.object(sys, 'argv', argv), \
             mock.patch.dict(os.environ, {'QA_ALLOW_UNBOUNDED': '1', 'QA_ALLOCATION_VERIFIED': 'true'}), \
             mock.patch.object(validation, 'inspect_owned_emulator', return_value={
                 'verifiedIncrementalBoundBytes': 1, 'readyForFirstValidation': True}) as inspect, \
             mock.patch('subprocess.run') as run:
            with self.assertRaisesRegex(validation.AvdGuardError, 'independently enforced'):
                validation.main()
        inspect.assert_not_called()
        run.assert_not_called()
        self.assertEqual(list(self.android.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
