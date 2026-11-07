"""Portable single-writer helper tests; never apply an OS sandbox profile.

Fixtures are small synthetic regular files. Only the capture helper is run,
with fixed tiny Python children; no worker/native/SDK/image/mount is executed.
"""
from __future__ import annotations

import contextlib
import errno
import io
import json
import os
from pathlib import Path
import shutil
import stat
import sys
import tempfile
import time
import unittest
from unittest import mock

import bounded_controller as controller
import single_writer_component as component


class SingleWriterFixtureTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="single-writer-host-tests-")
        self.addCleanup(self.temporary.cleanup)
        self.scratch = Path(self.temporary.name).resolve()

    def fixture(self):
        root = component.create_fixture()
        self.addCleanup(shutil.rmtree, root)
        return root

    def test_fresh_fixture_has_private_bounded_regular_files_and_zero_data(self):
        root = self.fixture()
        self.assertTrue(root.is_absolute())
        self.assertEqual(root, root.resolve())
        self.assertRegex(root.name, r"^trip-single-writer-[0-9a-f]{12}-[A-Za-z0-9_]+$")
        self.assertEqual(stat.S_IMODE(root.stat().st_mode), 0o700)
        self.assertEqual(set(path.name for path in root.iterdir()), {"data.bin", "canary.bin", "contract.json"})
        for path in root.iterdir():
            metadata = path.lstat()
            self.assertTrue(stat.S_ISREG(metadata.st_mode))
            self.assertEqual(stat.S_IMODE(metadata.st_mode), 0o600)
            self.assertEqual(metadata.st_uid, os.getuid())
            self.assertEqual(metadata.st_nlink, 1)
        self.assertEqual((root / "data.bin").read_bytes(), bytes(512))
        self.assertEqual((root / "canary.bin").read_bytes(), component.CANARY)
        self.assertLessEqual((root / "contract.json").stat().st_size, 4096)
        inspected = component.inspect_fixture(root)
        self.assertEqual(inspected["body"], bytes(512))
        self.assertEqual(inspected["target"].st_ino, (root / "data.bin").stat().st_ino)

    def test_arbitrary_or_symlink_fixture_directory_is_rejected(self):
        with self.assertRaises(component.ComponentError):
            component.inspect_fixture(self.scratch)
        root = self.fixture()
        alias = self.scratch / "trip-single-writer-012345abcdef-alias"
        alias.symlink_to(root, target_is_directory=True)
        with self.assertRaises(component.ComponentError):
            component.inspect_fixture(alias)

    def test_directory_permissions_and_extra_or_missing_files_are_rejected(self):
        root = self.fixture()
        root.chmod(0o755)
        with self.assertRaises(component.ComponentError):
            component.inspect_fixture(root)
        root.chmod(0o700)
        (root / "unexpected-temp").write_bytes(b"synthetic")
        with self.assertRaises(component.ComponentError):
            component.inspect_fixture(root)
        (root / "unexpected-temp").unlink()
        (root / "data.bin").unlink()
        with self.assertRaises(component.ComponentError):
            component.inspect_fixture(root)

    def test_data_symlink_and_hardlink_are_rejected(self):
        root = self.fixture()
        outside = self.scratch / "synthetic-target"
        outside.write_bytes(bytes(512))
        (root / "data.bin").unlink()
        (root / "data.bin").symlink_to(outside)
        with self.assertRaises(component.ComponentError):
            component.inspect_fixture(root)
        self.assertEqual(outside.read_bytes(), bytes(512))
        other = self.fixture()
        os.link(other / "data.bin", self.scratch / "synthetic-alias")
        with self.assertRaises(component.ComponentError):
            component.inspect_fixture(other)

    def test_replacement_inode_is_rejected_even_for_same_size_zero_bytes(self):
        root = self.fixture()
        path = root / "data.bin"
        previous = path.stat().st_ino
        replacement = root / "replacement"
        replacement.write_bytes(bytes(512))
        replacement.chmod(0o600)
        self.assertNotEqual(replacement.stat().st_ino, previous)
        os.replace(replacement, path)
        with self.assertRaises(component.ComponentError):
            component.inspect_fixture(root)

    def test_data_size_and_file_permissions_are_rejected(self):
        for size in [511, 513]:
            with self.subTest(size=size):
                root = self.fixture()
                (root / "data.bin").write_bytes(bytes(size))
                with self.assertRaises(component.ComponentError):
                    component.inspect_fixture(root)
        root = self.fixture()
        (root / "data.bin").chmod(0o644)
        with self.assertRaises(component.ComponentError):
            component.inspect_fixture(root)

    def test_mutated_canary_and_invalid_or_oversized_contract_are_rejected(self):
        root = self.fixture()
        (root / "canary.bin").write_bytes(b"X" + component.CANARY[1:])
        with self.assertRaises(component.ComponentError):
            component.inspect_fixture(root)
        for body in [b"not-json", b"x" * 4097]:
            with self.subTest(contract=body[:8]):
                other = self.fixture()
                (other / "contract.json").write_bytes(body)
                with self.assertRaises(component.ComponentError):
                    component.inspect_fixture(other)

    def test_contract_device_inode_mismatch_is_rejected(self):
        root = self.fixture()
        path = root / "contract.json"
        contract = json.loads(path.read_bytes())
        contract["inode"] += 1
        path.write_text(json.dumps(contract))
        with self.assertRaises(component.ComponentError):
            component.inspect_fixture(root)

    def test_fixed_launcher_argv_has_only_isolated_python_and_internal_mode(self):
        root = self.fixture()
        argv = component.launcher_argv(root, 123)
        self.assertEqual(argv, [
            str(Path(sys.executable).resolve()), "-I", "-S", "-B",
            str(Path(component.__file__).resolve()), "--launch-worker", str(root), "123",
        ])
        self.assertNotIn("-c", argv)
        self.assertNotIn("--avd", argv)

    def test_environment_drops_home_proxy_python_and_loader_injection(self):
        root = self.fixture()
        with mock.patch.dict(os.environ, {
            "HOME": "/synthetic-home", "HTTPS_PROXY": "http://synthetic.invalid",
            "DYLD_INSERT_LIBRARIES": "/synthetic-library", "PYTHONPATH": "/synthetic-python",
        }):
            environment = component.component_environment(root)
        self.assertEqual(set(environment), {"PATH", "LANG", "TMPDIR"})
        self.assertEqual(environment["LANG"], "C")
        self.assertEqual(Path(environment["TMPDIR"]), root)

    def test_profile_has_no_fork_or_broad_write_exception(self):
        profile = component.PROFILE
        self.assertIn("(deny default)", profile)
        self.assertIn('(allow process-exec (literal (param "PYTHON_EXEC")))', profile)
        self.assertIn('(allow file-write-data (literal (param "DATA_FILE")))', profile)
        self.assertIn('(deny file-read* (subpath (param "PRIVATE_AVD_ROOT")))', profile)
        self.assertNotIn("process-fork", profile)
        self.assertNotIn("file-write*", profile)

    def test_launch_rejects_nonfresh_body_before_limits_or_exec(self):
        root = self.fixture()
        (root / "data.bin").write_bytes(b"Q" * 512)
        with mock.patch.object(component.sys, "platform", "darwin"), \
                mock.patch.object(component, "_fd_closed", return_value=True), \
                mock.patch.object(component.resource, "setrlimit") as limits, \
                mock.patch.object(component.os, "execve") as execute, \
                self.assertRaises(component.ComponentError):
            component.launch_worker(root, 123)
        limits.assert_not_called()
        execute.assert_not_called()

    def test_launch_rejects_still_open_inherited_descriptor_before_fixture_read(self):
        root = self.fixture()
        descriptor = os.open(root / "canary.bin", os.O_WRONLY | os.O_APPEND)
        self.addCleanup(os.close, descriptor)
        with mock.patch.object(component.sys, "platform", "darwin"), \
                mock.patch.object(component, "inspect_fixture") as inspect, \
                mock.patch.object(component.resource, "setrlimit") as limits, \
                mock.patch.object(component.os, "execve") as execute, \
                self.assertRaises(component.ComponentError):
            component.launch_worker(root, descriptor)
        inspect.assert_not_called()
        limits.assert_not_called()
        execute.assert_not_called()

    def test_fixture_fsync_failure_preserves_the_actual_partial_root(self):
        actual_mkdtemp = component.tempfile.mkdtemp
        actual_fsync = os.fsync
        created = []
        sync_calls = 0

        def observed_mkdtemp(*args, **kwargs):
            root = Path(actual_mkdtemp(*args, **kwargs)).resolve()
            created.append(root)
            self.addCleanup(shutil.rmtree, root)
            return str(root)

        def interrupted_fsync(descriptor):
            nonlocal sync_calls
            sync_calls += 1
            if sync_calls == 2:
                raise OSError(errno.EIO, "synthetic second-file fsync failure")
            return actual_fsync(descriptor)

        with mock.patch.object(component.tempfile, "mkdtemp", side_effect=observed_mkdtemp), \
                mock.patch.object(component.os, "fsync", side_effect=interrupted_fsync), \
                self.assertRaises(component.ComponentError) as error:
            component.create_fixture()
        self.assertEqual(len(created), 1)
        self.assertEqual(error.exception.fixture_root, str(created[0]))
        self.assertTrue(created[0].is_dir())
        self.assertEqual((created[0] / "data.bin").read_bytes(), bytes(512))
        self.assertEqual((created[0] / "canary.bin").read_bytes(), component.CANARY)
        self.assertFalse((created[0] / "contract.json").exists())

    def test_fixture_partial_write_failure_keeps_its_root_and_partial_bytes(self):
        actual_mkdtemp = component.tempfile.mkdtemp
        actual_write = os.write
        created = []
        write_calls = 0

        def observed_mkdtemp(*args, **kwargs):
            root = Path(actual_mkdtemp(*args, **kwargs)).resolve()
            created.append(root)
            self.addCleanup(shutil.rmtree, root)
            return str(root)

        def interrupted_write(descriptor, body):
            nonlocal write_calls
            write_calls += 1
            if write_calls == 1:
                return actual_write(descriptor, body[:128])
            raise OSError(errno.EIO, "synthetic partial-fixture write failure")

        with mock.patch.object(component.tempfile, "mkdtemp", side_effect=observed_mkdtemp), \
                mock.patch.object(component.os, "write", side_effect=interrupted_write), \
                self.assertRaises(component.ComponentError) as error:
            component.create_fixture()
        self.assertEqual(len(created), 1)
        self.assertEqual(error.exception.fixture_root, str(created[0]))
        self.assertEqual((created[0] / "data.bin").read_bytes(), bytes(128))
        self.assertFalse((created[0] / "canary.bin").exists())
        self.assertFalse((created[0] / "contract.json").exists())


