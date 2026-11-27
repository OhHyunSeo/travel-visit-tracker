"""Controller-only regressions using small synthetic regular files.

These tests never create a disk image, mount a volume, or invoke an Android
tool. Passing them is not proof of an OS allocation or native-launch bound.
"""
from __future__ import annotations

import concurrent.futures
import errno
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest import mock

import bounded_controller as controller


class BoundedControllerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.android = Path(self.temporary.name).resolve()

    def store(self, *, limits=None, budget_bytes=128):
        value = controller.ControllerArtifacts.create(
            self.android,
            limits=limits if limits is not None else {"output.txt": 32, "result.json": 64},
            budget_bytes=budget_bytes,
        )
        self.addCleanup(value.close)
        return value

    def assert_failed(self, value):
        report = value.audit()
        self.assertEqual(report["status"], "FAILED")
        self.assertFalse(report["nativeAdmissionEnabled"])
        self.assertFalse(report["allocationBoundProven"])
        return report

    def test_default_limits_are_fixed_and_read_only(self):
        self.assertEqual(sum(controller.DEFAULT_LIMITS.values()), 276 * 1024)
        self.assertEqual(controller.MAX_OUTSIDE_BYTES, 1024 * 1024)
        with self.assertRaises(TypeError):
            controller.DEFAULT_LIMITS["output.txt"] = 1

    def test_default_inventory_is_created_with_reserved_logical_caps(self):
        with controller.ControllerArtifacts.create(self.android) as value:
            report = value.audit()
            self.assertEqual(set(report["files"]), set(controller.DEFAULT_LIMITS))
            self.assertEqual(report["reservedLogicalBytes"], 276 * 1024)
            self.assertEqual(report["observedOwnedLogicalBytes"], 0)
            self.assertEqual(report["status"], "READY")

    def test_invalid_limits_are_rejected_before_creating_anything(self):
        bad_limits = [
            {}, {"../output.txt": 1}, {"/output.txt": 1},
            {"unregistered": 1}, {"output.txt": 0}, {"output.txt": -1},
            {"output.txt": True}, {"output.txt": 1.5},
            {"output.txt": 65537}, {"output.txt": "8"},
        ]
        for limits in bad_limits:
            with self.subTest(limits=limits), self.assertRaises(controller.ControllerError):
                controller.ControllerArtifacts.create(self.android, limits=limits)
            self.assertFalse((self.android / ".build").exists())

    def test_invalid_or_overcommitted_budget_is_rejected_before_creation(self):
        for budget in [0, -1, True, 1.5, 1024 * 1024 + 1]:
            with self.subTest(budget=budget), self.assertRaises(controller.ControllerError):
                controller.ControllerArtifacts.create(
                    self.android, limits={"output.txt": 8}, budget_bytes=budget)
            self.assertFalse((self.android / ".build").exists())
        with self.assertRaises(controller.ControllerError):
            controller.ControllerArtifacts.create(
                self.android, limits={"output.txt": 8, "result.json": 8}, budget_bytes=15)
        self.assertFalse((self.android / ".build").exists())

    def test_relative_and_missing_roots_are_rejected_without_creation(self):
        for path in [Path("relative-root"), self.android / "missing"]:
            with self.subTest(path=path), self.assertRaises(controller.ControllerError):
                controller.ControllerArtifacts.create(path, limits={"output.txt": 8})
        self.assertEqual(list(self.android.iterdir()), [])

    def test_symlinked_root_is_rejected_without_writing_to_target(self):
        actual = self.android / "actual"
        actual.mkdir()
        alias = self.android / "alias"
        alias.symlink_to(actual, target_is_directory=True)
        with self.assertRaises(controller.ControllerError):
            controller.ControllerArtifacts.create(alias, limits={"output.txt": 8})
        self.assertEqual(list(actual.iterdir()), [])

    def test_symlinked_build_or_controller_parent_is_rejected(self):
        outside = self.android / "outside"
        outside.mkdir()
        build = self.android / ".build"
        build.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(controller.ControllerError):
            controller.ControllerArtifacts.create(self.android, limits={"output.txt": 8})
        self.assertEqual(list(outside.iterdir()), [])
        build.unlink()
        build.mkdir()
        (build / "controller-artifacts").symlink_to(outside, target_is_directory=True)
        with self.assertRaises(controller.ControllerError):
            controller.ControllerArtifacts.create(self.android, limits={"output.txt": 8})
        self.assertEqual(list(outside.iterdir()), [])

    def test_regular_file_cannot_be_used_as_parent_directory(self):
        (self.android / ".build").write_bytes(b"preserve")
        with self.assertRaises(controller.ControllerError):
            controller.ControllerArtifacts.create(self.android, limits={"output.txt": 8})
        self.assertEqual((self.android / ".build").read_bytes(), b"preserve")

    def test_new_runs_are_distinct_and_preserve_previous_files(self):
        first = self.store()
        first.write("output.txt", b"first")
        second = self.store()
        self.assertNotEqual(first.root, second.root)
        self.assertEqual(first.root.parent, self.android / ".build/controller-artifacts")
        self.assertRegex(first.root.name, r"^run_[0-9a-f]{12}$")
        self.assertEqual((first.root / "output.txt").read_bytes(), b"first")
        self.assertEqual((second.root / "output.txt").read_bytes(), b"")

    def test_run_name_collision_does_not_reuse_or_overwrite_existing_files(self):
        fixed_uuid = mock.Mock(hex="012345abcdef" * 3)
        with mock.patch.object(controller.uuid, "uuid4", return_value=fixed_uuid):
            first = self.store()
            first.write("output.txt", b"preserve")
            with self.assertRaises(controller.ControllerError):
                self.store()
        self.assertEqual((first.root / "output.txt").read_bytes(), b"preserve")
        self.assertEqual(first.audit()["status"], "READY")

    def test_partial_constructor_failure_closes_all_opened_descriptors(self):
        actual_open = os.open
        opened = []

        def failing_open(path, *args, **kwargs):
            if path == "result.json":
                raise OSError(errno.EIO, "synthetic constructor failure")
            descriptor = actual_open(path, *args, **kwargs)
            opened.append(descriptor)
            return descriptor

        with mock.patch.object(controller.os, "open", side_effect=failing_open), \
                self.assertRaises(controller.ControllerError):
            self.store()
        for descriptor in opened:
            with self.assertRaises(OSError) as error:
                os.fstat(descriptor)
            self.assertEqual(error.exception.errno, errno.EBADF)
        retained = list((self.android / ".build/controller-artifacts").glob("run_*/output.txt"))
        self.assertEqual(len(retained), 1)
        self.assertEqual(retained[0].read_bytes(), b"")

    def test_owned_files_are_private_regular_and_descriptors_non_inheritable(self):
        actual_open = os.open
        inheritable = []

        def observed_open(*args, **kwargs):
            descriptor = actual_open(*args, **kwargs)
            inheritable.append(os.get_inheritable(descriptor))
            return descriptor

        with mock.patch.object(controller.os, "open", side_effect=observed_open):
            value = self.store()
        self.assertTrue(inheritable)
        self.assertFalse(any(inheritable))
        self.assertEqual(stat.S_IMODE(value.root.stat().st_mode), 0o700)
        for path in value.root.iterdir():
            self.assertTrue(stat.S_ISREG(path.lstat().st_mode))
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(path.stat().st_nlink, 1)

    def test_boundary_write_then_shorter_replace_removes_old_tail(self):
        value = self.store(limits={"output.txt": 8})
        value.write("output.txt", b"12345678")
        self.assertEqual((value.root / "output.txt").read_bytes(), b"12345678")
        value.write("output.txt", b"ab")
        self.assertEqual((value.root / "output.txt").read_bytes(), b"ab")
        value.write("output.txt", b"")
        self.assertEqual((value.root / "output.txt").read_bytes(), b"")
        self.assertEqual(value.audit()["observedOwnedLogicalBytes"], 0)

    def test_over_cap_replace_is_rejected_before_mutating_existing_bytes(self):
        value = self.store(limits={"output.txt": 8})
        value.write("output.txt", b"preserve")
        with self.assertRaises(controller.ControllerError):
            value.write("output.txt", b"too-many!")
        self.assertEqual((value.root / "output.txt").read_bytes(), b"preserve")
        self.assert_failed(value)
        with self.assertRaises(controller.ControllerError):
            value.write("output.txt", b"retry")

    def test_append_enforces_final_size_not_only_new_chunk_size(self):
        value = self.store(limits={"output.txt": 8})
        value.write("output.txt", b"1234")
        value.write("output.txt", b"5678", append=True)
        with self.assertRaises(controller.ControllerError):
            value.write("output.txt", b"9", append=True)
        self.assertEqual((value.root / "output.txt").read_bytes(), b"12345678")
        self.assert_failed(value)

    def test_json_uses_the_same_bounded_writer(self):
        value = self.store(limits={"result.json": 64})
        value.write_json("result.json", {"synthetic": True})
        self.assertEqual(json.loads((value.root / "result.json").read_bytes()), {"synthetic": True})
        before = (value.root / "result.json").read_bytes()
        with self.assertRaises(controller.ControllerError):
            value.write_json("result.json", {"body": "x" * 100})
        self.assertEqual((value.root / "result.json").read_bytes(), before)
        self.assert_failed(value)

    def test_invalid_json_is_terminal_and_preserves_previous_report(self):
        for bad_value in [float("nan"), object()]:
            with self.subTest(value=type(bad_value).__name__):
                value = self.store()
                value.write_json("result.json", {"preserve": True})
                before = (value.root / "result.json").read_bytes()
                with self.assertRaises(controller.ControllerError):
                    value.write_json("result.json", bad_value)
                self.assertEqual((value.root / "result.json").read_bytes(), before)
                self.assert_failed(value)

    def test_unknown_output_name_cannot_create_or_escape(self):
        value = self.store()
        with self.assertRaises(controller.ControllerError):
            value.write("../escape", b"no")
        self.assertFalse((value.root.parent / "escape").exists())
        self.assert_failed(value)

    def test_unregistered_file_in_inventory_prevents_next_write(self):
        value = self.store()
        value.write("output.txt", b"preserve")
        (value.root / "unexpected-temp").write_bytes(b"foreign")
        with self.assertRaises(controller.ControllerError):
            value.write("output.txt", b"changed")
        self.assertEqual((value.root / "output.txt").read_bytes(), b"preserve")
        self.assert_failed(value)

    def test_symlink_replacement_does_not_write_outside_canary(self):
        value = self.store()
        value.write("output.txt", b"original")
        outside = self.android / "synthetic-canary"
        outside.write_bytes(b"outside")
        path = value.root / "output.txt"
        path.unlink()
        path.symlink_to(outside)
        with self.assertRaises(controller.ControllerError):
            value.write("output.txt", b"changed")
        self.assertEqual(outside.read_bytes(), b"outside")
        report = self.assert_failed(value)
        self.assertEqual(report["observedOwnedLogicalBytes"], 8)
        self.assertEqual(report["openUnlinkedLogicalBytes"], 8)

    def test_hardlink_is_rejected_before_alias_bytes_are_changed(self):
        value = self.store()
        value.write("output.txt", b"original")
        alias = self.android / "synthetic-hardlink"
        os.link(value.root / "output.txt", alias)
        with self.assertRaises(controller.ControllerError):
            value.write("output.txt", b"changed")
        self.assertEqual(alias.read_bytes(), b"original")
        self.assert_failed(value)

    def test_open_unlinked_file_remains_charged_and_reservation_is_not_refunded(self):
        value = self.store(limits={"output.txt": 8, "result.json": 8}, budget_bytes=16)
        value.write("output.txt", b"12345678")
        (value.root / "output.txt").unlink()
        report = self.assert_failed(value)
        self.assertEqual(report["reservedLogicalBytes"], 16)
        self.assertEqual(report["observedOwnedLogicalBytes"], 8)
        self.assertEqual(report["openUnlinkedLogicalBytes"], 8)
        with self.assertRaises(controller.ControllerError):
            value.write("result.json", b"retry")

    def test_replacement_inode_is_not_followed_or_used_as_new_budget(self):
        value = self.store()
        value.write("output.txt", b"original")
        original = self.android / "retained-original"
        path = value.root / "output.txt"
        path.rename(original)
        path.write_bytes(b"decoy")
        with self.assertRaises(controller.ControllerError):
            value.write("output.txt", b"changed")
        self.assertEqual(original.read_bytes(), b"original")
        self.assertEqual(path.read_bytes(), b"decoy")
        self.assertEqual(self.assert_failed(value)["observedOwnedLogicalBytes"], 8)

    def test_same_size_external_mutation_is_detected(self):
        value = self.store()
        value.write("output.txt", b"original")
        path = value.root / "output.txt"
        previous = path.stat()
        path.write_bytes(b"external")
        os.utime(path, ns=(previous.st_atime_ns, previous.st_mtime_ns + 1_000_000_000))
        with self.assertRaises(controller.ControllerError):
            value.write("output.txt", b"changed")
        self.assertEqual(path.read_bytes(), b"external")
        self.assert_failed(value)

    def test_directory_rename_and_replacement_prevents_write(self):
        value = self.store()
        value.write("output.txt", b"original")
        moved = value.root.with_name(value.root.name + "_moved")
        value.root.rename(moved)
        value.root.mkdir(mode=0o700)
        (value.root / "output.txt").write_bytes(b"decoy")
        with self.assertRaises(controller.ControllerError):
            value.write("output.txt", b"changed")
        self.assertEqual((moved / "output.txt").read_bytes(), b"original")
        self.assertEqual((value.root / "output.txt").read_bytes(), b"decoy")
        self.assert_failed(value)

    def test_short_writes_are_completed_without_losing_bytes(self):
        value = self.store()
        actual_write = os.write

        def short_write(descriptor, body):
            return actual_write(descriptor, body[:max(1, len(body) // 2)])

        with mock.patch.object(controller.os, "write", side_effect=short_write):
            value.write("output.txt", b"123456789abcdef")
        self.assertEqual((value.root / "output.txt").read_bytes(), b"123456789abcdef")
        self.assertEqual(value.audit()["status"], "READY")

    def test_zero_progress_write_fails_without_loop_or_success_report(self):
        value = self.store()
        with mock.patch.object(controller.os, "write", return_value=0), \
                self.assertRaises(controller.ControllerError):
            value.write("output.txt", b"data")
        self.assert_failed(value)

    def test_partial_write_error_poison_preserves_evidence_and_blocks_reuse(self):
        value = self.store()
        actual_write = os.write
        calls = 0

        def interrupted_write(descriptor, body):
            nonlocal calls
            calls += 1
            if calls == 1:
                return actual_write(descriptor, body[:2])
            raise OSError(errno.EIO, "synthetic write failure")

        with mock.patch.object(controller.os, "write", side_effect=interrupted_write), \
                self.assertRaises(controller.ControllerError):
            value.write("output.txt", b"abcdef")
        self.assertEqual((value.root / "output.txt").read_bytes(), b"ab")
        report = self.assert_failed(value)
        self.assertEqual(report["observedOwnedLogicalBytes"], 2)
        with self.assertRaises(controller.ControllerError):
            value.write("output.txt", b"retry")

    def test_concurrent_appends_are_serialized_under_one_budget(self):
        value = self.store(limits={"output.txt": 32}, budget_bytes=32)
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as workers:
            jobs = [workers.submit(value.write, "output.txt", b"abcd", append=True) for _ in range(8)]
            for job in jobs:
                job.result()
        self.assertEqual((value.root / "output.txt").read_bytes(), b"abcd" * 8)
        report = value.audit()
        self.assertEqual(report["status"], "READY")
        self.assertEqual(report["reservedLogicalBytes"], 32)
        self.assertEqual(report["observedOwnedLogicalBytes"], 32)

    def test_close_is_idempotent_and_preserves_files_but_revokes_api(self):
        value = self.store()
        value.write("output.txt", b"preserve")
        value.close()
        value.close()
        self.assertEqual((value.root / "output.txt").read_bytes(), b"preserve")
        with self.assertRaises(controller.ControllerError):
            value.write("output.txt", b"changed")
        with self.assertRaises(controller.ControllerError):
            value.audit()

    def test_close_failure_is_reported_and_closed_fd_numbers_are_not_retried(self):
        value = controller.ControllerArtifacts.create(
            self.android, limits={"output.txt": 32, "result.json": 64}, budget_bytes=128)
        self.addCleanup(lambda: value.close() if value.cleanup_report is None else None)
        value.write("output.txt", b"preserve")
        actual_close = os.close
        closed = []

        def uncertain_close(descriptor):
            actual_close(descriptor)
            closed.append(descriptor)
            if len(closed) == 1:
                raise OSError(errno.EIO, "synthetic uncertain close")

        with mock.patch.object(controller.os, "close", side_effect=uncertain_close):
            with self.assertRaises(controller.ControllerError) as failure:
                value.close()
            count = len(closed)
            self.assertEqual(failure.exception.cleanup_report["status"], "FAILED")
            with self.assertRaises(controller.ControllerError):
                value.close()
            self.assertEqual(len(closed), count)
        self.assertEqual(value.cleanup_report["status"], "FAILED")
        self.assertFalse(value.cleanup_report["blindRetryAllowed"])
        self.assertEqual(len(value.cleanup_report["unconfirmedDescriptors"]), 1)
        self.assertEqual((value.root / "output.txt").read_bytes(), b"preserve")
        for descriptor in closed:
            with self.assertRaises(OSError) as failure:
                os.fstat(descriptor)
            self.assertEqual(failure.exception.errno, errno.EBADF)

    def test_constructor_failure_exposes_cleanup_uncertainty(self):
        actual_open, actual_close = os.open, os.close
        first = True

        def failing_open(path, *args, **kwargs):
            if path == "result.json":
                raise OSError(errno.EIO, "synthetic preparation failure")
            return actual_open(path, *args, **kwargs)

        def uncertain_close(descriptor):
            nonlocal first
            actual_close(descriptor)
            if first:
                first = False
                raise OSError(errno.EIO, "synthetic uncertain cleanup")

        with mock.patch.object(controller.os, "open", side_effect=failing_open), \
                mock.patch.object(controller.os, "close", side_effect=uncertain_close), \
                self.assertRaisesRegex(controller.ControllerError, "cleanup is unconfirmed") as failure:
            self.store()
        self.assertEqual(failure.exception.cleanup_report["status"], "FAILED")
        self.assertIsInstance(failure.exception.__cause__, OSError)

    def test_context_manager_closes_on_failure_without_deleting_evidence(self):
        with self.assertRaisesRegex(RuntimeError, "synthetic caller failure"):
            with self.store() as value:
                value.write("output.txt", b"preserve")
                raise RuntimeError("synthetic caller failure")
        self.assertEqual((value.root / "output.txt").read_bytes(), b"preserve")
        with self.assertRaises(controller.ControllerError):
            value.audit()

    def test_ready_component_does_not_claim_native_or_allocation_admission(self):
        value = self.store(limits={"output.txt": 8, "result.json": 8}, budget_bytes=16)
        value.write("output.txt", b"12345678")
        value.write("result.json", b"abcdefgh")
        report = value.audit()
        self.assertEqual(report["status"], "READY")
        self.assertEqual(report["reservedLogicalBytes"], 16)
        self.assertEqual(report["observedOwnedLogicalBytes"], 16)
        self.assertGreaterEqual(report["observedOwnedAllocatedBytes"], 0)
        self.assertFalse(report["nativeAdmissionEnabled"])
        self.assertFalse(report["allocationBoundProven"])
        self.assertEqual(set(report["files"]), {"output.txt", "result.json"})


if __name__ == "__main__":
    unittest.main()
