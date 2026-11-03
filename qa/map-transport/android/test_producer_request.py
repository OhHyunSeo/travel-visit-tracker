"""Producer request validation only; no formatter, SDK, AVD or native commands."""
from __future__ import annotations

import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import bounded_controller as controller
import prepare_controller as preparation
import producer_request as request


class ProducerRequestTests(unittest.TestCase):
    def value(self, **changes):
        result = {"schema": 1, "operation": "create-empty-userdata",
                  "requestedBytes": 512, "outputName": "userdata.img"}
        result.update(changes)
        return result

    def encode(self, **changes):
        return json.dumps(self.value(**changes))

    def assert_closed(self, report):
        self.assertEqual(report["status"], "BLOCKED")
        self.assertTrue(report["requestValid"])
        for name in ["allocationBoundProven", "imageFormatted",
                     "nativeAdmissionEnabled", "producerEntryVerified"]:
            self.assertIs(report[name], False)
        self.assertEqual(report["blockers"], list(preparation.BLOCKERS))

    def test_valid_utf8_bytes_and_text_produce_same_closed_request(self):
        raw = self.encode()
        text_result = request.preflight_request(raw)
        byte_result = request.preflight_request(raw.encode("utf-8"))
        self.assertEqual(text_result, byte_result)
        self.assertEqual(text_result["scope"], "producer-request-only")
        self.assertEqual(text_result["request"], self.value())
        self.assert_closed(text_result)

    def test_aligned_lower_and_design_upper_bound_are_requests_only(self):
        for size in [512, 1024, 32 * 1024 * 1024]:
            with self.subTest(size=size):
                report = request.preflight_request(self.encode(requestedBytes=size))
                self.assertEqual(report["request"]["requestedBytes"], size)
                self.assert_closed(report)

    def test_bool_float_string_null_and_container_sizes_are_rejected(self):
        for value in [True, False, 512.0, "512", None, [], {}]:
            with self.subTest(value=value), self.assertRaises(request.ProducerRequestError):
                request.preflight_request(self.encode(requestedBytes=value))

    def test_zero_negative_unaligned_and_over_cap_sizes_are_rejected(self):
        for value in [0, -512, 1, 511, 513, 32 * 1024 * 1024 + 512]:
            with self.subTest(value=value), self.assertRaises(request.ProducerRequestError):
                request.preflight_request(self.encode(requestedBytes=value))

    def test_schema_requires_exact_supported_integer(self):
        for value in [True, False, 1.0, "1", None, 0, 2]:
            with self.subTest(value=value), self.assertRaises(request.ProducerRequestError):
                request.preflight_request(self.encode(schema=value))

    def test_operation_does_not_accept_shell_or_native_command_variants(self):
        for value in ["mkfs.ext4", "emulator", "create-empty-userdata --avd private",
                      "create-empty-userdata\x00", " create-empty-userdata", None, []]:
            with self.subTest(value=value), self.assertRaises(request.ProducerRequestError):
                request.preflight_request(self.encode(operation=value))

    def test_output_is_one_fixed_basename_with_no_path_or_control_variant(self):
        for value in ["../userdata.img", "/tmp/userdata.img", "x/userdata.img",
                      "userdata.img/", "userdata.img\x00", "userdata.img\n", None, []]:
            with self.subTest(value=value), self.assertRaises(request.ProducerRequestError):
                request.preflight_request(self.encode(outputName=value))

    def test_missing_and_unknown_keys_are_rejected(self):
        for name in self.value():
            value = self.value()
            del value[name]
            with self.subTest(missing=name), self.assertRaises(request.ProducerRequestError):
                request.preflight_request(json.dumps(value))
        with self.assertRaises(request.ProducerRequestError):
            request.preflight_request(self.encode(extra=0))

    def test_execution_paths_environment_and_caller_approval_cannot_be_injected(self):
        injections = {"executable": "/usr/bin/true", "argv": ["-version"],
                      "env": {"DYLD_INSERT_LIBRARIES": "ignored"}, "sdkRoot": "/tmp/sdk",
                      "avd": "private", "outputPath": "/tmp/userdata.img",
                      "nativeAdmissionEnabled": True, "allocationBoundProven": True,
                      "producerEntryVerified": True, "imageFormatted": True}
        for name, value in injections.items():
            with self.subTest(field=name), self.assertRaises(request.ProducerRequestError):
                request.preflight_request(self.encode(**{name: value}))

    def test_duplicate_keys_cannot_replace_first_value(self):
        raw = self.encode()
        for name, value in [("requestedBytes", "1024"), ("schema", "1"),
                            ("operation", '"create-empty-userdata"')]:
            duplicate = raw[:-1] + ', "' + name + '": ' + value + "}"
            with self.subTest(field=name), self.assertRaises(request.ProducerRequestError):
                request.preflight_request(duplicate)
        with self.assertRaises(request.ProducerRequestError):
            request.preflight_request(raw[:-1] + ', "extra": {"x": 1, "x": 2}}')

    def test_nonfinite_json_numbers_are_rejected(self):
        for value in ["NaN", "Infinity", "-Infinity"]:
            raw = self.encode().replace('"requestedBytes": 512', '"requestedBytes": ' + value)
            with self.subTest(value=value), self.assertRaises(request.ProducerRequestError):
                request.preflight_request(raw)

    def test_invalid_encoding_surrogates_and_malformed_json_are_rejected(self):
        for raw in [b"\xff", "\ud800", "", "{", "{} trailing", "null", "[]", "1"]:
            with self.subTest(raw=repr(raw)), self.assertRaises(request.ProducerRequestError):
                request.preflight_request(raw)

    def test_input_must_be_raw_json_not_a_mutable_mapping_or_other_type(self):
        for raw in [self.value(), bytearray(self.encode().encode()), None, 512, True]:
            with self.subTest(kind=type(raw).__name__), self.assertRaises(request.ProducerRequestError):
                request.preflight_request(raw)

    def test_utf8_byte_allowance_accepts_boundary_and_rejects_overflow(self):
        raw = self.encode()
        exact = raw + " " * (request.MAX_REQUEST_BYTES - len(raw.encode("utf-8")))
        self.assert_closed(request.preflight_request(exact))
        for value in [exact + " ", (exact + " ").encode("utf-8"), "é" * 2049]:
            with self.subTest(kind=type(value).__name__), self.assertRaises(request.ProducerRequestError):
                request.preflight_request(value)

    def test_deep_json_is_a_domain_error_without_files_or_execution(self):
        raw = "[" * 1100 + "0" + "]" * 1100
        self.assertLess(len(raw), request.MAX_REQUEST_BYTES)
        with self.assertRaises(request.ProducerRequestError):
            request.preflight_request(raw)

    def test_mutating_returned_report_cannot_modify_later_validation(self):
        first = request.preflight_request(self.encode())
        first["request"]["requestedBytes"] = 1
        first["blockers"].clear()
        first["nativeAdmissionEnabled"] = True
        second = request.preflight_request(self.encode())
        self.assertEqual(second["request"], self.value())
        self.assert_closed(second)


class ProducerPreparationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.android = Path(temporary.name).resolve()

    def raw(self, size=512):
        return json.dumps({"schema": 1, "operation": "create-empty-userdata",
                           "requestedBytes": size, "outputName": "userdata.img"})

    def test_invalid_request_is_rejected_before_controller_creation(self):
        with mock.patch.object(controller.ControllerArtifacts, "create") as create:
            for raw in ["{}", self.raw().replace("512", "513"),
                        self.raw()[:-1] + ', "nativeAdmissionEnabled": true}']:
                with self.subTest(raw=raw), self.assertRaises(request.ProducerRequestError):
                    preparation.prepare(self.android, producer_request=raw)
            create.assert_not_called()
        self.assertEqual(list(self.android.iterdir()), [])

    def test_valid_request_records_closed_metadata_without_producing_an_image(self):
        report = preparation.prepare(self.android, producer_request=self.raw())
        root = Path(report["controllerRoot"])
        self.assertEqual(report["status"], "BLOCKED")
        self.assertEqual(report["cleanup"]["status"], "CLOSED")
        self.assertEqual(report["controllerAudit"]["status"], "READY")
        self.assertFalse(report["nativeAdmissionEnabled"])
        self.assertFalse(report["producerPreflight"]["producerEntryVerified"])
        self.assertFalse((root / "capacity.raw").exists())
        self.assertEqual(list(self.android.rglob("userdata.img")), [])
        stored = json.loads((root / "result.json").read_bytes())
        events = json.loads((root / "controller-events.json").read_bytes())
        self.assertEqual(stored["producerPreflight"], report["producerPreflight"])
        self.assertIn("producerPreflight", events)

    def test_request_design_size_is_not_a_promise_that_small_backing_fits(self):
        report = preparation.prepare(self.android, backing_bytes=512,
                                     producer_request=self.raw(32 * 1024 * 1024))
        root = Path(report["controllerRoot"])
        self.assertEqual((root / "capacity.raw").read_bytes(), bytes(512))
        self.assertEqual(report["producerPreflight"]["request"]["requestedBytes"], 32 * 1024 * 1024)
        self.assertEqual(report["status"], "BLOCKED")
        self.assertFalse(report["allocationBoundProven"])
        self.assertFalse(report["imageFormatted"])
        self.assertFalse(report["nativeAdmissionEnabled"])
        self.assertEqual(list(self.android.rglob("userdata.img")), [])

    def test_cli_invalid_request_returns_failure_without_creating_a_run(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = preparation.main(["--android-root", str(self.android), "--producer-request", "{}"])
        report = json.loads(output.getvalue())
        self.assertEqual(code, 1)
        self.assertEqual(report["status"], "FAILED")
        self.assertIsNone(report["controllerRoot"])
        self.assertIsNone(report["cleanup"])
        self.assertFalse(report["nativeAdmissionEnabled"])
        self.assertEqual(list(self.android.iterdir()), [])

    def test_cli_valid_request_is_blocked_and_unknown_native_options_create_nothing(self):
        for option in ["--avd", "--native", "--execute", "--producer-reques"]:
            with self.subTest(option=option), contextlib.redirect_stderr(io.StringIO()), \
                    contextlib.redirect_stdout(io.StringIO()), self.assertRaises(SystemExit) as error:
                preparation.main(["--android-root", str(self.android), option, self.raw()])
            self.assertEqual(error.exception.code, 2)
            self.assertEqual(list(self.android.iterdir()), [])
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = preparation.main(["--android-root", str(self.android), "--producer-request", self.raw()])
        report = json.loads(output.getvalue())
        self.assertEqual(code, 2)
        self.assertEqual(report["status"], "BLOCKED")
        self.assertFalse(report["producerPreflight"]["nativeAdmissionEnabled"])
        self.assertEqual(report["cleanup"]["status"], "CLOSED")


if __name__ == "__main__":
    unittest.main()
