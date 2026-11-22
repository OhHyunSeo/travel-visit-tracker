"""Attempt one isolated Android cold boot on a disposable fixed-size volume."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import sqlite3
import stat
import subprocess
import sys
import time
import uuid

from avd_config_component import EMULATOR_SHA256, prepare_config
from avd_guest_component import ADB_PORT, FIXTURE_APK_SHA256, install_fixture, query_boot_property, render_fixture, reopen_fixture
from avd_volume_component import run as with_volume
from single_writer_component import ComponentError, _capture


BOOT_VOLUME = 10 * 1024**3
BOOT_TIMEOUT_SECONDS = 360
HEADLESS_SHA256 = 'debac868b79f1170e64c5c202f8b39ce3dd0215c358b8d0e62ba63256ef6a819'
BOOT_PROPERTY_ACTION = re.compile(rb'init: processing action \([^\r\n)]*\bsys\.boot_completed=1\b')
PREP_PROFILE = '''(version 1)
(deny default)
(allow file-read* file-map-executable)
(deny file-read* (require-all (subpath (param "USER_ROOT")) (require-not (subpath (param "SDK")))))
(deny file-read* (literal (param "CANARY")))
(allow sysctl-read)
(allow file-write* (subpath (param "ROOT")))
'''
CHECK = '''
import pathlib, sys
inside, outside = map(pathlib.Path, sys.argv[1:])
inside.write_bytes(b'inside')
try:
    outside.read_bytes()
except PermissionError:
    pass
else:
    raise RuntimeError('Outside read accepted')
try:
    outside.write_bytes(b'outside')
except PermissionError:
    pass
else:
    raise RuntimeError('Outside write accepted')
print('isolated read/write verified')
'''


def pinned(path, expected):
    if not path.is_file() or path != path.resolve(strict=True) or not os.access(path, os.X_OK):
        raise ComponentError('Required SDK tool is missing or redirected')
    with path.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != expected:
            raise ComponentError(f'SDK executable hash changed: {path.name}')
    return str(path)


def boot_marker_exists(marker):
    try:
        return stat.S_ISREG(marker.lstat().st_mode)
    except FileNotFoundError:
        return False


def boot(root, sdk, *, probe_adb=False, fixture_apk=None, render_inputs=None, raster_tile=False,
         offline_pack=False, expected_hash=FIXTURE_APK_SHA256, reopen_inputs=None, expire_pack=False,
         sdk_offline=False, online_recovery=False, verify_refreshed_pack=False, rn_recovery=None, rn_reopen=False,
         rn_product_map=False, rn_product_tab=False, rn_source_bounds=False, rn_zoom=8, rn_multi_zoom=False, rn_adjacent_tiles=False, rn_row_tiles=False, rn_row_pan=False):
    launcher = pinned(sdk / 'emulator/emulator', EMULATOR_SHA256)
    headless = pinned(sdk / 'emulator/qemu/darwin-aarch64/qemu-system-aarch64-headless', HEADLESS_SHA256)
    name = 'TripPaintingMapTransportQA_' + uuid.uuid4().hex[:12]
    avd = prepare_config(root, sdk, name)
    with (avd / 'config.ini').open('a') as config:
        ram_mib = 4096 if online_recovery else 3072 if raster_tile else 2048
        if rn_recovery:
            ram_mib = 5120
        config.write(f'hw.cpu.ncore=2\nhw.ramSize={ram_mib}\nhw.lcd.width=720\nhw.lcd.height=1280\n'
                     'hw.lcd.density=320\nhw.gpu.enabled=yes\nPlayStore.enabled=true\n')
    for folder in ('android-user', 'android-config', 'tmp'):
        (root / folder).mkdir(mode=0o700)
    for port in (5560, ADB_PORT):
        with socket.socket() as check:
            check.bind(('127.0.0.1', port))
    env = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'TMPDIR': str(root / 'tmp'),
           'ANDROID_TMP': str(root / 'tmp'), 'XDG_RUNTIME_DIR': str(root / 'tmp'),
           'DARWIN_USER_TEMP_DIR': str(root / 'tmp'), 'ANDROID_HOME': str(sdk),
           'ANDROID_USER_HOME': str(root / 'android-user'), 'ANDROID_EMULATOR_HOME': str(root / 'android-config'),
           'ANDROID_AVD_HOME': str(avd.parent), 'ANDROID_PREFS_ROOT': str(root / 'android-config'),
           'ANDROID_ADB_SERVER_PORT': '15537', 'ADB_VENDOR_KEYS': str(root / 'android-user/adbkey')}
    outside = root.parent / 'boot-canary'
    outside.write_bytes(b'original')
    prefix = ['/usr/bin/sandbox-exec', '-D', 'ROOT=' + str(root), '-D', 'USER_ROOT=' + str(Path.home()),
              '-D', 'SDK=' + str(sdk), '-D', 'CANARY=' + str(outside)]
    try:
        python = str(Path(sys.executable).resolve(strict=True))
        if Path(python).is_relative_to(Path.home()):
            raise ComponentError('The isolation probe requires a Python runtime outside the user directory')
        probe = PREP_PROFILE + f'(allow process-exec (literal "{python}"))\n'
        proof, _ = _capture([*prefix, '-p', probe, python, '-I', '-S', '-B', '-c', CHECK,
                             str(root / 'write-proof'), str(outside)], cwd=root, env=env)
        if proof.strip() != b'isolated read/write verified' or outside.read_bytes() != b'original':
            raise ComponentError('Dedicated volume and outside access check failed')
    finally:
        outside.unlink()

    profile = PREP_PROFILE + ''.join(f'(allow process-exec (literal "{path}"))\n' for path in (launcher, headless))
    profile += '(allow process-fork)\n(allow network-outbound (remote tcp "localhost:*"))\n'
    profile += '(allow network-bind (local tcp "localhost:*"))\n(allow network-inbound (local tcp "localhost:*"))\n'
    command = [*prefix, '-p', profile]
    process = None
    log_path = root / 'emulator.log'
    logcat_path = root / 'guest-logcat.log'
    boot_marker = avd / 'bootcompleted.ini'
    result = {'outsideAccessDenied': True, 'guestKernelObserved': False, 'guestBootCompletedLog': False,
              'guestBootPropertyAction': False, 'emulatorBootCompletedMarker': False,
              'adbStarted': False, 'apkInstalled': False}
    try:
        # Serial kernel output uses stdio. Give the virtio logcat console its own file.
        logcat_path.touch(exist_ok=False)
        launch = [*command, launcher, '-avd', name, '-datadir', str(avd), '-port', '5560', '-no-window',
                  '-no-snapshot', '-no-audio', '-no-boot-anim', '-gpu', 'swiftshader', '-show-kernel',
                  '-feature', '-Vulkan', '-no-metrics', '-logcat', '*:S ActivityManager:I',
                  '-logcat-output', str(logcat_path)]
        with log_path.open('xb') as log, open(os.devnull, 'rb', buffering=0) as input_file:
            process = subprocess.Popen(launch, cwd=root, env=env, stdin=input_file, stdout=log, stderr=log,
                                       start_new_session=True)
        deadline = time.monotonic() + BOOT_TIMEOUT_SECONDS
        with log_path.open('rb') as output, logcat_path.open('rb') as logcat:
            kernel_tail = b''
            logcat_tail = b''
            while time.monotonic() < deadline:
                kernel_chunk = output.read(65_536)
                logcat_chunk = logcat.read(65_536)
                kernel = kernel_tail + kernel_chunk
                guest = logcat_tail + logcat_chunk
                result['guestKernelObserved'] |= b'Linux version ' in kernel
                result['guestBootCompletedLog'] |= b'ActivityManager: Finished booting' in guest
                result['guestBootPropertyAction'] |= bool(BOOT_PROPERTY_ACTION.search(kernel))
                result['emulatorBootCompletedMarker'] |= boot_marker_exists(boot_marker)
                kernel_tail = kernel[-256:]
                logcat_tail = guest[-256:]
                has_output = kernel_chunk or logcat_chunk
                if boot_completed(result) or (not has_output and process.poll() is not None):
                    break
                if not has_output:
                    time.sleep(.25)
        result['exitBeforeCleanup'] = process.poll()
        result['guestLogcatBytes'] = logcat_path.stat().st_size
        adb_key = root / 'android-config/adbkey'
        if probe_adb and result['exitBeforeCleanup'] is None and boot_completed(result):
            result['adbBootPropertyConfirmed'] = False
            adb_deadline = time.monotonic() + 35
            while time.monotonic() < adb_deadline and process.poll() is None:
                try:
                    result['adbBootPropertyConfirmed'] = query_boot_property(adb_key)
                except (EOFError, OSError, ValueError, subprocess.TimeoutExpired) as error:
                    result['adbProbeError'] = str(error)
                if result['adbBootPropertyConfirmed']:
                    result.pop('adbProbeError', None)
                    break
                time.sleep(2)
        if fixture_apk and result.get('adbBootPropertyConfirmed'):
            try:
                result['fixtureInstall'] = install_fixture(adb_key, fixture_apk, expected_hash=expected_hash,
                                                           rn_recovery=bool(rn_recovery), rn_product_tab=rn_product_tab)
                result['apkInstalled'] = True
            except (EOFError, OSError, ValueError, subprocess.TimeoutExpired) as error:
                result['fixtureInstallError'] = str(error)
        if render_inputs and result['apkInstalled']:
            try:
                if reopen_inputs:
                    result['fixtureReopen'] = reopen_fixture(adb_key, fixture_apk, *render_inputs, *reopen_inputs,
                                                            expected_hash=expected_hash, expire_pack=expire_pack,
                                                            sdk_offline=sdk_offline, online_recovery=online_recovery,
                                                            verify_refreshed_pack=verify_refreshed_pack)
                else:
                    evidence = render_fixture(adb_key, fixture_apk, *render_inputs, raster_tile=raster_tile,
                                              offline_pack=offline_pack, expected_hash=expected_hash)
                    result['fixturePack' if offline_pack else 'fixtureRender'] = evidence
            except (EOFError, OSError, ValueError, sqlite3.Error, subprocess.TimeoutExpired) as error:
                result['fixtureRenderError'] = str(error)
        if rn_recovery and result['apkInstalled']:
            from rn_recovery import capture_recovery

            try:
                result['rnRecovery'] = capture_recovery(adb_key, fixture_apk, *rn_recovery, expected_hash,
                                                       reopening=rn_reopen, product_map=rn_product_map,
                                                       product_tab=rn_product_tab, source_bounds=rn_source_bounds, zoom=rn_zoom, multi_zoom=rn_multi_zoom, adjacent_tiles=rn_adjacent_tiles, row_tiles=rn_row_tiles, row_pan=rn_row_pan)
            except (EOFError, OSError, ValueError, sqlite3.Error, subprocess.TimeoutExpired) as error:
                result['rnRecoveryError'] = str(error)
        with log_path.open('rb') as stream:
            stream.seek(max(0, os.fstat(stream.fileno()).st_size - 4000))
            result['emulatorLogTail'] = stream.read().decode(errors='replace').replace(str(root), '<qa-volume>')
        result['emulatorLogTail'] = re.sub(
            r'(?im)^(?:[^\n]*androidboot\.qemu\.adb\.pubkey=|[^\n]*Sending adb public key).+$',
            '<test ADB public key omitted>', result['emulatorLogTail'])
        return result
    finally:
        if process is not None and process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)


def boot_completed(result):
    return result['guestKernelObserved'] and (
        result['guestBootCompletedLog']
        or (result['guestBootPropertyAction'] and result['emulatorBootCompletedMarker'])
    )


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--sdk-root', required=True, type=Path)
    parser.add_argument('--probe-adb', action='store_true', help='Read only the boot property over direct ADB')
    parser.add_argument('--fixture-apk', type=Path, help='Install the pinned test APK after the boot query')
    parser.add_argument('--render-fixture', type=Path, nargs=3, metavar=('RELAY', 'SERVER_LOG', 'CAPTURE'))
    parser.add_argument('--raster-tile', action='store_true', help='Verify one zoom-zero synthetic raster tile')
    parser.add_argument('--offline-pack', action='store_true', help='Store the synthetic raster region without opening a map')
    parser.add_argument('--reopen-pack', type=Path, nargs=2, metavar=('JAVA', 'IDENTITY'),
                        help='Own a local server for the download, stop it, then reopen the same pack')
    parser.add_argument('--expire-pack', action='store_true', help='Wait until both cached resources have expired')
    parser.add_argument('--sdk-offline', action='store_true', help='Set MapLibre offline before reopening an expired pack')
    parser.add_argument('--online-recovery', action='store_true', help='Restore connectivity in the same MapLibre view')
    parser.add_argument('--verify-refreshed-pack', action='store_true', help='Restart offline with the refreshed content')
    parser.add_argument('--rn-recovery', type=Path, nargs=4, metavar=('RELAY', 'JAVA', 'IDENTITY', 'CAPTURE'),
                        help='Verify product pack recovery in the separate React Native fixture')
    parser.add_argument('--rn-reopen', action='store_true', help='Reopen the recovered React Native pack with its server closed')
    parser.add_argument('--rn-product-map', action='store_true', help='Display and switch the saved background in the product React Native map')
    parser.add_argument('--rn-product-tab', action='store_true', help='Use the real product map-tab route and buttons')
    parser.add_argument('--rn-source-bounds', action='store_true', help='Read the active renderer source bounds during product tab switches')
    parser.add_argument('--rn-zoom', type=int, choices=(8, 9), default=8, help='Synthetic pack zoom for React Native recovery')
    parser.add_argument('--fixture-apk-sha256', help='Verified hash of a separately signed pack fixture APK')
    parser.add_argument('--rn-multi-zoom', action='store_true', help='One pack containing zoom 8 and 9 tiles')
    parser.add_argument('--rn-adjacent-tiles', action='store_true', help='One pack with two adjacent zoom-nine tiles')
    parser.add_argument('--rn-row-tiles', action='store_true', help='One pack crossing two zoom-nine tile rows')
    parser.add_argument('--rn-row-pan', action='store_true', help='Observe the same cached row map after vertical gestures')
    args = parser.parse_args()
    if args.fixture_apk and not args.probe_adb:
        parser.error('--fixture-apk requires --probe-adb')
    if args.render_fixture and not args.fixture_apk:
        parser.error('--render-fixture requires --fixture-apk')
    if args.raster_tile and not args.render_fixture:
        parser.error('--raster-tile requires --render-fixture')
    if (args.offline_pack or bool(args.rn_recovery)) != bool(args.fixture_apk_sha256) or (args.offline_pack and not args.raster_tile):
        parser.error('--offline-pack requires --raster-tile and --fixture-apk-sha256')
    if args.rn_recovery and (not args.fixture_apk or args.render_fixture):
        parser.error('--rn-recovery requires its signed --fixture-apk and is separate from --render-fixture')
    if args.rn_reopen and not args.rn_recovery:
        parser.error('--rn-reopen requires --rn-recovery')
    if (args.rn_product_map or args.rn_product_tab) and not args.rn_reopen:
        parser.error('React Native screen verification requires --rn-reopen')
    if args.rn_product_map and args.rn_product_tab:
        parser.error('Choose one React Native screen verification mode')
    if args.rn_source_bounds and not args.rn_product_tab:
        parser.error('--rn-source-bounds requires --rn-product-tab')
    if args.rn_row_pan and not args.rn_row_tiles:
        parser.error('--rn-row-pan requires --rn-row-tiles')
    if args.rn_row_tiles and (not args.rn_source_bounds or args.rn_multi_zoom or args.rn_adjacent_tiles or args.rn_zoom != 8):
        parser.error('--rn-row-tiles requires --rn-source-bounds and excludes other tile modes')
    if args.rn_adjacent_tiles and (not args.rn_source_bounds or args.rn_multi_zoom or args.rn_zoom != 8):
        parser.error('--rn-adjacent-tiles requires --rn-source-bounds and excludes other zoom options')
    if args.rn_multi_zoom and (not args.rn_source_bounds or args.rn_zoom != 8):
        parser.error('--rn-multi-zoom requires --rn-source-bounds and default --rn-zoom 8')
    if args.rn_zoom != 8 and not args.rn_product_tab:
        parser.error('--rn-zoom 9 requires --rn-product-tab')
    if args.reopen_pack and not args.offline_pack:
        parser.error('--reopen-pack requires --offline-pack')
    if args.expire_pack and not args.reopen_pack:
        parser.error('--expire-pack requires --reopen-pack')
    if args.sdk_offline and not args.expire_pack:
        parser.error('--sdk-offline requires --expire-pack')
    if args.online_recovery and not args.sdk_offline:
        parser.error('--online-recovery requires --sdk-offline')
    if args.verify_refreshed_pack and not args.online_recovery:
        parser.error('--verify-refreshed-pack requires --online-recovery')
    if args.fixture_apk_sha256 and not re.fullmatch(r'[0-9a-f]{64}', args.fixture_apk_sha256):
        parser.error('Expected a lowercase SHA-256 digest')
    try:
        sdk = args.sdk_root.resolve(strict=True)
        if args.rn_recovery:
            preflight = Path(__file__).with_name('sdk-smoke') / 'verify-runtime-inputs.sh'
            check = subprocess.run(['/bin/bash', str(preflight), str(args.fixture_apk), args.fixture_apk_sha256,
                                    str(args.rn_recovery[2]), str(sdk / 'build-tools/36.0.0'), '--rn-recovery'],
                                   capture_output=True, text=True, check=False, timeout=40)
            if check.returncode:
                raise ValueError(f'React Native APK preflight failed: {check.stderr[:600]}')
        result = with_volume(size=BOOT_VOLUME, volume_check=lambda root: boot(
            root, sdk, probe_adb=args.probe_adb, fixture_apk=args.fixture_apk,
            render_inputs=args.render_fixture, raster_tile=args.raster_tile, offline_pack=args.offline_pack,
            expected_hash=args.fixture_apk_sha256 or FIXTURE_APK_SHA256, reopen_inputs=args.reopen_pack,
            expire_pack=args.expire_pack, sdk_offline=args.sdk_offline, online_recovery=args.online_recovery,
            verify_refreshed_pack=args.verify_refreshed_pack, rn_recovery=args.rn_recovery, rn_reopen=args.rn_reopen,
            rn_product_map=args.rn_product_map, rn_product_tab=args.rn_product_tab, rn_source_bounds=args.rn_source_bounds,
            rn_zoom=args.rn_zoom, rn_multi_zoom=args.rn_multi_zoom, rn_adjacent_tiles=args.rn_adjacent_tiles, rn_row_tiles=args.rn_row_tiles, rn_row_pan=args.rn_row_pan))
        print(json.dumps(result, sort_keys=True))
        check = result['volumeCheck']
        passed = boot_completed(check)
        if args.probe_adb:
            passed = passed and check.get('adbBootPropertyConfirmed')
        if args.fixture_apk:
            passed = passed and check['apkInstalled']
        if args.render_fixture:
            expected = 'fixtureReopen' if args.reopen_pack else 'fixturePack' if args.offline_pack else 'fixtureRender'
            passed = passed and expected in check
        if args.rn_recovery:
            passed = passed and 'rnRecovery' in check
        if args.rn_reopen:
            passed = passed and 'reopened' in check.get('rnRecovery', {})
        if args.rn_product_map:
            passed = passed and 'productMap' in check.get('rnRecovery', {})
        if args.rn_product_tab:
            passed = passed and 'productTab' in check.get('rnRecovery', {})
        if args.rn_source_bounds:
            passed = passed and 'sourceCoverage' in check.get('rnRecovery', {}).get('productTab', {})
        sys.exit(0 if passed else 2)
    except (ComponentError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        sys.exit(f'Isolated Android boot attempt failed: {error}')
