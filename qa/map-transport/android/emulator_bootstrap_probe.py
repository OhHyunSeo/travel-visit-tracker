#!/usr/bin/env python3
"""A fixed `emulator -version` loader probe, never a configurable boot command."""
from __future__ import annotations

import argparse
import errno
import hashlib
import json
import os
import pathlib
import re
import stat
import sys

import bounded_storage_fixture as fixture
from bounded_avd_storage import _bounded_metadata, _regular_file

MAX_LOADER_FILE_BYTES = 128 * 1024 * 1024


def bounded_hash(path: pathlib.Path) -> str:
    expected = _regular_file(path)
    if expected is None or not 0 < expected.st_size <= MAX_LOADER_FILE_BYTES:
        raise fixture.FixtureError('Cached loader file exceeds the bounded inspection size')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    stamp = lambda value: (value.st_dev, value.st_ino, value.st_size,
                           value.st_mtime_ns, value.st_ctime_ns)
    try:
        actual = os.fstat(descriptor)
        if not stat.S_ISREG(actual.st_mode) or actual.st_nlink != 1 or stamp(actual) != stamp(expected):
            raise fixture.FixtureError('Cached loader changed identity before reading')
        digest, count = hashlib.sha256(), 0
        while True:
            body = os.read(descriptor, min(1024 * 1024, MAX_LOADER_FILE_BYTES + 1 - count))
            if not body:
                break
            count += len(body)
            if count > MAX_LOADER_FILE_BYTES:
                raise fixture.FixtureError('Cached loader grew beyond its read bound')
            digest.update(body)
        if count != actual.st_size or stamp(os.fstat(descriptor)) != stamp(actual):
            raise fixture.FixtureError('Cached loader changed while reading')
        return digest.hexdigest()
    finally:
        os.close(descriptor)


def cached_loader(sdk: pathlib.Path) -> dict:
    sdk = sdk.absolute()
    paths = {'launcher': sdk / 'emulator/emulator',
             'qemu': sdk / 'emulator/qemu/darwin-aarch64/qemu-system-aarch64',
             'properties': sdk / 'emulator/source.properties'}
    for path in paths.values():
        current = path
        while True:
            if current.is_symlink():
                raise fixture.FixtureError('The cached loader must not use symlinked paths')
            if current == sdk:
                break
            current = current.parent
        if not path.is_file():
            raise fixture.FixtureError('Cached arm64 emulator loader files are missing')
    properties = _bounded_metadata(paths['properties'], _regular_file(paths['properties'])).decode()
    match = re.search(r'^Pkg.Revision=(\d+\.\d+\.\d+)\s*$', properties, re.M)
    if not match:
        raise fixture.FixtureError('Cached emulator revision is unavailable')
    hashes = {}
    for name, path in paths.items():
        hashes[name] = bounded_hash(path)
    return {'sdkRoot': str(sdk), 'launcher': str(paths['launcher']),
            'revision': match[1], 'sha256': hashes}


def probe_environment(base: dict, mount: pathlib.Path) -> dict:
    # Do not inherit launcher options, proxies, DYLD injection or product builds.
    # HOME/home/CODEX_HOME are neither repurposed nor set by this helper.
    result = {key: base[key] for key in ('PATH', 'LANG') if key in base}
    result.update({'TMPDIR': str(mount / 'tmp'), 'ANDROID_TMP': str(mount / 'tmp'),
                   'XDG_RUNTIME_DIR': str(mount / 'tmp'),
                   'DARWIN_USER_TEMP_DIR': str(mount / 'tmp'),
                   'ANDROID_EMULATOR_HOME': str(mount / 'android-config'),
                   'ANDROID_AVD_HOME': str(mount / 'avd'),
                   'ANDROID_USER_HOME': str(mount / 'android-user'),
                   'ANDROID_PREFS_ROOT': str(mount / 'android-config'),
                   'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONNOUSERSITE': '1'})
    return result


def version_argv(loader: dict) -> list[str]:
    return [loader['launcher'], '-version']


def validate_version_output(body: bytes, revision: str) -> str:
    text = body.decode('utf-8', errors='replace')
    match = re.search(r'^Android emulator version (' + re.escape(revision) + r'(?:\.\d+)?)\b', text, re.M)
    if not match:
        raise fixture.FixtureError('Loader exited without the expected version output; not a pass')
    return match[1]


