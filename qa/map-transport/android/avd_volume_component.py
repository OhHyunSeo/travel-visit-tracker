"""Measure one disposable, fixed-size macOS volume for Android QA preparation."""

from __future__ import annotations

import errno
import json
import os
from pathlib import Path
import plistlib
import re
import sys
import tempfile

from single_writer_component import ComponentError, _capture


VOLUME_BYTES = 768 * 1024**2
HEADROOM_BYTES = 5 * 1024**3
HDIUTIL = '/usr/bin/hdiutil'
DEVICE = re.compile(r'/dev/disk[0-9]+')
VOLUME_PROFILE = '''(version 1)
(deny default)
(allow file-read* file-map-executable)
(deny file-read* (subpath (param "PRIVATE_ANDROID")))
(allow process-exec (literal (param "PYTHON")))
(allow sysctl-read)
(allow file-write* (subpath (param "MOUNT")))
'''
FILL_WORKER = '''
import errno, json, os, pathlib, sys

mount, outside = map(pathlib.Path, sys.argv[1:])
if not os.path.ismount(mount) or mount.stat().st_dev == outside.stat().st_dev:
    raise RuntimeError('Expected a separate mounted filesystem')
try:
    with outside.open('ab') as output:
        output.write(b'outside write')
except PermissionError:
    pass
else:
    raise RuntimeError('Write outside the volume was allowed')

filled = 0
chunk = memoryview(bytes(1024 * 1024))
created = []
try:
    try:
        for index in range(48):
            path = mount / f'fill-{index}'
            with path.open('xb', buffering=0) as output:
                created.append(path)
                for _ in range(16):
                    remaining = chunk
                    while remaining:
                        count = output.write(remaining)
                        if not count:
                            raise RuntimeError('Volume write did not advance')
                        filled += count
                        remaining = remaining[count:]
                os.fsync(output.fileno())
    except OSError as error:
        if error.errno != errno.ENOSPC:
            raise
    else:
        raise RuntimeError('Fixed volume never reported ENOSPC')
finally:
    for path in created:
        path.unlink()

with (mount / 'recovery-proof').open('xb') as output:
    output.write(b'write after freeing space')
    output.flush()
    os.fsync(output.fileno())
(mount / 'recovery-proof').unlink()
print(json.dumps({'writtenBytes': filled, 'filesCreated': len(created), 'errno': errno.ENOSPC,
                  'outsideWriteDenied': True, 'writeAfterRelease': True}))
'''


def image_device(info: bytes, image: Path) -> str | None:
    matches = [item for item in plistlib.loads(info)['images'] if item.get('image-path') == str(image)]
    if not matches:
        return None
    if len(matches) != 1:
        raise ComponentError('Owned image has more than one attachment')
    devices = [entity.get('dev-entry', '') for entity in matches[0]['system-entities']]
    roots = [value for value in devices if DEVICE.fullmatch(value)]
    if len(roots) != 1:
        raise ComponentError('Owned image has no unique root device')
    return roots[0]


def mount_device(reply: bytes, mount: Path) -> str:
    entries = plistlib.loads(reply)['system-entities']
    matches = [entry.get('dev-entry', '') for entry in entries if entry.get('mount-point') == str(mount)]
    if len(matches) != 1 or not DEVICE.fullmatch(matches[0]):
        raise ComponentError('Expected one whole-device mount for the partitionless volume')
    return matches[0]


def backing_identity(image: Path) -> tuple[int, int]:
    if image.is_symlink() or not image.is_file():
        raise ComponentError('Expected an owned regular backing image')
    value = image.stat()
    if value.st_nlink != 1 or value.st_size != VOLUME_BYTES or value.st_blocks * 512 != VOLUME_BYTES:
        raise ComponentError('Backing image must be fully allocated and exactly 768 MiB')
    return value.st_dev, value.st_ino