class WorkerReportTests(unittest.TestCase):
    def report(self):
        return {"pid": 1234, "limits": [512, 512], "logicalBytes": 512,
                "flags": {name: True for name in component.REQUIRED_FLAGS}}

    def encode(self, report):
        return json.dumps(report).encode()

    def test_exact_receipt_is_accepted(self):
        expected = self.report()
        self.assertEqual(component.parse_worker_report(self.encode(expected), 1234), expected)

    def test_every_flag_is_required_and_unknown_flag_is_rejected(self):
        for name in component.REQUIRED_FLAGS:
            with self.subTest(missing=name):
                report = self.report()
                del report["flags"][name]
                with self.assertRaises(component.ComponentError):
                    component.parse_worker_report(self.encode(report), 1234)
        report = self.report()
        report["flags"]["UNRECOGNIZED"] = True
        with self.assertRaises(component.ComponentError):
            component.parse_worker_report(self.encode(report), 1234)

    def test_flag_values_must_be_boolean_true(self):
        for value in [False, 0, 1, "true", None, []]:
            with self.subTest(value=value):
                report = self.report()
                report["flags"][component.REQUIRED_FLAGS[0]] = value
                with self.assertRaises(component.ComponentError):
                    component.parse_worker_report(self.encode(report), 1234)

    def test_pid_and_logical_size_require_exact_values_and_integer_types(self):
        for key, value in [("pid", 1235), ("pid", 1234.0), ("pid", True),
                           ("logicalBytes", 513), ("logicalBytes", 512.0)]:
            with self.subTest(key=key, value=value):
                report = self.report()
                report[key] = value
                with self.assertRaises(component.ComponentError):
                    component.parse_worker_report(self.encode(report), 1234)

    def test_limits_require_two_exact_integer_512_values(self):
        for limits in [[512], [512, 512, 512], [512, 513], [512.0, 512], "512,512"]:
            with self.subTest(limits=limits):
                report = self.report()
                report["limits"] = limits
                with self.assertRaises(component.ComponentError):
                    component.parse_worker_report(self.encode(report), 1234)

    def test_missing_receipt_fields_are_rejected(self):
        for key in self.report():
            with self.subTest(key=key):
                report = self.report()
                del report[key]
                with self.assertRaises(component.ComponentError):
                    component.parse_worker_report(self.encode(report), 1234)

    def test_duplicate_top_level_and_nested_flag_fields_are_rejected(self):
        body = self.encode(self.report())
        top_duplicate = b'{"pid": 1234, ' + body[1:]
        nested_duplicate = body.replace(b'"FD_CLOSED": true', b'"FD_CLOSED": true, "FD_CLOSED": true')
        for value in [top_duplicate, nested_duplicate]:
            with self.subTest(body=value[:32]), self.assertRaises(component.ComponentError):
                component.parse_worker_report(value, 1234)

    def test_empty_overlong_invalid_utf8_and_noisy_output_are_rejected(self):
        valid = self.encode(self.report())
        for body in [b"", b"x" * (component.OUTPUT_BYTES + 1), b"\xff",
                     b"noise\n" + valid, valid + b"\nnoise", b"[]"]:
            with self.subTest(body=body[:16]), self.assertRaises(component.ComponentError):
                component.parse_worker_report(body, 1234)


class CaptureAndCliTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="single-writer-capture-tests-")
        self.addCleanup(self.temporary.cleanup)
        self.scratch = Path(self.temporary.name).resolve()

    def capture(self, source):
        return component._capture(
            [str(Path(sys.executable).resolve()), "-I", "-S", "-B", "-c", source],
            cwd=self.scratch, env=component.component_environment(self.scratch))

    def test_capture_really_closes_parent_fd_and_supplies_read_only_stdin(self):
        canary = self.scratch / "synthetic-canary"
        canary.write_bytes(b"preserve")
        descriptor = os.open(canary, os.O_WRONLY | os.O_APPEND)
        self.addCleanup(os.close, descriptor)
        os.set_inheritable(descriptor, True)
        source = (
            "import errno,fcntl,json,os\n"
            "try: os.fstat(" + str(descriptor) + ")\n"
            "except OSError as e: closed=e.errno==errno.EBADF\n"
            "else: closed=False\n"
            "print(json.dumps({'closed':closed,'readonly':"
            "fcntl.fcntl(0,fcntl.F_GETFL)&os.O_ACCMODE==os.O_RDONLY,'pid':os.getpid()}))\n"
        )
        body, pid = self.capture(source)
        report = json.loads(body)
        self.assertTrue(report["closed"])
        self.assertTrue(report["readonly"])
        self.assertEqual(report["pid"], pid)
        self.assertNotEqual(pid, os.getpid())
        self.assertEqual(canary.read_bytes(), b"preserve")

    def test_capture_accepts_exact_output_allowance(self):
        body, pid = self.capture("import sys; sys.stdout.buffer.write(b'x'*8192); sys.stdout.flush()")
        self.assertEqual(body, b"x" * component.OUTPUT_BYTES)
        self.assertGreater(pid, 0)

    def test_capture_rejects_combined_stdout_stderr_over_allowance(self):
        with self.assertRaises(component.ComponentError):
            self.capture("import os; os.write(1,b'x'*5000); os.write(2,b'y'*5000)")

    def test_capture_rejects_nonzero_child_exit(self):
        with self.assertRaises(component.ComponentError):
            self.capture("raise SystemExit(7)")

    def test_capture_never_signals_a_successfully_waited_pid(self):
        with mock.patch.object(component.os, "killpg") as kill_group:
            body, pid = self.capture("print('done')")
        self.assertEqual(body, b"done\n")
        self.assertGreater(pid, 0)
        kill_group.assert_not_called()

    def test_capture_timeout_stops_child_before_a_delayed_synthetic_write(self):
        late = self.scratch / "must-not-appear"
        source = "import pathlib,time; time.sleep(.4); pathlib.Path(" + repr(str(late)) + ").write_bytes(b'escaped')"
        with mock.patch.object(component, "COMMAND_SECONDS", .1), self.assertRaises(component.ComponentError):
            self.capture(source)
        time.sleep(.45)
        self.assertFalse(late.exists())

    def test_timeout_stops_pipe_holding_child_after_leader_exit_path(self):
        late = self.scratch / "child-must-not-write"
        ready = self.scratch / "leader-reached-exit"
        child = "import pathlib,time; time.sleep(.6); pathlib.Path(" + repr(str(late)) + ").write_bytes(b'escaped')"
        leader = (
            "import os,pathlib,subprocess,sys; "
            "subprocess.Popen([sys.executable,'-I','-S','-B','-c'," + repr(child) + "]); "
            "pathlib.Path(" + repr(str(ready)) + ").write_bytes(b'ok'); os._exit(0)"
        )
        with mock.patch.object(component, "COMMAND_SECONDS", .25), self.assertRaises(component.ComponentError):
            self.capture(leader)
        self.assertEqual(ready.read_bytes(), b"ok")
        time.sleep(.65)
        self.assertFalse(late.exists())

    def test_native_cli_options_are_rejected_before_fixture_creation(self):
        for flag in ["--avd", "--serial", "--sdk-root", "--native"]:
            with self.subTest(flag=flag), mock.patch.object(component, "create_fixture") as create, \
                    mock.patch.object(component, "run_component") as run, \
                    contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()), \
                    self.assertRaises(SystemExit) as error:
                component.main(["--run-component", "--android-root", str(self.scratch), flag, "forbidden"])
            self.assertEqual(error.exception.code, 2)
            create.assert_not_called()
            run.assert_not_called()

    def test_explicit_component_mode_requires_workspace_before_running(self):
        with mock.patch.object(component, "run_component") as run, \
                contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
            component.main(["--run-component"])
        self.assertEqual(error.exception.code, 2)
        run.assert_not_called()

    def test_non_macos_component_is_refused_before_fixture_creation(self):
        with mock.patch.object(component.sys, "platform", "linux"), \
                mock.patch.object(component, "create_fixture") as create, \
                self.assertRaises(component.ComponentError):
            component.run_component(self.scratch)
        create.assert_not_called()


class RunComponentFailureTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="single-writer-flow-tests-")
        self.addCleanup(self.temporary.cleanup)
        self.android = Path(self.temporary.name).resolve()

    def creation_error(self):
        root = self.android / ".build/controller-artifacts/run_012345abcdef"
        root.mkdir(parents=True, mode=0o700)
        (root / "output.txt").write_bytes(b"partial")
        cleanup = {"status": "FAILED", "attemptedDescriptors": 1,
                   "unconfirmedDescriptors": [{"kind": "artifact", "errno": errno.EIO}],
                   "filesRetained": True, "blindRetryAllowed": False}
        return controller.ControllerError(
            "synthetic retained controller creation failure",
            controller_root=str(root), cleanup_report=cleanup)

    def test_controller_creation_error_retains_path_and_cleanup_in_component_error(self):
        failure = self.creation_error()
        with mock.patch.object(component.sys, "platform", "darwin"), \
                mock.patch.object(component.pathlib.Path, "is_file", return_value=True), \
                mock.patch.object(controller.ControllerArtifacts, "create", side_effect=failure), \
                mock.patch.object(component, "create_fixture") as create_fixture, \
                self.assertRaises(component.ComponentError) as error:
            component.run_component(self.android)
        create_fixture.assert_not_called()
        self.assertEqual(error.exception.controller_root, failure.controller_root)
        self.assertEqual(error.exception.cleanup_report, failure.cleanup_report)
        self.assertIsNone(error.exception.fixture_root)
        self.assertEqual((Path(failure.controller_root) / "output.txt").read_bytes(), b"partial")

    def test_cli_returns_structured_creation_failure_with_same_retained_metadata(self):
        failure = self.creation_error()
        output, errors = io.StringIO(), io.StringIO()
        with mock.patch.object(component.sys, "platform", "darwin"), \
                mock.patch.object(component.pathlib.Path, "is_file", return_value=True), \
                mock.patch.object(controller.ControllerArtifacts, "create", side_effect=failure), \
                contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            code = component.main(["--run-component", "--android-root", str(self.android)])
        self.assertEqual(code, 1)
        self.assertEqual(output.getvalue(), "")
        report = json.loads(errors.getvalue())
        self.assertEqual(report["status"], "FAILED")
        self.assertEqual(report["controllerRoot"], failure.controller_root)
        self.assertEqual(report["cleanup"], failure.cleanup_report)
        self.assertIsNone(report["componentRoot"])
        self.assertFalse(report["nativeAdmissionEnabled"])

    def test_failed_final_audit_cannot_return_component_pass(self):
        actual_create_fixture = component.create_fixture
        roots = []

        def observed_fixture():
            root = actual_create_fixture()
            roots.append(root)
            self.addCleanup(shutil.rmtree, root)
            return root

        def fake_capture(argv, *, cwd, env):
            # This mock substitutes only the synthetic overwrite and receipt.
            # It never invokes sandbox-exec, a worker, or an Android binary.
            root = Path(cwd)
            self.assertEqual(root, roots[-1])
            self.assertEqual((root / "data.bin").read_bytes(), bytes(512))
            (root / "data.bin").write_bytes(b"Q" * 512)
            report = {"pid": 4321, "limits": [512, 512], "logicalBytes": 512,
                      "flags": {name: True for name in component.REQUIRED_FLAGS}}
            return json.dumps(report).encode(), 4321

        with mock.patch.object(component.sys, "platform", "darwin"), \
                mock.patch.object(component.pathlib.Path, "is_file", return_value=True), \
                mock.patch.object(component, "create_fixture", side_effect=observed_fixture), \
                mock.patch.object(component, "_capture", side_effect=fake_capture), \
                mock.patch.object(controller.ControllerArtifacts, "audit", return_value={"status": "FAILED"}), \
                self.assertRaises(component.ComponentError) as error:
            component.run_component(self.android)
        self.assertEqual(len(roots), 1)
        self.assertEqual(error.exception.fixture_root, str(roots[0]))
        self.assertEqual(error.exception.cleanup_report["status"], "CLOSED")
        self.assertEqual((roots[0] / "data.bin").read_bytes(), b"Q" * 512)
        self.assertTrue(Path(error.exception.controller_root).is_dir())


if __name__ == "__main__":
    unittest.main()
