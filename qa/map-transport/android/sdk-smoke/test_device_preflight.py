import unittest

from capture_device import PACKAGE
from device_preflight import PRODUCT_PACKAGE, check_fresh_device


class DevicePreflightTest(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.responses = {
            ('shell', 'getprop', 'sys.boot_completed'): b'1\n',
            ('shell', 'getprop', 'ro.build.version.sdk'): b'37\n',
            ('shell', 'getprop', 'ro.product.cpu.abilist'): b'arm64-v8a,armeabi-v7a\n',
            ('shell', 'cmd', 'package', 'list', 'packages', '-u', PRODUCT_PACKAGE): b'package:app.trippainting.mobile.other\n',
            ('shell', 'cmd', 'package', 'list', 'packages', '-u', PACKAGE): b'',
        }

    def command(self, limit, *args):
        self.calls.append(args)
        result = self.responses[args]
        self.assertLessEqual(len(result), limit)
        return result

    def test_compatible_fresh_device(self):
        result = check_fresh_device(self.command)
        self.assertEqual(result['apiLevel'], 37)
        self.assertTrue(result['fixturePackageAbsent'])
        self.assertEqual(len(self.calls), 5)

    def test_stops_before_package_checks_for_old_or_incompatible_device(self):
        for property_name, value, reason in (
            ('ro.build.version.sdk', b'35', 'API 36'),
            ('ro.product.cpu.abilist', b'x86_64', 'arm64-v8a'),
            ('sys.boot_completed', b'0', 'completed boot'),
        ):
            with self.subTest(property_name=property_name):
                key = ('shell', 'getprop', property_name)
                original = self.responses[key]
                self.responses[key] = value
                self.calls.clear()
                with self.assertRaisesRegex(ValueError, reason):
                    check_fresh_device(self.command)
                self.assertTrue(all(call[1] == 'getprop' for call in self.calls))
                self.responses[key] = original

    def test_rejects_existing_package_and_malformed_response(self):
        for name, reason in ((PRODUCT_PACKAGE, 'Product app'), (PACKAGE, 'Fixture package')):
            key = ('shell', 'cmd', 'package', 'list', 'packages', '-u', name)
            original = self.responses[key]
            self.responses[key] = f'package:{name}\n'.encode()
            with self.assertRaisesRegex(ValueError, reason):
                check_fresh_device(self.command)
            self.responses[key] = original

        self.responses[('shell', 'cmd', 'package', 'list', 'packages', '-u', PRODUCT_PACKAGE)] = b'Error: unavailable\n'
        with self.assertRaisesRegex(ValueError, 'inventory output'):
            check_fresh_device(self.command)
