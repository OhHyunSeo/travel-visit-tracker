"""Portable host checks; never execute a cached emulator or mount an image."""
import contextlib
import errno
import hashlib
import io
import json
import os
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

import bounded_storage_fixture as fixture
import emulator_bootstrap_probe as probe


class EmulatorBootstrapProbeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name).resolve()
        self.sdk = self.root / 'sdk'
        self.launcher = self.sdk / 'emulator/emulator'
        self.qemu = self.sdk / 'emulator/qemu/darwin-aarch64/qemu-system-aarch64'
        self.qemu.parent.mkdir(parents=True)
        self.launcher.write_bytes(b'not executable: synthetic host fixture')
        self.qemu.write_bytes(b'not an emulator: synthetic host fixture')
        (self.sdk / 'emulator/source.properties').write_text('Pkg.Path=emulator\nPkg.Revision=37.2.12\n')

    def test_loader_checks_existing_cached_files_without_executing_them(self):
        with mock.patch('subprocess.Popen') as execute:
            info = probe.cached_loader(self.sdk)
        execute.assert_not_called()
        self.assertEqual(info['revision'], '37.2.12')
        self.assertEqual(info['sha256']['launcher'], hashlib.sha256(self.launcher.read_bytes()).hexdigest())

    def test_linked_or_missing_loader_is_refused(self):
        self.launcher.unlink()
        self.launcher.symlink_to(self.qemu)
        with self.assertRaises(fixture.FixtureError):
            probe.cached_loader(self.sdk)
        self.launcher.unlink()
        with self.assertRaises(fixture.FixtureError):
            probe.cached_loader(self.sdk)

    def test_hash_refuses_oversized_input_before_opening_it(self):
        value = mock.Mock(st_size=probe.MAX_LOADER_FILE_BYTES + 1)
        with mock.patch.object(probe, '_regular_file', return_value=value), \
             mock.patch.object(probe.os, 'open') as open_file:
            with self.assertRaisesRegex(fixture.FixtureError, 'bounded inspection'):
                probe.bounded_hash(self.qemu)
        open_file.assert_not_called()

    def test_hash_rejects_fifo_swapped_after_inspection_without_waiting(self):
        actual_open = os.open

        def replace(path, flags):
            path.unlink()
            os.mkfifo(path)
            return actual_open(path, flags)

        with mock.patch.object(probe.os, 'open', side_effect=replace):
            with self.assertRaisesRegex(fixture.FixtureError, 'changed identity'):
                probe.bounded_hash(self.qemu)

    def test_hash_rejects_modification_during_read(self):
        actual_read = os.read
        changed = False

        def change_after_read(descriptor, size):
            nonlocal changed
            body = actual_read(descriptor, size)
            if body and not changed:
                changed = True
                self.qemu.write_bytes(b'changed cached fixture with different bytes and size')
            return body

        with mock.patch.object(probe.os, 'read', side_effect=change_after_read):
            with self.assertRaisesRegex(fixture.FixtureError, 'changed while reading'):
                probe.bounded_hash(self.qemu)
    def test_probe_environment_has_no_home_override_or_external_launcher_inputs(self):
        base = {'HOME': '/original/home', 'home': '/original/home', 'CODEX_HOME': '/codex',
                'ANDROID_PRODUCT_OUT': '/personal-build', 'DYLD_INSERT_LIBRARIES': '/inject',
                'http_proxy': 'http://outside', 'ANDROID_AVD_HOME': '/personal-avd',
                'PATH': '/bin', 'LANG': 'C'}
        mount = self.root / 'mount'
        env = probe.probe_environment(base, mount)
        for name in ('HOME', 'home', 'CODEX_HOME', 'ANDROID_PRODUCT_OUT', 'DYLD_INSERT_LIBRARIES', 'http_proxy'):
            self.assertNotIn(name, env)
        for name in ('TMPDIR', 'ANDROID_TMP', 'ANDROID_AVD_HOME', 'ANDROID_EMULATOR_HOME',
                     'ANDROID_USER_HOME', 'ANDROID_PREFS_ROOT', 'XDG_RUNTIME_DIR', 'DARWIN_USER_TEMP_DIR'):
            self.assertTrue(pathlib.Path(env[name]).is_relative_to(mount))

    def test_exact_argv_never_accepts_boot_or_raw_qemu_options(self):
        info = probe.cached_loader(self.sdk)
        info['args'] = ['-avd', 'personal', '-qemu']
        self.assertEqual(probe.version_argv(info), [str(self.launcher), '-version'])

    def test_exit_without_matching_version_is_not_a_pass(self):
        self.assertEqual(probe.validate_version_output(b'Android emulator version 37.2.12.0 (test)\n', '37.2.12'),
                         '37.2.12.0')
        for output in [b'no AVD specified', b'Android emulator version 37.2.11.0', b'other output']:
            with self.subTest(output=output), self.assertRaises(fixture.FixtureError):
                probe.validate_version_output(output, '37.2.12')

    def test_live_external_descriptor_refuses_before_exec_or_logs(self):
        canary = self.root / 'canary'
        canary.write_bytes(b'unchanged')
        descriptor = os.open(canary, os.O_WRONLY)
        try:
            with mock.patch.object(fixture, 'mounted_capacity'), mock.patch.object(probe.os, 'execve') as execute:
                with self.assertRaisesRegex(fixture.FixtureError, 'inherited'):
                    probe.exec_version(self.root, self.sdk, descriptor)
            execute.assert_not_called()
        finally:
            os.close(descriptor)
        self.assertEqual(canary.read_bytes(), b'unchanged')

    def test_closed_fd_preamble_precedes_fixed_exec(self):
        (self.root / 'mount/log').mkdir(parents=True)
        actual_fstat = os.fstat

        def closed_argument_only(descriptor):
            if descriptor == 99999:
                raise OSError(errno.EBADF, 'closed')
            return actual_fstat(descriptor)

        with mock.patch.object(fixture, 'mounted_capacity'), \
             mock.patch.object(probe.os, 'fstat', side_effect=closed_argument_only), \
             mock.patch.object(probe.os, 'execve') as execute:
            probe.exec_version(self.root, self.sdk, 99999)
        body = json.loads((self.root / 'mount/log/loader-preamble.json').read_text())
        self.assertTrue(body['outsideWritableFdClosed'])
        self.assertIsNone(body['avdArgument'])
        self.assertEqual(execute.call_args.args[:2], (str(self.launcher), [str(self.launcher), '-version']))

    def test_cli_rejects_avd_arguments_before_creating_storage(self):
        with mock.patch.object(sys, 'argv', ['fixture', '--probe-emulator-version', '-avd', 'personal']), \
             mock.patch.object(fixture, 'run_fixture') as run, contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                fixture.main()
        run.assert_not_called()

    def test_restricted_worker_does_not_query_home_directory(self):
        root = pathlib.Path(fixture.__file__).resolve().parent / '.build/storage-component/run_012345abcdef'
        with mock.patch.object(sys, 'argv', ['fixture', '--worker', str(root)]), \
             mock.patch.object(pathlib.Path, 'home', side_effect=RuntimeError('not available inside sandbox')), \
             mock.patch.object(fixture, 'worker', return_value={}) as worker, \
             contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(fixture.main(), 0)
        worker.assert_called_once()


if __name__ == '__main__':
    unittest.main()
