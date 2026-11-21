"""Actual Foundation fixture-signal admission; no URL opening, SDK or device."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent
CANCEL, RELOAD = "a" * 64, "b" * 64


def url(action="cancel", run="run_123", pid=1234, nonce=None):
    nonce = nonce if nonce is not None else CANCEL if action == "cancel" else RELOAD
    return f"trippainting-map-qa-control://{action}?runID={run}&pid={pid}&nonce={nonce}"


@unittest.skipUnless(sys.platform == "darwin", "Apple Foundation fixture signal admission")
class FixtureActionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="tp-fixture-action-")
        cls.binary = Path(cls.temporary.name) / "action-test"
        try:
            subprocess.run(["xcrun", "clang", "-fobjc-arc", "-fblocks", "-Wall", "-Wextra", "-Werror",
                            "-Wno-incompatible-pointer-types", "-framework", "Foundation",
                            str(ROOT / "TPFixtureActionGate.m"), str(ROOT / "test-fixture-action.m"),
                            "-o", str(cls.binary)], check=True, capture_output=True, text=True)
        except BaseException:
            cls.temporary.cleanup()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def run_steps(self, steps=(), **changes):
        value = {"runID": "run_123", "pid": 1234, "cancelNonce": CANCEL,
                 "reloadNonce": RELOAD, "steps": [{"url": u, "phase": phase} for u, phase in steps]}
        value.update(changes)
        return json.loads(subprocess.check_output([str(self.binary), json.dumps(value)], text=True, timeout=3))

    def test_cancel_then_reload_accept_once_and_preserve_completed_state(self):
        result = self.run_steps([(url(), 10), (url(), 10), (url("reload"), 12),
                                 (url("reload"), 12), (url(), 10)])
        self.assertTrue(result["configured"])
        self.assertEqual(result["steps"], [{"accepted": ok, "sequence": seq}
                         for ok, seq in [(True, 1), (False, 1), (True, 2), (False, 2), (False, 2)]])

    def test_phase_and_order_are_required_without_consuming_wrong_action(self):
        result = self.run_steps([(url("reload"), 12), (url(), 12), (url(), 0),
                                 (url(), 10), (url("reload"), 10), (url("reload"), 12)])
        self.assertEqual([v["accepted"] for v in result["steps"]], [False, False, False, True, False, True])

    def test_wrong_pid_run_or_nonce_rejected_then_correct_action_still_works(self):
        for wrong in [url(pid=1235), url(run="other"), url(nonce=RELOAD), url(nonce="c" * 64)]:
            result = self.run_steps([(wrong, 10), (url(), 10)])
            self.assertEqual(result["steps"], [{"accepted": False, "sequence": 0}, {"accepted": True, "sequence": 1}])

    def test_url_aliases_duplicate_fields_and_external_urls_never_consume(self):
        valid = url()
        bad = [valid + "#x", valid + "&extra=1", valid + "&pid=1234", valid + "/",
               valid.replace("runID=run_123&pid=1234", "pid=1234&runID=run_123"),
               valid.replace("pid=1234", "pid=01234"), valid.replace("pid=1234", "pid=1234.0"),
               valid.replace("run_123", "run%5F123"), valid.replace("nonce=a", "nonce=%61", 1),
               valid.replace("://cancel?", "://user@cancel?"),
               valid.replace("://cancel?", "://cancel:1?"), "https://example.invalid/", "file:///tmp/value", "relative"]
        result = self.run_steps([(u, 10) for u in bad] + [(valid, 10)])
        self.assertTrue(all(v == {"accepted": False, "sequence": 0} for v in result["steps"][:-1]))
        self.assertEqual(result["steps"][-1], {"accepted": True, "sequence": 1})

    def test_oversized_empty_and_non_url_values_do_not_consume(self):
        result = self.run_steps([(None, 10), (1, 10), ("", 10), (url() + "x" * 1024, 10), (url(), 10)])
        self.assertEqual([v["accepted"] for v in result["steps"]], [False, False, False, False, True])

    def test_run_id_validation_before_creating_any_action(self):
        for run in [None, 1, "", "x" * 65, "../x", "x&pid=1", "x\n", "한글", "x%20", "x\x00"]:
            with self.subTest(run=repr(run)):
                self.assertFalse(self.run_steps(runID=run)["configured"])
        for run in ["x", "X_1-", "x" * 64]:
            self.assertTrue(self.run_steps(runID=run)["configured"])

    def test_pid_is_positive_bounded_process_identity(self):
        for pid in [None, True, 1234.0, -1, 0, 2 ** 31, "1234"]:
            with self.subTest(pid=pid):
                self.assertFalse(self.run_steps(pid=pid)["configured"])
        self.assertTrue(self.run_steps(pid=2 ** 31 - 1)["configured"])

    def test_nonce_formats_and_distinct_values_are_required(self):
        for nonce in [None, 1, "", "a" * 63, "a" * 65, "A" * 64, "g" * 64, "a" * 63 + "\n"]:
            for key in ["cancelNonce", "reloadNonce"]:
                with self.subTest(key=key, nonce=repr(nonce)):
                    self.assertFalse(self.run_steps(**{key: nonce})["configured"])
        self.assertFalse(self.run_steps(reloadNonce=CANCEL)["configured"])

    def test_wrong_reload_signal_cannot_reset_successful_cancel(self):
        result = self.run_steps([(url(), 10), (url("reload", nonce=CANCEL), 12),
                                 (url("reload", pid=1235), 12), (url(), 12), (url("reload"), 12)])
        self.assertEqual([v["sequence"] for v in result["steps"]], [1, 1, 1, 1, 2])
        self.assertEqual([v["accepted"] for v in result["steps"]], [True, False, False, False, True])

    def test_other_fixture_run_has_distinct_identity(self):
        # A separately configured run has distinct identity; old URLs cannot act.
        result = self.run_steps([(url(), 10), (url("reload"), 12)], runID="other_run")
        self.assertTrue(result["configured"])
        self.assertEqual(result["steps"], [{"accepted": False, "sequence": 0}] * 2)

    def test_later_mutation_of_caller_strings_cannot_change_binding(self):
        result = self.run_steps([(url(), 10), (url("reload"), 12)], mutateInputsAfterInit=True)
        self.assertIs(result["configured"], True)
        self.assertEqual(result["steps"], [{"accepted": True, "sequence": 1}, {"accepted": True, "sequence": 2}])


if __name__ == "__main__":
    unittest.main()
