"""Check the cached Android SDK formatter on one disposable 8 MiB image."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import struct
import sys
import tempfile

from single_writer_component import ComponentError, _capture


IMAGE_BYTES = 8 * 1024 * 1024
BLOCK_BYTES = 4096
FORMATTER_SHA256 = 'e2b6ebdad12b13c0809ba0ba70cce2a880ed6d51e5c1610c447a9e07afc4a50c'
CHECKER_SHA256 = 'f1ea5f09075458a8d49604deedd4939bcd07eed5deb324618b1a2a6a71ec6859'
LABEL = b'trip-fixture'
CANARY = b'trip-painting-outside-formatter-canary\n'
READ_PROFILE = '''(version 1)
(deny default)
(allow file-read* file-map-executable)
(deny file-read* (subpath (param "PRIVATE_AVD")))
(allow process-exec (literal (param "EXT4_TOOL")))
(allow sysctl-read)
'''
FORMAT_PROFILE = READ_PROFILE + '(allow file-write-data (literal (param "QA_IMAGE")))\n'
LAUNCH = '''
import os, resource, sys
cap = int(sys.argv[1])
resource.setrlimit(resource.RLIMIT_FSIZE, (cap, cap))
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
os.execv(sys.argv[2], sys.argv[2:])
'''


def verify_sdk_tool(sdk_root: Path, name: str, expected_hash: str) -> Path:
    tool = sdk_root.resolve(strict=True) / 'emulator/bin64' / name
    if tool != tool.resolve(strict=True) or not tool.is_file() or not os.access(tool, os.X_OK):
        raise ComponentError('Expected a regular executable from the cached Android SDK')
    with tool.open('rb') as source:
        body = source.read(1024**2 + 1)
    if len(body) > 1024**2 or hashlib.sha256(body).hexdigest() != expected_hash:
        raise ComponentError(f'Cached {name} hash differs')
    return tool


def inspect_image(image: Path, original: os.stat_result) -> dict:
    descriptor = os.open(image, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'rb') as source:
        current = os.fstat(source.fileno())
        if not stat.S_ISREG(current.st_mode) or current.st_nlink != 1 or image.is_symlink() or (
            current.st_dev, current.st_ino, current.st_size
        ) != (original.st_dev, original.st_ino, IMAGE_BYTES):
            raise ComponentError('Formatter changed the image identity or size')
        if current.st_blocks * 512 > IMAGE_BYTES:
            raise ComponentError('Formatted image allocation exceeds the component size')
        source.seek(1024)
        superblock = source.read(1024)

    if len(superblock) != 1024 or struct.unpack_from('<H', superblock, 56)[0] != 0xEF53:
        raise ComponentError('Missing ext4 superblock')
    block_count = struct.unpack_from('<I', superblock, 4)[0]
    log_block_size = struct.unpack_from('<I', superblock, 24)[0]
    label = superblock[120:136].split(b'\0', 1)[0]
    blocks_high = struct.unpack_from('<I', superblock, 0x150)[0]
    if (block_count, blocks_high, log_block_size, label) != (IMAGE_BYTES // BLOCK_BYTES, 0, 2, LABEL):
        raise ComponentError('Ext4 superblock does not match the fixture layout')
    return {'blocks': block_count, 'blockBytes': BLOCK_BYTES, 'logicalBytes': current.st_size,
            'allocatedBytes': current.st_blocks * 512}


def formatter_argv(tool: Path, image: Path, *, target: Path | None = None, blocks: int = IMAGE_BYTES // BLOCK_BYTES) -> list[str]:
    # Only the internal negative probes vary target or block count.
    return [sys.executable, '-I', '-S', '-B', '-c', LAUNCH, str(IMAGE_BYTES), '/usr/bin/sandbox-exec',
            '-D', 'QA_IMAGE=' + str(image), '-D', 'EXT4_TOOL=' + str(tool),
            '-D', 'PRIVATE_AVD=' + str(Path.home() / '.android'), '-p', FORMAT_PROFILE, str(tool),
            '-q', '-F', '-b', str(BLOCK_BYTES), '-E', 'nodiscard', '-L', LABEL.decode('ascii'),
            str(target if target is not None else image), str(blocks)]


def check_integrity(tool: Path, image: Path, root: Path, environment: dict, *, corrupted: bool = False) -> None:
    argv = [sys.executable, '-I', '-S', '-B', '-c', LAUNCH, '0', '/usr/bin/sandbox-exec',
            '-D', 'EXT4_TOOL=' + str(tool), '-D', 'PRIVATE_AVD=' + str(Path.home() / '.android'),
            '-p', READ_PROFILE, str(tool), '-fn', str(image)]
    with image.open('rb') as source:
        digest = hashlib.file_digest(source, 'sha256').digest()
    if corrupted:
        expect_refusal(argv, root, environment, 'Bad magic number')
    else:
        _capture(argv, cwd=root, env=environment)
    with image.open('rb') as source:
        if hashlib.file_digest(source, 'sha256').digest() != digest:
            raise ComponentError('Read-only ext4 check changed the image bytes')


def corrupt_superblock_magic(image: Path) -> None:
    # This fixed 2,048-block image has only one block group and no backup
    # superblock. Change just the primary superblock's magic field.
    with image.open('r+b') as output:
        output.seek(1024 + 56)
        output.write(bytes(2))
        output.flush()
        os.fsync(output.fileno())


def expect_refusal(argv: list[str], root: Path, environment: dict, message: str) -> None:
    try:
        _capture(argv, cwd=root, env=environment)
    except ComponentError as error:
        if str(error).startswith('Component command failed:') and message.lower() in str(error).lower():
            return
        raise
    raise ComponentError('SDK ext4 tool unexpectedly accepted a negative probe')


def run(sdk_root: Path) -> dict:
    if sys.platform != 'darwin':
        raise ComponentError('The cached formatter component requires macOS')
    tool = verify_sdk_tool(sdk_root, 'mkfs.ext4', FORMATTER_SHA256)
    checker = verify_sdk_tool(sdk_root, 'fsck.ext4', CHECKER_SHA256)
    with tempfile.TemporaryDirectory(prefix='trip-ext4-component.') as temporary:
        root = Path(temporary).resolve(strict=True)
        image = root / 'fixture.ext4'
        canary = root / 'outside-canary'
        canary.write_bytes(CANARY)
        chunk = bytes(65_536)
        with os.fdopen(os.open(image, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as output:
            for _ in range(IMAGE_BYTES // len(chunk)):
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        before = image.stat()
        environment = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'TMPDIR': str(root), 'MKE2FS_CONFIG': '/dev/null'}
        expect_refusal(formatter_argv(tool, image, target=canary), root, environment, 'Operation not permitted')
        if canary.read_bytes() != CANARY:
            raise ComponentError('Formatter changed the outside canary')
        _capture(formatter_argv(tool, image), cwd=root, env=environment)
        if set(root.iterdir()) != {image, canary}:
            raise ComponentError('Formatter created files beyond the fixture image')
        layout = inspect_image(image, before)
        check_integrity(checker, image, root, environment)
        corrupt_superblock_magic(image)
        check_integrity(checker, image, root, environment, corrupted=True)
        _capture(formatter_argv(tool, image), cwd=root, env=environment)
        inspect_image(image, before)
        expect_refusal(formatter_argv(tool, image, blocks=IMAGE_BYTES // BLOCK_BYTES + 1), root, environment, 'short write')
        after = image.stat()
        if (after.st_dev, after.st_ino, after.st_nlink, after.st_size, after.st_blocks) != (
            before.st_dev, before.st_ino, 1, IMAGE_BYTES, layout['allocatedBytes'] // 512
        ) or canary.read_bytes() != CANARY or set(root.iterdir()) != {image, canary}:
            raise ComponentError('Oversized format changed file identity, size, allocation or outside contents')
    return {'formatterSha256': FORMATTER_SHA256, 'checkerSha256': CHECKER_SHA256, 'image': layout,
            'readOnlyIntegrityPassed': True, 'corruptImageDetected': True, 'ownedFixtureRemoved': True,
            'outsideWriteDenied': True, 'oversizedFormatDenied': True, 'nativeAdmissionEnabled': False}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--sdk-root', type=Path, required=True)
    args = parser.parse_args()
    try:
        result = run(args.sdk_root)
    except (ComponentError, OSError) as error:
        parser.exit(1, f'Ext4 component failed: {error}\n')
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
