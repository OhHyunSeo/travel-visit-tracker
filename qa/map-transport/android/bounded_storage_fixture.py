#!/usr/bin/env python3
"""Opt-in macOS 32MiB storage/confinement component, never an AVD launcher.

Only --run-fixture creates one new owned image. It tests a small Python worker,
not emulator/QEMU/ADB, and leaves the native-validation admission gate closed.
"""
from __future__ import annotations

import argparse
import errno
import hashlib
import json
import os
import pathlib
import plistlib
import re
import selectors
import signal
import subprocess
import sys
import time
import uuid

IMAGE_BYTES = 32 * 1024 * 1024
MAX_NEW_BYTES = 64 * 1024 * 1024
OUTPUT_BYTES = 64 * 1024
COMMAND_SECONDS = 45
PROFILE = '''(version 1)
(deny default)
(allow file-read* file-map-executable)
(allow process-exec process-fork)
(allow sysctl-read)
(allow file-write* (subpath (param "QA_ROOT")))
'''


class FixtureError(RuntimeError):
    pass


def owned_root(root: pathlib.Path, android: pathlib.Path) -> pathlib.Path:
    root, android = root.absolute(), android.resolve()
    if root.parent != android / '.build/storage-component' or not re.fullmatch(r'run_[0-9a-f]{12}', root.name):
        raise FixtureError('Fixture must be a newly owned workspace run directory')
    current = root
    while current != android:
        if current.is_symlink():
            raise FixtureError('Fixture paths must not contain symlinks')
        current = current.parent
    return root


def mounted_capacity(root: pathlib.Path) -> dict:
    mount = root / 'mount'
    if not os.path.ismount(mount) or mount.stat().st_dev == root.stat().st_dev:
        raise FixtureError('Worker refuses an ordinary directory or detached mount')
    space = os.statvfs(mount)
    capacity = space.f_blocks * space.f_frsize
    if not 0 < capacity <= IMAGE_BYTES:
        raise FixtureError('Mounted filesystem exceeds the 32MiB component cap')
    return {'device': mount.stat().st_dev, 'capacityBytes': capacity,
            'freeBytes': space.f_bavail * space.f_frsize}


def denied_write(path: pathlib.Path) -> int:
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    except OSError as error:
        if error.errno in (errno.EPERM, errno.EACCES):
            return error.errno
        raise
    else:
        os.close(descriptor)
        raise FixtureError('An outside-owned-canary write was unexpectedly allowed')


def worker(root: pathlib.Path, inherited: int | None, child: bool) -> dict:
    capacity = mounted_capacity(root)
    mount = root / 'mount'
    # The inherited FD is inspected before opening any new worker file.
    closed = None  # A child without the FD argument must not claim this check.
    if inherited is not None:
        try:
            os.fstat(inherited)
        except OSError as error:
            if error.errno != errno.EBADF:
                raise
            closed = True
        else:
            closed = False
        if not closed:
            raise FixtureError('The outside writable descriptor was inherited')
    denied = denied_write(root / 'outside-canary')
    denied_create = denied_write(root / 'outside-created')
    symlink = mount / ('child-link' if child else 'parent-link')
    symlink.symlink_to(root / 'outside-canary')
    denied_link = denied_write(symlink)
    inside = mount / ('child-proof' if child else 'parent-proof')
    with inside.open('xb') as target:
        target.write(b'owned component proof')
        target.flush()
        os.fsync(target.fileno())
    if child:
        return {'outsideDeniedErrno': denied, 'outsideCreateDeniedErrno': denied_create,
                'symlinkOutsideDeniedErrno': denied_link,
                'insideWritePassed': True, 'inheritedWritableFdClosed': closed}
    child_result = command([sys.executable, '-S', '-B', str(pathlib.Path(__file__).resolve()),
                            '--worker-child', str(root)], cwd=mount, new_session=False)
    child_proof = json.loads(child_result)
    count = 0
    enospc = False
    body = b'\xa5' * (256 * 1024)
    fill = mount / 'fill.bin'
    try:
        with fill.open('xb', buffering=0) as target:
            while count <= IMAGE_BYTES:
                try:
                    count += target.write(body)
                    os.fsync(target.fileno())
                except OSError as error:
                    if error.errno != errno.ENOSPC:
                        raise
                    enospc = True
                    break
        if not enospc:
            raise FixtureError('The fixed filesystem did not stop writes with ENOSPC')
    finally:
        fill.unlink(missing_ok=True)
    with (mount / 'after-enospc').open('xb') as target:
        target.write(b'recovered')
        target.flush()
        os.fsync(target.fileno())
    return {'capacity': capacity, 'outsideDeniedErrno': denied,
            'outsideCreateDeniedErrno': denied_create,
            'symlinkOutsideDeniedErrno': denied_link,
            'inheritedWritableFdClosed': closed, 'insideWritePassed': True,
            'child': child_proof, 'actualFilesystemENOSPC': enospc,
            'successfulFillWriteBytes': count, 'writeAfterRemovingOwnedFillPassed': True}


