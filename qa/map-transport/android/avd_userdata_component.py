"""Prepare and verify independent userdata image formats on a fixed QA volume."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import sys
import tempfile

from avd_volume_component import run as with_volume
from ext4_component import CHECKER_SHA256, FORMATTER_SHA256, verify_sdk_tool
from single_writer_component import ComponentError, _capture


VIRTUAL_BYTES = 512 * 1024**2
QEMU_SHA256 = '8397933f500785d8c35c086ecf97b4685da9e1eca0bc3cc8930dd48689197e94'
READ_PROFILE = '''(version 1)
(deny default)
(allow file-read* file-map-executable)
(deny file-read* (subpath (param "PRIVATE_ANDROID")))
(allow process-exec (literal (param "TOOL")))
(allow sysctl-read)
'''
WRITE_PROFILE = READ_PROFILE + '(allow file-write* (subpath (param "ROOT")))\n'


def restricted_tool_argv(tool: Path, root: Path, profile: str) -> list[str]:
    return ['/usr/bin/sandbox-exec', '-D', 'TOOL=' + str(tool), '-D', 'ROOT=' + str(root),
            '-D', 'PRIVATE_ANDROID=' + str(Path.home() / '.android'), '-p', profile]


def verify_qemu(sdk: Path) -> Path:
    tool = sdk.resolve(strict=True) / 'emulator/qemu-img'
    if tool != tool.resolve(strict=True) or not tool.is_file() or not os.access(tool, os.X_OK):
        raise ComponentError('Expected the cached qemu-img executable')
    with tool.open('rb') as source:
        body = source.read(16 * 1024**2 + 1)
    if len(body) > 16 * 1024**2 or hashlib.sha256(body).hexdigest() != QEMU_SHA256:
        raise ComponentError('Cached qemu-img hash differs')
    return tool


def verify_preparation_exec_boundary(sdk: Path) -> dict:
    """Exercise the actual preparation profiles with non-booting commands."""
    if sys.platform != 'darwin':
        raise ComponentError('The SDK preparation execution check requires macOS')
    sdk = sdk.resolve(strict=True)
    qemu_img = verify_qemu(sdk)
    denied = {
        'emulator': (sdk / 'emulator/emulator', '-version'),
        'qemu': (sdk / 'emulator/qemu/darwin-aarch64/qemu-system-aarch64', '--version'),
        'adb': (sdk / 'platform-tools/adb', 'version'),
    }
    for path, _ in denied.values():
        if path.resolve(strict=True) != path or not path.is_file() or not os.access(path, os.X_OK):
            raise ComponentError('Expected regular cached SDK executables for the negative probes')
    results = {}
    with tempfile.TemporaryDirectory(prefix='trip-producer-exec.') as temporary:
        root = Path(temporary).resolve(strict=True)
        env = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'TMPDIR': str(root)}
        for phase, profile in (('read', READ_PROFILE), ('write', WRITE_PROFILE)):
            argv = restricted_tool_argv(qemu_img, root, profile)
            output, _ = _capture([*argv, str(qemu_img), '--version'], cwd=root, env=env)
            if b'qemu-img version' not in output.lower():
                raise ComponentError('The positive qemu-img control did not emit its version')
            for label, (path, arg) in denied.items():
                try:
                    _capture([*argv, str(path), arg], cwd=root, env=env)
                except ComponentError as error:
                    if 'Operation not permitted' not in str(error):
                        raise
                else:
                    raise ComponentError(f'The preparation profile allowed {label} execution')
            results[phase] = {'qemuImgAllowed': True, 'executionDenied': list(denied)}
        if any(root.iterdir()):
            raise ComponentError('Execution probes unexpectedly created files')
    return {'profiles': results, 'guestBooted': False, 'nativeAdmissionEnabled': False}


def inspect_qcow_info(info: dict) -> int:
    if info.get('format') != 'qcow2' or info.get('virtual-size') != VIRTUAL_BYTES:
        raise ComponentError('Unexpected userdata disk format or capacity')
    if any('backing' in key.lower() for key in info):
        raise ComponentError('The userdata disk must have no backing file')
    details = info.get('format-specific', {}).get('data', {})
    if details.get('data-file') or info.get('snapshots'):
        raise ComponentError('The userdata disk must have no external data or snapshots')
    actual = info.get('actual-size')
    if type(actual) is not int or not 0 < actual < VIRTUAL_BYTES:
        raise ComponentError('Unexpected userdata disk allocation')
    return actual


def verify_qcow_header(path: Path) -> None:
    with path.open('rb') as stream:
        header = stream.read(104)
    if len(header) != 104:
        raise ComponentError('Incomplete userdata QCOW2 header')
    magic, version, backing_offset, backing_size, _, virtual = struct.unpack_from('>4sIQIIQ', header)
    if (magic, version, backing_offset, backing_size, virtual) != (b'QFI\xfb', 3, 0, 0, VIRTUAL_BYTES):
        raise ComponentError('Userdata QCOW2 header does not match the standalone disk')
    snapshots, snapshot_offset, incompatible = struct.unpack_from('>IQQ', header, 60)
    if snapshots or snapshot_offset or incompatible:
        raise ComponentError('Userdata QCOW2 has snapshots or unsupported incompatible features')


def prepare(sdk: Path, mount: Path) -> dict:
    mkfs = verify_sdk_tool(sdk, 'mkfs.ext4', FORMATTER_SHA256)
    fsck = verify_sdk_tool(sdk, 'fsck.ext4', CHECKER_SHA256)
    qemu = verify_qemu(sdk)
    raw = mount / 'fresh-userdata.ext4'
    qcow = mount / 'fresh-userdata.qcow2'
    environment = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'TMPDIR': str(mount), 'MKE2FS_CONFIG': '/dev/null'}

    def command(tool, *args, write=False):
        return _capture([
            *restricted_tool_argv(tool, mount, WRITE_PROFILE if write else READ_PROFILE),
            str(tool), *map(str, args),
        ], cwd=mount, env=environment)[0]

    with raw.open('xb') as stream:
        stream.truncate(VIRTUAL_BYTES)
    command(mkfs, '-q', '-F', '-b', '4096', '-E', 'nodiscard', '-L', 'data', raw, write=True)
    command(fsck, '-fn', raw)
    raw_allocated = raw.stat().st_blocks * 512
    command(qemu, 'convert', '-f', 'raw', '-O', 'qcow2', '-o', 'preallocation=off', raw, qcow, write=True)
    verify_qcow_header(qcow)
    actual = inspect_qcow_info(json.loads(command(qemu, 'info', '--output=json', '-f', 'qcow2', qcow)))
    command(qemu, 'check', '-f', 'qcow2', qcow)
    command(qemu, 'compare', '-f', 'raw', '-F', 'qcow2', raw, qcow)
    if raw.stat().st_size != VIRTUAL_BYTES or actual != qcow.stat().st_blocks * 512:
        raise ComponentError('Filesystem allocation differs from the tool output')
    return {'virtualBytes': VIRTUAL_BYTES, 'rawAllocatedBytes': raw_allocated,
            'qcowAllocatedBytes': actual, 'qcowLogicalBytes': qcow.stat().st_size,
            'ext4Checked': True, 'qcowChecked': True, 'contentsMatch': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--sdk-root', required=True, type=Path)
    parser.add_argument('--verify-exec-boundary', action='store_true',
                        help='Probe the preparation profiles without creating a volume or userdata image')
    args = parser.parse_args()
    try:
        result = (verify_preparation_exec_boundary(args.sdk_root) if args.verify_exec_boundary else
                  with_volume(volume_check=lambda mount: prepare(args.sdk_root, mount)))
        print(json.dumps(result, sort_keys=True))
    except (ComponentError, OSError, ValueError, KeyError) as error:
        sys.exit(f'Independent userdata component failed: {error}')
