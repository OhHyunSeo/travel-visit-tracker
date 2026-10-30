#!/usr/bin/env python3
"""Read-only fresh-AVD storage preflight; never create an executable marker.

A small fixed-capacity filesystem is a candidate, not a measured bound on all
Mac writes. This module intentionally has no create, mount, launch or override
option. The launch backend remains unavailable until the missing enforcement
and boot requirements have been implemented and independently checked.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import stat


MAX_INCREMENTAL_BYTES = 1_073_741_824
CANDIDATE_VOLUME_BYTES = 805_306_368  # 768 MiB, including its filesystem.
MIN_REMAINING_HEADROOM_BYTES = 4_294_967_296
MAX_METADATA_BYTES = 65_536
IMAGE_FILES = ('system.img', 'vendor.img', 'kernel-ranchu', 'ramdisk.img',
               'encryptionkey.img', 'userdata.img')


class BoundedStorageError(RuntimeError):
    pass


def _no_symlinks(path: pathlib.Path, stop: pathlib.Path) -> None:
    current = path
    while True:
        if current.is_symlink():
            raise BoundedStorageError('Cached SDK paths must not contain symlinks')
        if current == stop:
            return
        if current.parent == current:
            raise BoundedStorageError('System image is outside the cached SDK')
        current = current.parent


def _regular_file(path: pathlib.Path) -> os.stat_result | None:
    try:
        value = path.lstat()
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(value.st_mode):
        raise BoundedStorageError('Cached image entries must be regular files')
    return value


def _bounded_metadata(path: pathlib.Path, expected: os.stat_result) -> bytes:
    # Do not follow a symlink or block on a FIFO swapped in after lstat.
    if not hasattr(os, 'O_NOFOLLOW') or not hasattr(os, 'O_NONBLOCK'):
        raise BoundedStorageError('Safe non-following metadata reads are unavailable')
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError as error:
        raise BoundedStorageError('Cached SDK metadata changed before safe open') from error
    try:
        actual = os.fstat(descriptor)
        if (not stat.S_ISREG(actual.st_mode) or actual.st_nlink != 1
                or (actual.st_dev, actual.st_ino) != (expected.st_dev, expected.st_ino)):
            raise BoundedStorageError('Cached SDK metadata changed identity or file type')
        if not 0 < actual.st_size <= MAX_METADATA_BYTES:
            raise BoundedStorageError('Cached SDK metadata changed beyond its read bound')
        # Linux can reuse an unlinked inode immediately. Device/inode alone is
        # not evidence that this is the file inspected before open().
        stamp = lambda value: (value.st_size, value.st_mtime_ns, value.st_ctime_ns)
        if stamp(actual) != stamp(expected):
            raise BoundedStorageError('Cached SDK metadata changed since inspection')
        with os.fdopen(descriptor, 'rb', closefd=False) as source:
            body = source.read(MAX_METADATA_BYTES + 1)
        if len(body) > MAX_METADATA_BYTES:
            raise BoundedStorageError('Cached SDK metadata changed beyond its read bound')
        if stamp(os.fstat(descriptor)) != stamp(actual):
            raise BoundedStorageError('Cached SDK metadata changed while reading')
        return body
    finally:
        os.close(descriptor)


def build_preparation_plan(android_root: pathlib.Path, sdk_root: pathlib.Path,
                           system_image: pathlib.Path) -> dict:
    """Inspect cached SDK metadata and free space, without tools or writes.

    Image bodies are not read or copied. Missing factory userdata is reported
    as unverified initialization, not proof that a new AVD cannot boot.
    """
    android_root = pathlib.Path(android_root).absolute()
    sdk_root = pathlib.Path(sdk_root).absolute()
    system_image = pathlib.Path(system_image).absolute()
    image_root = sdk_root / 'system-images'
    if '..' in system_image.parts or not system_image.resolve().is_relative_to(image_root.resolve()):
        raise BoundedStorageError('Use only an existing cached SDK system image')
    _no_symlinks(system_image, sdk_root)
    if not android_root.is_dir() or not system_image.is_dir():
        raise BoundedStorageError('Workspace and cached SDK image must already exist')
    available = os.statvfs(android_root)
    free_bytes = available.f_bavail * available.f_frsize
    entries = {}
    for name in IMAGE_FILES:
        value = _regular_file(system_image / name)
        entries[name] = (None if value is None else {
            'logicalBytes': value.st_size,
            'allocatedBytes': value.st_blocks * 512,
            'bodyReadOrCopied': False,
        })
    metadata = {}
    for name in ('source.properties', 'package.xml'):
        path = system_image / name
        value = _regular_file(path)
        if value is None or not 0 < value.st_size <= MAX_METADATA_BYTES:
            raise BoundedStorageError('Cached SDK metadata is missing or exceeds its read bound')
        body = _bounded_metadata(path, value)
        metadata[name] = {'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()}
    missing = [name for name in ('system.img', 'kernel-ranchu', 'ramdisk.img')
               if entries[name] is None or not entries[name]['logicalBytes']]
    blockers = [
        {'code': 'NO_VERIFIED_WRITE_CONFINEMENT',
         'detail': 'No tested launcher confines emulator/QEMU/ADB temp, output, inherited writable descriptors and all child writes to a fixed-capacity filesystem.'},
        {'code': 'NO_FIXED_CAPACITY_VOLUME',
         'detail': 'No owned fixed RAW/HFS volume has been created, mounted or independently checked; a marker number is not enforcement.'},
        {'code': 'FIRST_BOOT_SPACE_UNVERIFIED',
         'detail': 'Fresh cached-image initialization and boot inside the candidate capacity have not been tested; no personal AVD may be used as a seed.'},
    ]
    if missing:
        blockers.append({'code': 'CACHED_BOOT_INPUT_MISSING', 'files': missing})
    if entries['userdata.img'] is None:
        blockers.append({'code': 'FACTORY_USERDATA_PRODUCER_UNVERIFIED',
                         'detail': 'Cached userdata.img is absent; a fresh initialization producer is needed and has not been validated.'})
    if free_bytes < MAX_INCREMENTAL_BYTES + MIN_REMAINING_HEADROOM_BYTES:
        blockers.append({'code': 'INSUFFICIENT_CONSERVATIVE_HEADROOM',
                         'detail': 'Leave at least 4GiB after the full 1GiB candidate allowance.'})
    return {
        'schema': 1,
        'purpose': 'read-only-fresh-qa-storage-preflight',
        'status': 'BLOCKED',
        'nativeLaunchAllowed': False,
        'preparationMarkerIssued': False,
        'workspaceFreeBytes': free_bytes,
        'cachedSdkMetadata': metadata,
        'cachedImageFiles': entries,
        'candidateOnly': {
            'format': 'fixed RAW image with HFS filesystem; no sparse growth',
            'volumeBytesIncludingFilesystem': CANDIDATE_VOLUME_BYTES,
            'allowanceRemainingBytes': MAX_INCREMENTAL_BYTES - CANDIDATE_VOLUME_BYTES,
            'scope': 'candidate bound for owned writable files, not total host allocation',
            'allWritesConfined': False,
            'allocationVerified': False,
        },
        'blockers': blockers,
        'limitations': ['The <=1GiB target concerns owned QA writable files. '
                        'It is not a whole-Mac growth guarantee for host swap, '
                        'system logging, APFS snapshots or unrelated processes.'],
        'sideEffects': {'imageCreation': False, 'mountOrDetach': False,
                        'emulatorOrAdb': False, 'sdkOrOriginalWrites': False},
    }


def require_bounded_launch() -> None:
    """Refuse all native launches until an enforced storage backend exists.

    Deliberately accept no marker, command-line override or environment flag.
    Future implementation needs real fixed-capacity storage AND independently
    tested write confinement; a declaration in an AVD cannot enable this path.
    """
    raise BoundedStorageError(
        'Native validation is blocked: independently enforced <=1GiB fresh-QA '
        'storage and write confinement are not implemented. Run '
        'bounded_avd_storage.py for the read-only preparation blockers; '
        'verifiedIncrementalBoundBytes alone cannot authorize a run.')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sdk-root', type=pathlib.Path,
                        default=pathlib.Path(os.environ.get('ANDROID_HOME',
                            pathlib.Path.home() / 'Library/Android/sdk')))
    parser.add_argument('--system-image', type=pathlib.Path,
                        help='An existing cached SDK image; never a personal AVD')
    args = parser.parse_args()
    image = args.system_image or (args.sdk_root / 'system-images/android-37.0/google_apis_playstore/arm64-v8a')
    try:
        result = build_preparation_plan(pathlib.Path(__file__).resolve().parent,
                                        args.sdk_root, image)
    except (OSError, BoundedStorageError) as error:
        result = {'status': 'BLOCKED', 'nativeLaunchAllowed': False,
                  'preparationMarkerIssued': False, 'error': str(error)}
    print(json.dumps(result, indent=2, sort_keys=True))
    return 2  # A diagnostic result must never be mistaken for ready-to-launch.


if __name__ == '__main__':
    raise SystemExit(main())
