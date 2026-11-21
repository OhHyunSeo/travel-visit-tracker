"""Check discovery of one new AVD without starting the Android guest."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import uuid

from avd_volume_component import run as with_volume
from avd_userdata_component import prepare as prepare_userdata
from single_writer_component import ComponentError, _capture


EMULATOR_SHA256 = '5e2249e94368759aabd8fa942d2961cfef07b980a44639a2ec9b7ced3fbe2281'
SYSTEM_IMAGE = Path('system-images/android-37.0/google_apis_playstore/arm64-v8a')
MAX_FIXTURE_APK_BYTES = 32 * 1024**2
PROFILE = '''(version 1)
(deny default)
(allow file-read* file-map-executable)
(deny file-read* (subpath (param "PRIVATE_ANDROID")))
(allow process-exec (literal (param "EMULATOR")))
(allow sysctl-read)
(allow file-write* (subpath (param "ROOT")))
'''


def prepare_config(root: Path, sdk: Path, name: str) -> Path:
    avd_home = root / 'avd'
    avd_home.mkdir(mode=0o700)
    avd = avd_home / f'{name}.avd'
    avd.mkdir(mode=0o700)
    with (avd_home / f'{name}.ini').open('x', encoding='utf-8') as registration:
        registration.write(f'avd.ini.encoding=UTF-8\npath={avd}\ntarget=android-37.0\n')
    with (avd / 'config.ini').open('x', encoding='utf-8') as config:
        config.write(f'AvdId={name}\navd.ini.displayname={name}\nabi.type=arm64-v8a\n'
                     f'image.sysdir.1={sdk / SYSTEM_IMAGE}/\ndisk.dataPartition.size=512M\n'
                     'hw.cpu.arch=arm64\nhw.sdCard=no\n')
    return avd


def stage_fixture_apk(apk: Path, expected_hash: str, root: Path) -> int:
    with apk.open('rb') as source:
        payload = source.read(MAX_FIXTURE_APK_BYTES + 1)
    if not 0 < len(payload) <= MAX_FIXTURE_APK_BYTES or hashlib.sha256(payload).hexdigest() != expected_hash:
        raise ComponentError('Fixture APK size or hash differs from its checked build')
    target = root / 'fixture.apk'
    with target.open('xb') as output:
        output.write(payload)
        output.flush()
        os.fsync(output.fileno())
    return target.stat().st_size


def discover(sdk: Path, root: Path, *, with_userdata: bool = False, fixture_apk: tuple[Path, str] | None = None) -> dict:
    sdk = sdk.resolve(strict=True)
    emulator = sdk / 'emulator/emulator'
    if emulator.resolve(strict=True) != emulator or not emulator.is_file() or not os.access(emulator, os.X_OK):
        raise ComponentError('Expected the cached emulator executable')
    with emulator.open('rb') as source:
        if hashlib.sha256(source.read(16 * 1024**2 + 1)).hexdigest() != EMULATOR_SHA256:
            raise ComponentError('Cached emulator hash differs')
    system_image = sdk / SYSTEM_IMAGE
    if system_image.resolve(strict=True) != system_image or not system_image.is_dir():
        raise ComponentError('Expected the cached arm64 SDK system image')
    name = 'TripPaintingMapTransportQA_' + uuid.uuid4().hex[:12]
    avd = prepare_config(root, sdk, name)
    for folder in ('android-config', 'android-user', 'tmp'):
        (root / folder).mkdir(mode=0o700)
    environment = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'TMPDIR': str(root / 'tmp'),
                   'ANDROID_TMP': str(root / 'tmp'), 'ANDROID_HOME': str(sdk),
                   'ANDROID_USER_HOME': str(root / 'android-user'),
                   'ANDROID_EMULATOR_HOME': str(root / 'android-config'),
                   'ANDROID_AVD_HOME': str(avd.parent)}
    output, _ = _capture([
        '/usr/bin/sandbox-exec', '-D', 'ROOT=' + str(root), '-D', 'EMULATOR=' + str(emulator),
        '-D', 'PRIVATE_ANDROID=' + str(Path.home() / '.android'), '-p', PROFILE, str(emulator), '-list-avds',
    ], cwd=root, env=environment)
    if output.decode('utf-8').splitlines() != [name]:
        raise ComponentError('Emulator did not list exactly the dedicated QA AVD')
    if set(avd.iterdir()) != {avd / 'config.ini'}:
        raise ComponentError('AVD discovery unexpectedly created guest files')
    result = {'onlyDedicatedAvdListed': True, 'discoveryCreatedGuestFiles': False, 'guestBooted': False}
    if with_userdata:
        result['preparedUserdata'] = prepare_userdata(sdk, avd)
        raw = avd / 'fresh-userdata.ext4'
        raw.rename(avd / 'userdata-qemu.img')
        (avd / 'fresh-userdata.qcow2').unlink()
        if set(avd.iterdir()) != {avd / 'config.ini', avd / 'userdata-qemu.img'}:
            raise ComponentError('Unexpected files in the assembled test AVD')
        result['standaloneRawUserdataStaged'] = True
        if fixture_apk:
            result['fixtureApkBytes'] = stage_fixture_apk(*fixture_apk, root)
        space = os.statvfs(root)
        result['filesystemFreeAfterStagingBytes'] = space.f_bavail * space.f_frsize
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--sdk-root', required=True, type=Path)
    parser.add_argument('--prepare-userdata', action='store_true', help='Stage a checked standalone userdata file without booting')
    parser.add_argument('--fixture-apk', type=Path)
    parser.add_argument('--fixture-apk-sha256')
    args = parser.parse_args()
    if (args.fixture_apk is None) != (args.fixture_apk_sha256 is None) or (args.fixture_apk and not args.prepare_userdata):
        parser.error('Use --fixture-apk and --fixture-apk-sha256 with --prepare-userdata')
    fixture = (args.fixture_apk, args.fixture_apk_sha256) if args.fixture_apk else None
    try:
        print(json.dumps(with_volume(volume_check=lambda root: discover(
            args.sdk_root, root, with_userdata=args.prepare_userdata, fixture_apk=fixture)), sort_keys=True))
    except (ComponentError, OSError, ValueError, KeyError) as error:
        sys.exit(f'Dedicated AVD discovery failed: {error}')
