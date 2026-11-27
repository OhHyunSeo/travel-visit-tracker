"""Small regular-file tests for controller backing preparation, without native tools.

The 512/1024-byte zero files below are synthetic controller-owned artifacts.
No disk format, mount, emulator, ADB, SDK or personal data is involved.
"""
from __future__ import annotations

import contextlib
import errno
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import bounded_controller as controller
import prepare_controller as preparation


class BackingPreparationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.android = Path(self.temporary.name).resolve()

    def store(self, backing_bytes=None):
        value = controller.ControllerArtifacts.create(
            self.android, limits={"output.txt": 32}, budget_bytes=32,
            backing_bytes=backing_bytes)
        self.addCleanup(value.close)
        return value

    def test_invalid_backing_reservation_is_rejected_before_filesystem_creation(self):
        for value in [0, -512, True, False, 1, 511, 513, 512.0, "512", 64 * 1024 * 1024 + 512]:
            with self.subTest(value=value), self.assertRaises(controller.ControllerError):
                controller.ControllerArtifacts.create(self.android, backing_bytes=value)
            self.assertFalse((self.android / ".build").exists())

    def test_backing_reservation_is_separate_from_outside_file_budget(self):
        value = self.store(512)
        report = value.audit()
        self.assertEqual(report["outsideBudgetBytes"], 32)
        self.assertEqual(report["backingReservedLogicalBytes"], 512)
        self.assertEqual(report["reservedLogicalBytes"], 32 + 512)
        self.assertFalse(report["backingInitialized"])
        self.assertEqual(report["observedOwnedLogicalBytes"], 0)
        self.assertEqual(report["files"]["capacity.raw"]["limitBytes"], 512)
        self.assertEqual((value.root / "capacity.raw").read_bytes(), b"")

    def test_default_has_no_backing_file_or_backing_reservation(self):
        value = self.store()
        report = value.audit()
        self.assertFalse((value.root / "capacity.raw").exists())
        self.assertNotIn("capacity.raw", report["files"])
        self.assertEqual(report["backingReservedLogicalBytes"], 0)
        self.assertEqual(report["reservedLogicalBytes"], 32)
        self.assertFalse(report["backingInitialized"])

    def test_initialization_without_reservation_is_rejected(self):
        value = self.store()
        with self.assertRaises(controller.ControllerError):
            value.initialize_backing()
        self.assertFalse((value.root / "capacity.raw").exists())
        self.assertEqual(value.audit()["status"], "FAILED")

    def test_512_and_1024_byte_backing_initializations_write_every_byte_in_order(self):
        actual_write = os.write
        for size in [512, 1024]:
            with self.subTest(size=size):
                value = self.store(size)
                writes = []

                def observed_write(descriptor, body):
                    offset = os.lseek(descriptor, 0, os.SEEK_CUR)
                    count = actual_write(descriptor, body)
                    writes.append((offset, count))
                    return count

                with mock.patch.object(controller.os, "write", side_effect=observed_write):
                    value.initialize_backing()
                offset = 0
                for observed_offset, count in writes:
                    self.assertEqual(observed_offset, offset)
                    self.assertGreater(count, 0)
                    offset += count
                self.assertEqual(offset, size)
                body = (value.root / "capacity.raw").read_bytes()
                self.assertEqual(body, bytes(size))
                self.assertEqual(hashlib.sha256(body).digest(), hashlib.sha256(bytes(size)).digest())
                report = value.audit()
                self.assertEqual(report["status"], "READY")
                self.assertTrue(report["backingInitialized"])
                self.assertEqual(report["backingReservedLogicalBytes"], size)
                self.assertEqual(report["observedOwnedLogicalBytes"], size)
                self.assertFalse(report["imageFormatted"])
                self.assertFalse(report["nativeAdmissionEnabled"])
                self.assertFalse(report["allocationBoundProven"])

    def test_public_backing_write_is_rejected_before_initialization(self):
        value = self.store(512)
        with self.assertRaises(controller.ControllerError):
            value.write("capacity.raw", b"untrusted")
        self.assertEqual((value.root / "capacity.raw").read_bytes(), b"")
        self.assertEqual(value.audit()["status"], "FAILED")

    def test_public_backing_append_is_rejected_after_initialization(self):
        value = self.store(512)
        value.initialize_backing()
        with self.assertRaises(controller.ControllerError):
            value.write("capacity.raw", b"extra", append=True)
        self.assertEqual((value.root / "capacity.raw").read_bytes(), bytes(512))
        self.assertEqual(value.audit()["status"], "FAILED")

    def test_second_initialization_is_rejected_without_overwriting_evidence(self):
        value = self.store(512)
        value.initialize_backing()
        path = value.root / "capacity.raw"
        before = (path.read_bytes(), path.stat().st_mtime_ns)
        with self.assertRaises(controller.ControllerError):
            value.initialize_backing()
        self.assertEqual((path.read_bytes(), path.stat().st_mtime_ns), before)
        report = value.audit()
        self.assertEqual(report["status"], "FAILED")
        self.assertEqual(report["backingReservedLogicalBytes"], 512)

    def test_partial_initialization_failure_preserves_charge_and_blocks_retry(self):
        value = self.store(512)
        actual_write = os.write
        writes = 0

        def interrupted_write(descriptor, body):
            nonlocal writes
            writes += 1
            if writes == 1:
                return actual_write(descriptor, body[:128])
            raise OSError(errno.EIO, "synthetic backing failure")

        with mock.patch.object(controller.os, "write", side_effect=interrupted_write), \
                self.assertRaises(controller.ControllerError):
            value.initialize_backing()
        path = value.root / "capacity.raw"
        self.assertGreater(path.stat().st_size, 0)
        self.assertLessEqual(path.stat().st_size, 512)
        self.assertEqual(path.read_bytes(), bytes(path.stat().st_size))
        report = value.audit()
        self.assertEqual(report["status"], "FAILED")
        self.assertFalse(report["backingInitialized"])
        self.assertEqual(report["backingReservedLogicalBytes"], 512)
        self.assertEqual(report["reservedLogicalBytes"], 544)
        self.assertEqual(report["observedOwnedLogicalBytes"], path.stat().st_size)
        with self.assertRaises(controller.ControllerError):
            value.initialize_backing()

    def test_zero_progress_initialization_is_terminal_and_not_formatted(self):
        value = self.store(512)
        with mock.patch.object(controller.os, "write", return_value=0), \
                self.assertRaises(controller.ControllerError):
            value.initialize_backing()
        report = value.audit()
        self.assertEqual(report["status"], "FAILED")
        self.assertFalse(report["backingInitialized"])
        self.assertFalse(report["imageFormatted"])
        self.assertFalse(report["nativeAdmissionEnabled"])
        self.assertEqual(report["backingReservedLogicalBytes"], 512)
        with self.assertRaises(controller.ControllerError):
            value.initialize_backing()


class PrepareControllerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.android = Path(self.temporary.name).resolve()

    def assert_final_audit_matches_files(self, report):
        root = Path(report["controllerRoot"])
        audit = report["controllerAudit"]
        actual = {path.name: path.stat() for path in root.iterdir()}
        self.assertEqual(set(audit["files"]), set(actual))
        for name, value in actual.items():
            self.assertEqual(audit["files"][name]["logicalBytes"], value.st_size)
            self.assertEqual(audit["files"][name]["allocatedBytes"], value.st_blocks * 512)
        self.assertEqual(audit["observedOwnedLogicalBytes"], sum(value.st_size for value in actual.values()))
        self.assertEqual(audit["observedOwnedAllocatedBytes"], sum(value.st_blocks * 512 for value in actual.values()))
        self.assertEqual(audit["files"]["result.json"]["logicalBytes"], (root / "result.json").stat().st_size)
        self.assertEqual(report["cleanup"]["status"], "CLOSED")
        self.assertFalse(audit["allocationBoundProven"])
        self.assertFalse(audit["nativeAdmissionEnabled"])
        self.assertFalse(audit["imageFormatted"])
        return root, audit

    def assert_stored_blocked_meaning(self, report, root):
        stored = json.loads((root / "result.json").read_bytes())
        self.assertEqual(stored["status"], "BLOCKED")
        self.assertFalse(stored["nativeAdmissionEnabled"])
        self.assertFalse(stored["imageFormatted"])
        self.assertEqual(stored["backingInitialized"], report["controllerAudit"]["backingInitialized"])
        self.assertTrue(stored["blockers"])
        cleanup = stored["cleanup"]
        self.assertEqual(cleanup.get("status") if isinstance(cleanup, dict) else cleanup, "PENDING")

    def test_default_preparation_writes_bounded_evidence_without_a_backing(self):
        report = preparation.prepare(self.android)
        self.assertEqual(report["status"], "BLOCKED")
        self.assertTrue(report["blockers"])
        self.assertFalse(report["nativeAdmissionEnabled"])
        self.assertFalse(report["imageFormatted"])
        root, audit = self.assert_final_audit_matches_files(report)
        self.assert_stored_blocked_meaning(report, root)
        self.assertEqual(audit["status"], "READY")
        self.assertEqual(audit["outsideBudgetBytes"], controller.MAX_OUTSIDE_BYTES)
        self.assertEqual(audit["backingReservedLogicalBytes"], 0)
        self.assertFalse(audit["backingInitialized"])
        self.assertFalse((root / "capacity.raw").exists())
        self.assertTrue((root / "controller-events.json").read_bytes())
        self.assertTrue((root / "outside-canary").read_bytes())

    def test_preparation_initializes_only_the_requested_small_backing(self):
        for size in [512, 1024]:
            with self.subTest(size=size):
                report = preparation.prepare(self.android, backing_bytes=size)
                self.assertEqual(report["status"], "BLOCKED")
                self.assertTrue(report["blockers"])
                self.assertFalse(report["nativeAdmissionEnabled"])
                root, audit = self.assert_final_audit_matches_files(report)
                self.assert_stored_blocked_meaning(report, root)
                self.assertEqual((root / "capacity.raw").read_bytes(), bytes(size))
                self.assertEqual(audit["backingReservedLogicalBytes"], size)
                self.assertTrue(audit["backingInitialized"])
                self.assertEqual(audit["reservedLogicalBytes"], sum(controller.DEFAULT_LIMITS.values()) + size)

    def test_preparation_closes_actual_store_not_just_cleanup_report(self):
        actual_create = controller.ControllerArtifacts.create
        created = []

        def observed_create(*args, **kwargs):
            value = actual_create(*args, **kwargs)
            created.append(value)
            return value

        with mock.patch.object(controller.ControllerArtifacts, "create", side_effect=observed_create):
            report = preparation.prepare(self.android, backing_bytes=512)
        self.assertEqual(len(created), 1)
        self.assertEqual(report["cleanup"]["status"], "CLOSED")
        with self.assertRaises(controller.ControllerError):
            created[0].audit()

    def test_invalid_prepare_backing_is_rejected_without_run_directory(self):
        with self.assertRaises(controller.ControllerError):
            preparation.prepare(self.android, backing_bytes=513)
        self.assertFalse((self.android / ".build").exists())

    def test_partial_failure_returns_exact_evidence_root_and_real_cleanup(self):
        actual_initialize = controller.ControllerArtifacts.initialize_backing
        actual_write = os.write

        def interrupted_initialize(artifacts):
            calls = 0

            def interrupted_write(descriptor, body):
                nonlocal calls
                calls += 1
                if calls == 1:
                    return actual_write(descriptor, body[:128])
                raise OSError(errno.EIO, "synthetic partial backing failure")

            with mock.patch.object(controller.os, "write", side_effect=interrupted_write):
                actual_initialize(artifacts)

        with mock.patch.object(controller.ControllerArtifacts, "initialize_backing", interrupted_initialize), \
                self.assertRaises(controller.ControllerError) as failure:
            preparation.prepare(self.android, backing_bytes=512)
        error = failure.exception
        root = Path(error.controller_root)
        self.assertEqual(root.parent, self.android / ".build/controller-artifacts")
        self.assertEqual((root / "capacity.raw").read_bytes(), bytes(128))
        self.assertTrue((root / "controller-events.json").read_bytes())
        self.assertEqual(error.cleanup_report["status"], "CLOSED")
        self.assertIsInstance(error.__cause__, controller.ControllerError)

    def test_cli_failed_preparation_identifies_retained_files_and_cleanup(self):
        def failed_initialize(artifacts):
            raise controller.ControllerError("synthetic initialization failure")

        output = io.StringIO()
        with mock.patch.object(controller.ControllerArtifacts, "initialize_backing", failed_initialize), \
                contextlib.redirect_stdout(output):
            code = preparation.main(["--android-root", str(self.android), "--backing-bytes", "512"])
        result = json.loads(output.getvalue())
        self.assertEqual(code, 1)
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["cleanup"]["status"], "CLOSED")
        self.assertEqual(Path(result["controllerRoot"]).parent,
                         self.android / ".build/controller-artifacts")
        self.assertTrue((Path(result["controllerRoot"]) / "capacity.raw").is_file())
        self.assertFalse(result["nativeAdmissionEnabled"])

    def test_cli_success_reports_blocked_exit_two_and_closes_evidence(self):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            code = preparation.main(["--android-root", str(self.android), "--backing-bytes", "512"])
        self.assertEqual(code, 2)
        runs = list((self.android / ".build/controller-artifacts").iterdir())
        self.assertEqual(len(runs), 1)
        stored = json.loads((runs[0] / "result.json").read_bytes())
        self.assertEqual(stored["status"], "BLOCKED")
        self.assertFalse(stored["nativeAdmissionEnabled"])
        self.assertEqual((runs[0] / "capacity.raw").read_bytes(), bytes(512))

    def test_cli_invalid_backing_reports_error_exit_one_without_creating_files(self):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            code = preparation.main(["--android-root", str(self.android), "--backing-bytes", "513"])
        self.assertEqual(code, 1)
        self.assertFalse((self.android / ".build").exists())

    def test_cli_unknown_native_flags_are_rejected_before_preparation(self):
        for flag in ["--avd", "--serial", "--native", "--run-emulator"]:
            with self.subTest(flag=flag), contextlib.redirect_stdout(io.StringIO()), \
                    contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
                preparation.main(["--android-root", str(self.android), flag, "forbidden"])
            self.assertEqual(error.exception.code, 2)
            self.assertFalse((self.android / ".build").exists())

    def test_cli_requires_an_explicit_workspace(self):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()), \
                self.assertRaises(SystemExit) as error:
            preparation.main([])
        self.assertEqual(error.exception.code, 2)
        self.assertFalse((self.android / ".build").exists())


if __name__ == "__main__":
    unittest.main()
