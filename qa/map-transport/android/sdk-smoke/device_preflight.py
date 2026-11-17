"""Read-only compatibility checks for an already isolated Android device."""

import re

from capture_device import PACKAGE


PRODUCT_PACKAGE = 'app.trippainting.mobile'
MIN_SDK = 36
PACKAGE_LINE = re.compile(rb'package:([A-Za-z0-9_.]+)')


def package_present(command, name):
    result = command(4096, 'shell', 'cmd', 'package', 'list', 'packages', '-u', name)
    for line in result.splitlines():
        match = PACKAGE_LINE.fullmatch(line)
        if not match:
            raise ValueError('Unexpected Android package inventory output')
        if match[1] == name.encode('ascii'):
            return True
    return False


def check_fresh_device(command, package=PACKAGE):
    """Check a caller-pinned device before installing the isolated smoke package."""
    if command(128, 'shell', 'getprop', 'sys.boot_completed').strip() != b'1':
        raise ValueError('Android has not completed boot')
    version = command(128, 'shell', 'getprop', 'ro.build.version.sdk').strip()
    if not re.fullmatch(rb'[1-9][0-9]{0,2}', version) or int(version) < MIN_SDK:
        raise ValueError('Fixture requires Android API 36 or later')
    abis = command(128, 'shell', 'getprop', 'ro.product.cpu.abilist').strip().split(b',')
    if b'arm64-v8a' not in abis:
        raise ValueError('Fixture requires the arm64-v8a ABI')
    if package_present(command, PRODUCT_PACKAGE):
        raise ValueError('Product app is present on this Android device')
    if package_present(command, package):
        raise ValueError('Fixture package already exists on this Android device')
    return {'apiLevel': int(version), 'fixtureAbi': 'arm64-v8a', 'productPackageAbsent': True,
            'fixturePackageAbsent': True}
