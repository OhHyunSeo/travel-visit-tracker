"""Actual Mac native ledger configuration/files only; no sockets, SDK or device."""

import base64
from copy import deepcopy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import uuid

from test_tls_exchange import make_certificate


ROOT = Path(__file__).resolve().parent
ORIGIN = "http://127.0.0.1:3091"
UINT_MAX = (1 << 64) - 1


def ledger(origin=ORIGIN, requests=3, tiles=2, unresolved=None, **changes):
    value = {"schema": 1, "origin": origin, "requests": requests, "tiles": tiles,
             "reservedBytes": requests * 256,
             "unresolved": [str(uuid.uuid4()).upper()] if unresolved is None else unresolved,
             "maxRequests": 16, "maxTiles": 16, "maxReservedBytes": 4096,
             "reservationBytes": 256}
    value.update(changes)
    return value


@unittest.skipUnless(sys.platform == "darwin", "Apple native ledger admission")
class LedgerAdmissionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="tp-ledger-admission-")
        cls.directory = Path(cls.temporary.name)
        cls.binary = cls.directory / "admission"
        try:
            subprocess.run(["xcrun", "clang", "-fobjc-arc", "-fblocks", "-Wall", "-Wextra", "-Werror",
                            "-Wno-unused-parameter", "-Wno-incompatible-pointer-types",
                            "-framework", "Foundation", "-framework", "Network", "-framework", "Security",
                            str(ROOT / "test-ledger-admission.m"), str(ROOT / "TPTransport.m"),
                            str(ROOT / "TPHTTPExchange.m"), "-o", str(cls.binary)],
                           check=True, capture_output=True, text=True)
            make_certificate(cls.directory, "fixture", "IP:127.0.0.1")
            cls.pin = base64.b64encode((cls.directory / "fixture.der").read_bytes()).decode()
        except BaseException:
            cls.temporary.cleanup()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def setUp(self):
        self.files = tempfile.TemporaryDirectory(prefix="case-", dir=self.directory)
        self.addCleanup(self.files.cleanup)
        self.root = Path(self.files.name)
        self.baseline = self.root / "baseline.json"
        self.baseline.write_text(json.dumps(ledger()))
        self.candidate = self.root / "candidate.json"

    def config(self, path=None, **changes):
        value = {"url": (path or self.candidate).as_uri(), "origin": ORIGIN,
                 "requests": 16, "tiles": 16, "bytes": 4096, "mode": "http"}
        value.update(changes)
        return value

    def run_configs(self, configurations):
        result = subprocess.run([str(self.binary), json.dumps(configurations)], check=True,
                                capture_output=True, text=True, timeout=5)
        return json.loads(result.stdout)

    def rejected(self, configuration=None):
        baseline = self.baseline.read_bytes()
        before = self.candidate.read_bytes() if self.candidate.is_file() else None
        results = self.run_configs([self.config(self.baseline), configuration or self.config()])
        self.assertTrue(results[0]["configured"])
        self.assertFalse(results[1]["configured"])
        self.assertEqual(results[1]["before"], results[1]["after"])
        self.assertEqual(results[0]["after"], results[1]["after"])
        self.assertEqual(self.baseline.read_bytes(), baseline)
        if before is not None:
            self.assertEqual(self.candidate.read_bytes(), before)
        return results[1]

    def test_new_http_ledger_and_existing_nonzero_ledger_reopen(self):
        results = self.run_configs([self.config(), self.config()])
        self.assertTrue(all(item["configured"] for item in results))
        self.assertEqual(results[0]["after"]["ledger"], results[1]["after"]["ledger"])
        self.assertEqual(results[1]["after"]["ledger"]["reservedBytes"], 0)
        before = self.baseline.read_bytes()
        result = self.run_configs([self.config(self.baseline)])[0]
        self.assertTrue(result["configured"])
        self.assertEqual(result["after"]["ledger"]["requests"], 3)
        self.assertEqual(self.baseline.read_bytes(), before)

    def test_historical_native_uuid_reservations_can_exceed_active_limit(self):
        ids = [str(uuid.uuid4()).upper() for _ in range(8)]
        saved = ledger(requests=9, tiles=8, unresolved=ids)
        self.candidate.write_text(json.dumps(saved))
        result = self.run_configs([self.config()])[0]
        self.assertTrue(result["configured"])
        self.assertEqual(result["after"]["ledger"], saved)
        self.assertEqual(result["after"]["active"], 0)

    def test_exact_64kib_read_succeeds_but_one_more_byte_rejects(self):
        body = json.dumps(ledger()).encode()
        self.candidate.write_bytes(body + b" " * (65536 - len(body)))
        original = self.candidate.read_bytes()
        self.assertTrue(self.run_configs([self.config()])[0]["configured"])
        self.assertEqual(self.candidate.read_bytes(), original)
        self.candidate.write_bytes(original + b" ")
        self.rejected()

    def test_empty_malformed_truncated_and_wrong_root_files_reject_unchanged(self):
        for body in (b"", b"{", b'{"schema":1', b"null", b"[]", b"true"):
            with self.subTest(body=body):
                self.candidate.write_bytes(body)
                self.rejected()

    def test_all_numeric_fields_reject_booleans_and_floats(self):
        fields = ("schema", "requests", "tiles", "reservedBytes", "maxRequests",
                  "maxTiles", "maxReservedBytes", "reservationBytes")
        for field in fields:
            for wrong in (True, False, 1.0, float(ledger()[field])):
                with self.subTest(field=field, wrong=wrong):
                    saved = ledger()
                    saved[field] = wrong
                    self.candidate.write_text(json.dumps(saved))
                    self.rejected()

    def test_numeric_fields_reject_negative_strings_null_and_overflow(self):
        for field in ("requests", "tiles", "reservedBytes", "schema", "maxRequests"):
            for wrong in (-1, "3", None, UINT_MAX + 1):
                with self.subTest(field=field, wrong=wrong):
                    saved = ledger()
                    saved[field] = wrong
                    self.candidate.write_text(json.dumps(saved))
                    self.rejected()

    def test_schema_limits_and_origin_must_match_exactly(self):
        for field, wrong in (("schema", 2), ("origin", ORIGIN + "/"),
                             ("maxRequests", 17), ("maxTiles", 15),
                             ("maxReservedBytes", 4097), ("reservationBytes", 255)):
            with self.subTest(field=field):
                saved = ledger()
                saved[field] = wrong
                self.candidate.write_text(json.dumps(saved))
                self.rejected()

    def test_missing_and_unknown_keys_reject(self):
        for field in ledger():
            with self.subTest(missing=field):
                saved = ledger()
                del saved[field]
                self.candidate.write_text(json.dumps(saved))
                self.rejected()
        for field in ("packId", "fixtureTLSLeafDER"):
            saved = ledger()
            saved[field] = "unexpected"
            self.candidate.write_text(json.dumps(saved))
            self.rejected()

    def test_counter_relations_and_multiplication_overflow_reject(self):
        for changes in ({"requests": 17, "reservedBytes": 4352}, {"tiles": 4},
                        {"reservedBytes": 767}, {"requests": UINT_MAX, "reservedBytes": 0},
                        {"requests": UINT_MAX // 256 + 1, "reservedBytes": 0}):
            with self.subTest(changes=changes):
                self.candidate.write_text(json.dumps(ledger(**changes)))
                self.rejected()

    def test_unresolved_requires_unique_canonical_native_uuid_strings(self):
        one = str(uuid.uuid4()).upper()
        for values in ([one, one], [one.lower()], ["not-a-uuid"], [""], [1], [None],
                       [one] * 4, "not-an-array", None):
            with self.subTest(values=values):
                saved = ledger()
                saved["unresolved"] = values
                self.candidate.write_text(json.dumps(saved))
                self.rejected()
        # The upper bound is charged requests, not only uniqueness.
        saved = ledger(unresolved=[str(uuid.uuid4()).upper() for _ in range(4)])
        self.candidate.write_text(json.dumps(saved))
        self.rejected()

    def test_invalid_params_do_not_create_files_or_mutate_previous_state(self):
        for changes in ({"requests": 0}, {"requests": UINT_MAX}, {"tiles": 17},
                        {"bytes": 0}, {"bytes": 255}, {"origin": "http://example.invalid:80"}):
            with self.subTest(changes=changes):
                self.rejected(self.config(**changes))
                self.assertFalse(self.candidate.exists())
        # No arbitrary small maximum: safe NSUInteger arithmetic remains valid.
        config = self.config(requests=UINT_MAX // 256, tiles=0)
        result = self.run_configs([config, config])
        self.assertTrue(all(item["configured"] for item in result))

    def test_nonfile_remote_file_url_and_query_fragment_reject_without_creation(self):
        for url in ("https://127.0.0.1:3091/ledger", "relative-ledger.json",
                    "file://example.invalid" + self.candidate.as_posix(),
                    self.candidate.as_uri() + "?x=1", self.candidate.as_uri() + "#x"):
            with self.subTest(url=url):
                self.rejected(self.config(url=url))
                self.assertFalse(self.candidate.exists())

    def test_symlink_hardlink_directory_and_fifo_reject_without_modification(self):
        target = self.root / "target.json"
        target.write_text(json.dumps(ledger()))
        target_bytes = target.read_bytes()
        self.candidate.symlink_to(target)
        self.rejected()
        self.assertTrue(self.candidate.is_symlink())
        self.assertEqual(target.read_bytes(), target_bytes)
        self.candidate.unlink()
        os.link(target, self.candidate)
        self.rejected()
        self.assertEqual(target.stat().st_nlink, 2)
        self.candidate.unlink()
        self.candidate.mkdir()
        self.rejected()
        self.assertTrue(self.candidate.is_dir())
        self.candidate.rmdir()
        os.mkfifo(self.candidate)
        self.rejected()
        self.assertTrue(self.candidate.exists())

    def test_invalid_candidate_does_not_create_parent_directories(self):
        absent = self.root / "absent" / "ledger.json"
        self.rejected(self.config(absent, requests=0))
        self.assertFalse(absent.parent.exists())

    def test_creation_failure_retains_previous_configuration(self):
        parent = self.root / "not-directory"
        parent.write_bytes(b"owned sentinel")
        self.rejected(self.config(parent / "ledger.json"))
        self.assertEqual(parent.read_bytes(), b"owned sentinel")

    def test_new_and_existing_tls_pin_identity_with_both_tls_entrypoints(self):
        for mode in ("tls", "private-tls"):
            with self.subTest(mode=mode):
                path = self.root / (mode + ".json")
                config = self.config(path, mode=mode, origin="https://127.0.0.1:3091", certificate=self.pin)
                result = self.run_configs([config, config])
                self.assertTrue(all(item["configured"] for item in result))
                saved = json.loads(path.read_text())
                self.assertEqual(saved["fixtureTLSLeafDER"], self.pin)
                self.assertEqual(result[0]["after"]["ledger"], result[1]["after"]["ledger"])

    def test_changed_missing_extra_tls_pin_and_http_mode_reject_unchanged(self):
        origin = "https://127.0.0.1:3091"
        config = self.config(mode="private-tls", origin=origin, certificate=self.pin)
        original = ledger(origin=origin, fixtureTLSLeafDER=self.pin)
        for field in ("missing", "different", "extra"):
            saved = deepcopy(original)
            if field == "missing":
                del saved["fixtureTLSLeafDER"]
            elif field == "different":
                saved["fixtureTLSLeafDER"] = self.pin + "="
            else:
                saved["extra"] = 1
            self.candidate.write_text(json.dumps(saved))
            self.rejected(config)
        self.candidate.write_text(json.dumps(original))
        self.rejected(self.config())


if __name__ == "__main__":
    unittest.main()