def command(argv: list[str], *, cwd: pathlib.Path, env: dict | None = None,
            new_session: bool = True) -> bytes:
    # No inherited writable files; only stdin=/dev/null and bounded pipe output.
    # subprocess.DEVNULL opens O_RDWR. Open it read-only instead, so children
    # need no write exception for any outside path, including /dev/null.
    with open(os.devnull, 'rb', buffering=0) as input_stream:
        process = subprocess.Popen(argv, cwd=cwd, env=env, stdin=input_stream,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   close_fds=True, start_new_session=new_session)
    streams = {process.stdout: bytearray(), process.stderr: bytearray()}
    deadline = time.monotonic() + COMMAND_SECONDS
    group_terminated = False
    try:
        with selectors.DefaultSelector() as selector:
            for stream in streams:
                selector.register(stream, selectors.EVENT_READ)
            while selector.get_map():
                if time.monotonic() >= deadline:
                    raise FixtureError('Owned component command timed out')
                for key, _ in selector.select(min(.1, max(0, deadline - time.monotonic()))):
                    body = os.read(key.fileobj.fileno(), 4096)
                    if not body:
                        selector.unregister(key.fileobj)
                    else:
                        streams[key.fileobj].extend(body)
                        if sum(map(len, streams.values())) > OUTPUT_BYTES:
                            raise FixtureError('Component output exceeded its reporting allowance')
        process.wait(timeout=max(.001, deadline - time.monotonic()))
    except BaseException:
        if new_session:
            try:
                # The leader may have exited while a descendant holds a pipe.
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            group_terminated = True
        elif process.poll() is None:
            process.kill()
        process.wait()
        raise
    finally:
        try:
            if new_session and not group_terminated:
                try:
                    # No owned descendant may outlive command() and the mount.
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        finally:
            for stream in streams:
                stream.close()
    stdout, stderr = map(bytes, streams.values())
    if process.returncode:
        raise FixtureError('Component command failed: ' + stderr.decode(errors='replace')[:2048])
    return stdout


def attach_device(reply: bytes, mount: pathlib.Path) -> str:
    entities = plistlib.loads(reply).get('system-entities', [])
    matches = [item.get('dev-entry') for item in entities
               if item.get('mount-point') == str(mount)]
    if len(matches) != 1 or not re.fullmatch(r'/dev/disk[0-9]+(?:s[0-9]+)?', matches[0] or ''):
        raise FixtureError('Attach did not identify exactly one owned mount')
    return matches[0]


def owned_attachments(reply: bytes, image: pathlib.Path) -> list[str]:
    devices = []
    for item in plistlib.loads(reply).get('images', []):
        if item.get('image-path') != str(image):
            continue
        roots = [value.get('dev-entry') for value in item.get('system-entities', [])
                 if re.fullmatch(r'/dev/disk[0-9]+', value.get('dev-entry', ''))]
        if len(roots) != 1:
            raise FixtureError('Owned attachment has no unique root device')
        devices.extend(roots)
    return devices