def probe_capacity(root: Path, mount: Path, free: int, environment: dict) -> dict:
    canary = root / 'outside-canary'
    baseline = b'trip-painting outside volume canary'
    canary.write_bytes(baseline)
    python = str(Path(sys.executable).resolve(strict=True))
    try:
        output, _ = _capture([
            '/usr/bin/sandbox-exec', '-D', 'PYTHON=' + python, '-D', 'MOUNT=' + str(mount),
            '-D', 'PRIVATE_ANDROID=' + str(Path.home() / '.android'), '-p', VOLUME_PROFILE,
            python, '-I', '-S', '-B', '-c', FILL_WORKER, str(mount), str(canary),
        ], cwd=mount, env={**environment, 'TMPDIR': str(mount)})
        result = json.loads(output)
        if result['errno'] != errno.ENOSPC or not free - 16 * 1024**2 < result['writtenBytes'] <= free:
            raise ComponentError('Mounted volume exhaustion differs from the measured capacity')
        if not result['outsideWriteDenied'] or not result['writeAfterRelease'] or result['filesCreated'] < 2:
            raise ComponentError('Mounted volume did not pass multi-file confinement and recovery')
        if canary.read_bytes() != baseline:
            raise ComponentError('Outside canary changed during the mounted-volume check')
        return result
    finally:
        canary.unlink(missing_ok=True)


def run(*, fill: bool = False) -> dict:
    if sys.platform != 'darwin':
        raise ComponentError('The volume component requires macOS')
    temporary = Path(tempfile.gettempdir()).resolve(strict=True)
    space = os.statvfs(temporary)
    if space.f_bavail * space.f_frsize < HEADROOM_BYTES:
        raise ComponentError('At least 5 GiB must be available before creating the volume')
    root = Path(tempfile.mkdtemp(prefix='trip-avd-volume.', dir=temporary))
    image = root / 'capacity.dmg'
    mount = root / 'mount'
    mount.mkdir(mode=0o700)
    environment = {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LANG': 'C', 'TMPDIR': str(root)}

    def command(*args: str) -> bytes:
        return _capture([HDIUTIL, *args], cwd=root, env=environment)[0]

    attached = False
    try:
        command('create', '-size', '768m', '-fs', 'HFS+', '-layout', 'NONE', '-type', 'UDIF',
                '-nospotlight', '-volname', 'TripPaintingQA', str(image))
        identity = backing_identity(image)
        attached = True  # A failed attach command can still leave an attachment.
        reply = command('attach', str(image), '-nobrowse', '-noautoopen', '-noautofsck',
                        '-owners', 'on', '-mountpoint', str(mount), '-plist')
        device = mount_device(reply, mount)
        if image_device(command('info', '-plist'), image) != device:
            raise ComponentError('Mounted device does not match the owned image')
        if not os.path.ismount(mount) or mount.stat().st_dev == root.stat().st_dev:
            raise ComponentError('Expected a distinct mounted filesystem')
        volume = os.statvfs(mount)
        capacity = volume.f_blocks * volume.f_frsize
        free = volume.f_bavail * volume.f_frsize
        if capacity != VOLUME_BYTES or not 0 < free < capacity:
            raise ComponentError('Mounted filesystem does not match the candidate capacity')
        fill_result = probe_capacity(root, mount, free, environment) if fill else None
        if backing_identity(image) != identity:
            raise ComponentError('Backing image changed identity while mounted')
    finally:
        try:
            if attached:
                device = image_device(command('info', '-plist'), image)
                if device is not None:
                    command('detach', device)
                if image_device(command('info', '-plist'), image) is not None or os.path.ismount(mount):
                    raise ComponentError('Owned image is still attached')
            image.unlink(missing_ok=True)
            mount.rmdir()
            root.rmdir()
        except (ComponentError, OSError, ValueError, KeyError) as error:
            raise ComponentError(f'Owned volume cleanup is unconfirmed at {root}: {error}') from error
    return {'backingBytes': VOLUME_BYTES, 'backingAllocatedBytes': VOLUME_BYTES,
            'filesystemCapacityBytes': capacity, 'filesystemFreeBytes': free,
            'fillProbe': fill_result, 'ownedVolumeRemoved': True, 'nativeAdmissionEnabled': False}


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--fill', action='store_true', help='Check actual multi-file ENOSPC on the owned volume')
    args = parser.parse_args()
    try:
        print(json.dumps(run(fill=args.fill), sort_keys=True))
    except (ComponentError, OSError, ValueError, KeyError) as error:
        sys.exit(f'Fixed volume component failed: {error}')
