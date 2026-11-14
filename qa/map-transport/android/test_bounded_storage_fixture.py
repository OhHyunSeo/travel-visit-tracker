"""Portable helper regressions. These do not mount images or apply a sandbox."""
import json
import os
import pathlib
import plistlib
import sys
import tempfile
import time
import unittest
from unittest import mock

import bounded_storage_fixture as fixture


class StorageComponentHelperTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.android = pathlib.Path(self.temporary.name).resolve()
        self.root = self.android / '.build/storage-component/run_012345abcdef'
        self.root.mkdir(parents=True)
        (self.root / 'mount').mkdir()

    def test_arbitrary_or_symlinked_run_directories_are_refused(self):
        self.assertEqual(fixture.owned_root(self.root, self.android), self.root)
        for root in [self.android / 'personal', self.root.parent / 'existing-avd']:
            with self.subTest(root=root), self.assertRaises(fixture.FixtureError):
                fixture.owned_root(root, self.android)
        alias = self.root.parent / 'run_abcdef012345'
        alias.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(fixture.FixtureError):
            fixture.owned_root(alias, self.android)

    def test_worker_refuses_to_fill_an_ordinary_host_directory(self):
        with self.assertRaisesRegex(fixture.FixtureError, 'ordinary directory'):
            fixture.worker(self.root, None, False)
        self.assertEqual(list((self.root / 'mount').iterdir()), [])

    def test_oversized_mounted_volume_is_refused_before_writes(self):
        parent = self.root.stat()
        mount = mock.Mock(st_dev=parent.st_dev + 1)
        space = mock.Mock(f_blocks=65536, f_frsize=4096)
        actual_stat = pathlib.Path.stat

        def mocked_stat(path, *args, **kwargs):
            return mount if path == self.root / 'mount' else actual_stat(path, *args, **kwargs)

        with mock.patch.object(fixture.os.path, 'ismount', return_value=True), \
             mock.patch.object(pathlib.Path, 'stat', mocked_stat), \
             mock.patch.object(fixture.os, 'statvfs', return_value=space), \
             self.assertRaisesRegex(fixture.FixtureError, '32MiB'):
            fixture.mounted_capacity(self.root)

    def test_attach_identity_requires_one_exact_mount_and_device(self):
        mount = self.root / 'mount'
        reply = plistlib.dumps({'system-entities': [
            {'mount-point': str(mount), 'dev-entry': '/dev/disk99'}]})
        self.assertEqual(fixture.attach_device(reply, mount), '/dev/disk99')
        for entities in [[], [{'mount-point': str(mount), 'dev-entry': '/personal/file'}],
                         [{'mount-point': '/other', 'dev-entry': '/dev/disk1'}]]:
            with self.subTest(entities=entities), self.assertRaises(fixture.FixtureError):
                fixture.attach_device(plistlib.dumps({'system-entities': entities}), mount)

    def test_cleanup_selects_only_exact_new_image_attachment(self):
        image = self.root / 'capacity.dmg'
        reply = plistlib.dumps({'images': [
            {'image-path': '/personal/original.dmg', 'system-entities': [{'dev-entry': '/dev/disk1'}]},
            {'image-path': str(image), 'system-entities': [{'dev-entry': '/dev/disk99'}, {'dev-entry': '/dev/disk99s1'}]},
        ]})
        self.assertEqual(fixture.owned_attachments(reply, image), ['/dev/disk99'])
        self.assertEqual(fixture.owned_attachments(reply, self.root / 'other.dmg'), [])

    def test_child_command_really_closes_a_parent_writable_descriptor(self):
        canary = self.root / 'outside-canary'
        canary.write_bytes(b'unchanged')
        descriptor = os.open(canary, os.O_WRONLY | os.O_APPEND)
        os.set_inheritable(descriptor, True)
        try:
            source = ('import os,errno,json\ntry: os.fstat(' + str(descriptor) + ')\n'
                      'except OSError as e: print(json.dumps({"closed":e.errno==errno.EBADF}))\n'
                      'else: print(json.dumps({"closed":False}))\n')
            reply = fixture.command([sys.executable, '-S', '-B', '-c', source], cwd=self.root)
        finally:
            os.close(descriptor)
        self.assertTrue(json.loads(reply)['closed'])
        self.assertEqual(canary.read_bytes(), b'unchanged')

    def test_child_stdin_descriptor_is_actually_read_only(self):
        source = ('import fcntl,os,json; '
                  'print(json.dumps({"readonly":fcntl.fcntl(0,fcntl.F_GETFL)&os.O_ACCMODE==os.O_RDONLY}))')
        reply = fixture.command([sys.executable, '-S', '-B', '-c', source], cwd=self.root)
        self.assertTrue(json.loads(reply)['readonly'])

    def test_output_limit_stops_a_noisy_process_without_disk_capture(self):
        with self.assertRaisesRegex(fixture.FixtureError, 'reporting allowance'):
            fixture.command([sys.executable, '-S', '-B', '-c',
                             'import os; os.write(1,b"x"*200000)'], cwd=self.root)

    def test_timeout_stops_an_owned_process_group(self):
        with mock.patch.object(fixture, 'COMMAND_SECONDS', .1), \
             self.assertRaisesRegex(fixture.FixtureError, 'timed out'):
            fixture.command([sys.executable, '-S', '-B', '-c',
                             'import time; time.sleep(10)'], cwd=self.root)

    def test_timeout_also_stops_child_after_group_leader_has_exited(self):
        canary = self.root / 'delayed-child-write'
        child = 'import time,pathlib; time.sleep(.35); pathlib.Path(' + repr(str(canary)) + ').write_text("escaped")'
        leader = 'import subprocess,sys; subprocess.Popen([sys.executable,"-S","-B","-c",' + repr(child) + '])'
        with mock.patch.object(fixture, 'COMMAND_SECONDS', .1), \
             self.assertRaisesRegex(fixture.FixtureError, 'timed out'):
            fixture.command([sys.executable, '-S', '-B', '-c', leader], cwd=self.root)
        time.sleep(.4)
        self.assertFalse(canary.exists())


if __name__ == '__main__':
    unittest.main()