def run_fixture(android: pathlib.Path) -> dict:
    if sys.platform != 'darwin':
        raise FixtureError('The actual component is macOS-only; use host tests elsewhere')
    android = android.resolve()
    if os.statvfs(android).f_bavail * os.statvfs(android).f_frsize < 4 * 1024**3:
        raise FixtureError('Leave at least 4GiB host headroom for this small component')
    root = owned_root(android / '.build/storage-component' / ('run_' + uuid.uuid4().hex[:12]), android)
    root.mkdir(parents=True, exist_ok=False)
    mount = root / 'mount'
    mount.mkdir()
    temporary = root / 'tool-temp'
    temporary.mkdir()
    image = root / 'capacity.dmg'
    canary = root / 'outside-canary'
    canary_bytes = uuid.uuid4().hex.encode()
    canary.write_bytes(canary_bytes)
    environment = {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'TMPDIR': str(temporary),
                   'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONNOUSERSITE': '1', 'LANG': 'C'}
    report = {'scope': 'macOS fixed-filesystem and Python-worker confinement component only',
              'imageRequestedBytes': IMAGE_BYTES, 'maxImageFileBytes': MAX_NEW_BYTES,
              'emulatorAvdAdbOrSdkWrites': False, 'nativeAdmissionEnabled': False,
              'wholeMacGrowthCapProven': False, 'passed': False, 'cleanup': {}}
    device = None
    attach_attempted = False
    try:
        # Verify profile setup before allocating even this small image.
        command(['/usr/bin/sandbox-exec', '-D', 'QA_ROOT=' + str(mount), '-p', PROFILE,
                 '/usr/bin/true'], cwd=root, env=environment)
        command(['/usr/bin/hdiutil', 'create', '-size', '32m', '-fs', 'HFS+',
                 '-layout', 'NONE', '-type', 'UDIF', '-nospotlight',
                 '-volname', 'TP_QA_' + root.name[4:], str(image)], cwd=root, env=environment)
        if (image.is_symlink() or image.stat().st_nlink != 1
                or not 0 < image.stat().st_size < MAX_NEW_BYTES
                or image.stat().st_blocks * 512 >= MAX_NEW_BYTES):
            raise FixtureError('Created image exceeded the component allowance')
        backing_identity = (image.stat().st_dev, image.stat().st_ino)
        report['createdImage'] = {'logicalBytes': image.stat().st_size,
                                  'allocatedBytes': image.stat().st_blocks * 512}
        attach_attempted = True
        reply = command(['/usr/bin/hdiutil', 'attach', str(image), '-nobrowse',
                         '-noautoopen', '-noautofsck', '-owners', 'on',
                         '-mountpoint', str(mount), '-plist'], cwd=root, env=environment)
        (root / 'attach.plist').write_bytes(reply)
        device = attach_device(reply, mount)
        report['mounted'] = mounted_capacity(root)
        descriptor = os.open(canary, os.O_WRONLY | os.O_APPEND)
        os.set_inheritable(descriptor, True)
        try:
            sandbox_env = {**environment, 'TMPDIR': str(mount),
                           'ANDROID_TMP': str(mount), 'ANDROID_EMULATOR_HOME': str(mount),
                           'ANDROID_AVD_HOME': str(mount)}
            (root / 'profile.sb').write_text(PROFILE)
            reply = command(['/usr/bin/sandbox-exec', '-D', 'QA_ROOT=' + str(mount),
                             '-p', PROFILE, sys.executable, '-S', '-B',
                             str(pathlib.Path(__file__).resolve()), '--worker', str(root),
                             '--inherited-fd', str(descriptor)], cwd=mount, env=sandbox_env)
        finally:
            os.close(descriptor)
        report['worker'] = json.loads(reply)
        if (mounted_capacity(root)['device'] != report['mounted']['device']
                or (image.stat().st_dev, image.stat().st_ino) != backing_identity):
            raise FixtureError('The mounted filesystem or owned backing file changed')
        if canary.read_bytes() != canary_bytes or (root / 'outside-created').exists():
            raise FixtureError('Outside-owned canaries changed')
        report['outsideCanaryUnchanged'] = True
        report['passed'] = True
    except BaseException as error:
        report['error'] = str(error)
    finally:
        if device is not None or attach_attempted:
            try:
                # hdiutil info lists existing attachments; unlike image info it
                # does not attach an image to inspect it. Match this new path.
                devices = owned_attachments(command(['/usr/bin/hdiutil', 'info', '-plist'],
                                                     cwd=root, env=environment), image)
                for owned_device in devices:
                    command(['/usr/bin/hdiutil', 'detach', owned_device], cwd=root, env=environment)
                remaining = owned_attachments(command(['/usr/bin/hdiutil', 'info', '-plist'],
                                                       cwd=root, env=environment), image)
                report['cleanup']['detached'] = not remaining and not os.path.ismount(mount)
            except Exception as error:
                report['cleanup']['detachError'] = str(error)
        else:
            report['cleanup']['detached'] = not os.path.ismount(mount)
        # Never remove an image while a mount remains or attach identity is unclear.
        if report['cleanup'].get('detached'):
            if image.exists():
                value = image.stat()
                report['finalImage'] = {'logicalBytes': value.st_size,
                                        'allocatedBytes': value.st_blocks * 512,
                                        'sha256': None}
                report['imageSizeUnchanged'] = (report.get('createdImage', {}).get('logicalBytes')
                                                == value.st_size)
                if not report['imageSizeUnchanged'] or value.st_blocks * 512 >= MAX_NEW_BYTES:
                    report['passed'] = False
                if value.st_size < MAX_NEW_BYTES and image.is_file() and not image.is_symlink():
                    report['finalImage']['sha256'] = hashlib.sha256(image.read_bytes()).hexdigest()
                    image.unlink()
                    report['cleanup']['ownedImageRemoved'] = True
            if canary.read_bytes() == canary_bytes:
                canary.unlink()
                report['cleanup']['ownedCanaryRemoved'] = True
        if not all(report['cleanup'].get(key) for key in
                   ('detached', 'ownedImageRemoved', 'ownedCanaryRemoved')):
            report['passed'] = False
        report['remainingBeforeResultReportBytes'] = sum(path.stat().st_size for path in root.rglob('*')
                                                        if path.is_file() and not path.is_symlink())
        (root / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
    return {'runRoot': str(root), **report}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--run-fixture', action='store_true')
    mode.add_argument('--worker', type=pathlib.Path)
    mode.add_argument('--worker-child', type=pathlib.Path)
    parser.add_argument('--inherited-fd', type=int)
    args = parser.parse_args()
    android = pathlib.Path(__file__).resolve().parent
    if args.run_fixture:
        result = run_fixture(android)
    else:
        root = owned_root(args.worker or args.worker_child, android)
        result = worker(root, args.inherited_fd, args.worker_child is not None)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result.get('passed', True) else 1


if __name__ == '__main__':
    raise SystemExit(main())