def exec_version(root: pathlib.Path, sdk: pathlib.Path, descriptor: int) -> None:
    fixture.mounted_capacity(root)
    try:
        os.fstat(descriptor)
    except OSError as error:
        if error.errno != errno.EBADF:
            raise
    else:
        raise fixture.FixtureError('Loader wrapper inherited an outside writable FD')
    loader = cached_loader(sdk)
    preamble = {'pid': os.getpid(), 'outsideWritableFdClosed': True,
                'argv': version_argv(loader), 'avdArgument': None,
                'nativeAdmissionEnabled': False}
    with (root / 'mount/log/loader-preamble.json').open('x') as target:
        json.dump(preamble, target)
        target.flush()
        os.fsync(target.fileno())
    # Replace this process, preserving its inherited sandbox and process group.
    os.execve(loader['launcher'], version_argv(loader), dict(os.environ))


def run_probe(root: pathlib.Path, base_environment: dict, sdk: pathlib.Path) -> dict:
    before = cached_loader(sdk)
    mount = root / 'mount'
    capacity = fixture.mounted_capacity(root)
    for name in ('tmp', 'avd', 'android-config', 'android-user', 'log'):
        (mount / name).mkdir(exist_ok=False)
    environment = probe_environment(base_environment, mount)
    # Keep private AVDs unreadable even though system/SDK loader reads are allowed.
    profile = fixture.PROFILE + '\n(deny file-read* (subpath (param "PRIVATE_AVD_ROOT")))\n'
    (root / 'loader-profile.sb').write_text(profile)
    descriptor = os.open(root / 'outside-canary', os.O_WRONLY | os.O_APPEND)
    os.set_inheritable(descriptor, True)
    try:
        body = fixture.command([
            '/usr/bin/sandbox-exec', '-D', 'QA_ROOT=' + str(mount),
            '-D', 'PRIVATE_AVD_ROOT=' + str(pathlib.Path.home() / '.android/avd'),
            '-p', profile, sys.executable, '-S', '-B', str(pathlib.Path(__file__).resolve()),
            '--exec-version', str(root), '--sdk-root', str(sdk),
            '--closed-fd', str(descriptor),
        ], cwd=mount, env=environment)
    finally:
        os.close(descriptor)
    output_version = validate_version_output(body, before['revision'])
    (root / 'loader-version-output.txt').write_bytes(body)
    preamble = json.loads((mount / 'log/loader-preamble.json').read_text())
    if preamble['argv'] != version_argv(before) or not preamble['outsideWritableFdClosed']:
        raise fixture.FixtureError('Version wrapper did not preserve fixed arguments/FD checks')
    after = cached_loader(sdk)
    if after != before or fixture.mounted_capacity(root)['device'] != capacity['device']:
        raise fixture.FixtureError('Cached loader files or mounted storage changed')
    artifacts = []
    for index, path in enumerate(mount.rglob('*')):
        if index >= 512:
            raise fixture.FixtureError('Loader artifact inventory exceeded its bound')
        if path.is_file() and not path.is_symlink():
            artifacts.append({'path': str(path.relative_to(mount)), 'bytes': path.stat().st_size})
    return {'scope': 'cached emulator executable -version only; no virtual device',
            'version': output_version, 'sdkFilesBeforeAfterMatch': True,
            'cachedLoaderSha256': before['sha256'], 'wrapper': preamble,
            'profileMachOrSocketExceptionsAdded': False,
            'androidTempConfigAndOutputPaths': 'owned 32MiB mounted volume and bounded pipes',
            'mountArtifacts': artifacts, 'avdBoot': 'NOT RUN', 'adb': 'NOT RUN',
            'freshSeedProducer': 'NOT RUN', 'nativeAdmissionEnabled': False}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exec-version', type=pathlib.Path, required=True)
    parser.add_argument('--sdk-root', type=pathlib.Path, required=True)
    parser.add_argument('--closed-fd', type=int, required=True)
    args = parser.parse_args()
    android = pathlib.Path(__file__).resolve().parent
    root = fixture.owned_root(args.exec_version, android)
    exec_version(root, args.sdk_root, args.closed_fd)


if __name__ == '__main__':
    main()
