import sys
import unittest
from unittest.mock import Mock, patch

from capture_transport import CaptureCommandError, capture_output, for_admitted_transport


class TransportTest(unittest.TestCase):
    def capture(self, source, limit=64, timeout=2):
        return capture_output([sys.executable, "-c", source], limit, timeout)

    def test_returns_exact_binary_at_limit(self):
        self.assertEqual(self.capture("import os; os.write(1, bytes(range(64)))"), bytes(range(64)))

    def test_refuses_stdout_or_stderr_overflow(self):
        for fd, length in ((1, 65), (2, 4_097)):
            with self.subTest(fd=fd), self.assertRaisesRegex(CaptureCommandError, "output limit"):
                self.capture(f"import os; os.write({fd}, b'x' * {length})")

    def test_refuses_nonzero_exit_without_exposing_stderr(self):
        with self.assertRaisesRegex(CaptureCommandError, r"^Capture command failed with exit 3$"):
            self.capture("import sys; sys.stderr.write('ignored guest detail'); sys.exit(3)")

    def test_cancels_idle_command(self):
        with self.assertRaisesRegex(CaptureCommandError, "timed out"):
            self.capture("import time; time.sleep(5)", timeout=0.2)

    def test_cancels_command_that_closes_outputs_without_exiting(self):
        with self.assertRaisesRegex(CaptureCommandError, "timed out"):
            self.capture("import os, time; os.close(1); os.close(2); time.sleep(5)", timeout=0.2)

    def test_only_uses_the_pinned_transport_and_checks_both_sides(self):
        identity = Mock()
        command = for_admitted_transport("/sdk/adb", 31, identity)
        with patch("capture_transport.capture_output", return_value=b"proof") as call:
            self.assertEqual(command(64, "exec-out", "screencap", "-p"), b"proof")
            call.assert_called_once_with(["/sdk/adb", "-t", "31", "exec-out", "screencap", "-p"], 64)
        self.assertEqual(identity.call_count, 2)

    def test_discards_result_when_identity_changes(self):
        identity = Mock(side_effect=[None, ValueError("transport changed")])
        command = for_admitted_transport("/sdk/adb", 31, identity)
        with patch("capture_transport.capture_output", return_value=b"proof"):
            with self.assertRaisesRegex(ValueError, "transport changed"):
                command(64, "shell", "pidof", "fixture")

    def test_does_not_issue_a_command_if_initial_identity_fails(self):
        command = for_admitted_transport("/sdk/adb", 31, Mock(side_effect=ValueError("transport changed")))
        with patch("capture_transport.capture_output") as call:
            with self.assertRaisesRegex(ValueError, "transport changed"):
                command(64, "shell", "pidof", "fixture")
            call.assert_not_called()
