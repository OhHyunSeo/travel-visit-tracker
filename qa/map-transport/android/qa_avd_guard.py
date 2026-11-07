"""Fail closed unless an emulator uses a dedicated workspace-owned QA AVD.

The marker is a preparation record, not proof of the contents of an old disk.
It must be created before first boot by a verified fresh-AVD preparation step.
No emulator is started. An already running adb server is required; the caller
must own its lifecycle for the duration of validation.
"""
from __future__ import annotations

import hashlib
import json
import os
import pathlib
import re
import shlex
import shutil
import subprocess
import struct


QA_NAME = re.compile(r'TripPaintingMapTransportQA_[a-f0-9]{12}')
MARKER = '.trip-painting-map-qa.json'
CLAIM = '.validation-claimed.json'
MAX_INCREMENTAL_BYTES = 1_073_741_824


class AvdGuardError(RuntimeError):
    pass


def _inside(path: pathlib.Path, parent: pathlib.Path) -> bool:
    return path.resolve().is_relative_to(parent.resolve())


def _no_links(path: pathlib.Path, stop: pathlib.Path) -> None:
    current = path
    while current != stop:
        if current.is_symlink():
            raise AvdGuardError('QA AVD paths must not contain symlinks')
        if current.parent == current:
            raise AvdGuardError('QA AVD is outside its owner directory')
        current = current.parent


def _config(path: pathlib.Path) -> dict[str, str]:
    values = {}
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        key, separator, value = line.partition('=')
        key, value = key.strip(), value.strip()
        if not separator or key in values:
            raise AvdGuardError('QA config has malformed or duplicate entries')
        values[key] = value
    return values



def _check_storage(avd_dir: pathlib.Path, system_image: pathlib.Path) -> None:
    # Defaults such as userdata-qemu.img can bypass config path keys.
    for index, path in enumerate(avd_dir.rglob('*')):
        if index >= 512 or path.is_symlink():
            raise AvdGuardError('QA storage is unbounded or contains a symlink')
        if not path.is_file():
            continue
        if path.stat().st_nlink != 1:
            raise AvdGuardError('Hardlinked QA files could modify another AVD')
        with path.open('rb') as source:
            header = source.read(20)
            if header[:4] != b'QFI\xfb':
                continue
            if len(header) != 20:
                raise AvdGuardError('Invalid QCOW2 header')
            offset, size = struct.unpack('>QI', header[8:20])
            if not offset and not size:
                continue
            if not offset or not 0 < size <= 4096 or offset > 1_048_576 or offset + size > path.stat().st_size:
                raise AvdGuardError('Unbounded or malformed QCOW2 backing reference')
            source.seek(offset)
            try:
                name = source.read(size).decode('utf-8')
            except UnicodeError as error:
                raise AvdGuardError('Invalid QCOW2 backing filename') from error
            if ':' in name or '\x00' in name:
                raise AvdGuardError('QCOW2 backing protocols are not allowed')
            backing = pathlib.Path(name)
            if not backing.is_absolute():
                backing = path.parent / backing
            if not backing.is_file() or not (_inside(backing, avd_dir) or _inside(backing, system_image)):
                raise AvdGuardError('QCOW2 backing data is outside QA storage or the cached SDK image')


def read_prepared_avd(avd_dir: pathlib.Path, android_root: pathlib.Path,
                      sdk_root: pathlib.Path) -> dict:
    """Validate only local preparation records. Never inspect a personal AVD."""
    avd_dir = pathlib.Path(avd_dir).absolute()
    android_root = pathlib.Path(android_root).resolve()
    owned_root = android_root / '.build' / 'avd'
    if avd_dir.parent != owned_root or not _inside(avd_dir, android_root):
        raise AvdGuardError('A QA AVD must be directly inside this tool\'s .build/avd')
    _no_links(avd_dir, android_root)
    if not avd_dir.is_dir():
        raise AvdGuardError('A fresh dedicated QA AVD has not been prepared')
    if not QA_NAME.fullmatch(avd_dir.name.removesuffix('.avd')) or not avd_dir.name.endswith('.avd'):
        raise AvdGuardError('A personal or generic AVD name is not allowed')
    marker_path = avd_dir / MARKER
    config_path = avd_dir / 'config.ini'
    if marker_path.is_symlink() or config_path.is_symlink():
        raise AvdGuardError('QA marker and config must be regular owned files')
    try:
        if marker_path.stat().st_size > 16_384 or config_path.stat().st_size > 65_536:
            raise AvdGuardError('QA preparation records exceed their bound')
        marker = json.loads(marker_path.read_text())
        config_bytes = config_path.read_bytes()
    except (OSError, ValueError) as error:
        raise AvdGuardError('Missing or invalid fresh QA preparation records') from error
    if not isinstance(marker, dict):
        raise AvdGuardError('Invalid QA marker shape')
    expected = {
        'schema': 1,
        'purpose': 'trip-painting-map-transport-qa',
        'name': avd_dir.name.removesuffix('.avd'),
        'path': str(avd_dir.resolve()),
        'source': 'fresh-cached-sdk-system-image',
        'configSha256': hashlib.sha256(config_bytes).hexdigest(),
        'readyForFirstValidation': True,
    }
    if any(type(marker.get(key)) is not type(value) or marker[key] != value
           for key, value in expected.items()):
        raise AvdGuardError('QA marker does not match this fresh AVD/config')
    bound = marker.get('verifiedIncrementalBoundBytes')
    if type(bound) is not int or not 0 < bound <= MAX_INCREMENTAL_BYTES:
        raise AvdGuardError('A conservative fresh-QA allocation bound is required')
    if (avd_dir / CLAIM).exists() or (avd_dir / CLAIM).is_symlink():
        raise AvdGuardError('This QA AVD has already been claimed; prepare a fresh one')
    values = _config(config_path)
    if values.get('AvdId') != expected['name']:
        raise AvdGuardError('QA config identity differs from its marker')
    system_image = pathlib.Path(values.get('image.sysdir.1', ''))
    if not system_image.is_absolute() or not system_image.is_dir() or not _inside(system_image, sdk_root / 'system-images'):
        raise AvdGuardError('QA system image must be an existing cached SDK system image')
    for key, value in values.items():
        if key == 'image.sysdir.1' or not value:
            continue
        if 'path' in key.lower() or key.endswith('.file'):
            candidate = pathlib.Path(value)
            if not candidate.is_absolute() or not _inside(candidate, avd_dir):
                raise AvdGuardError('QA config refers to a path outside its owned AVD')
    _check_storage(avd_dir, system_image)
    return {**expected, 'verifiedIncrementalBoundBytes': bound,
            'systemImage': str(system_image.resolve())}


def validate_process_args(argv: list[str], prepared: dict,
                          sdk_root: pathlib.Path, console_port: int) -> None:
    """Tie the live process to the owned data path, not merely a guest name."""
    sdk_root = sdk_root.resolve()
    executables = [sdk_root / 'emulator' / 'emulator',
                   sdk_root / 'emulator' / 'qemu' / 'darwin-aarch64' / 'qemu-system-aarch64',
                   sdk_root / 'emulator' / 'qemu' / 'darwin-x86_64' / 'qemu-system-x86_64',
                   sdk_root / 'emulator' / 'qemu' / 'linux-x86_64' / 'qemu-system-x86_64']
    if not argv or pathlib.Path(argv[0]).resolve() not in [p.resolve() for p in executables]:
        raise AvdGuardError('The console listener is not the cached SDK emulator')
    flags = {'-no-snapshot', '-no-snapshot-load', '-no-snapshot-save',
             '-read-only', '-no-window', '-no-audio', '-no-boot-anim',
             '-no-metrics', '-verbose'}
    values = {'-avd', '-datadir', '-port', '-sysdir', '-data', '-cache',
              '-sdcard', '-memory', '-cores', '-gpu', '-accel',
              '-netdelay', '-netspeed'}
    index = 1
    while index < len(argv):
        flag = argv[index]
        if flag in flags:
            index += 1
        elif flag in values and index + 1 < len(argv) and not argv[index + 1].startswith('-'):
            index += 2
        else:
            raise AvdGuardError('Unknown or raw emulator options are not allowed')

    def option(name):
        if argv.count(name) != 1:
            raise AvdGuardError('Required emulator options must appear exactly once')
        index = argv.index(name)
        if index + 1 >= len(argv) or argv[index + 1].startswith('-'):
            raise AvdGuardError('Incomplete emulator option')
        return argv[index + 1]

    if option('-avd') != prepared['name']:
        raise AvdGuardError('Live emulator name differs from the prepared QA AVD')
    if pathlib.Path(option('-datadir')).resolve() != pathlib.Path(prepared['path']):
        raise AvdGuardError('Live emulator uses another data directory')
    if option('-port') != str(console_port) or '-no-snapshot' not in argv:
        raise AvdGuardError('An explicit matching port and no-snapshot mode are required')
    for name in ['-data', '-cache', '-sdcard']:
        if name in argv:
            candidate = pathlib.Path(option(name))
            if not candidate.is_absolute() or not _inside(candidate, pathlib.Path(prepared['path'])):
                raise AvdGuardError('Live emulator storage points outside the owned QA AVD')
    if '-sysdir' in argv and pathlib.Path(option('-sysdir')).resolve() != pathlib.Path(prepared['systemImage']):
        raise AvdGuardError('Live emulator system image differs from QA preparation')


def _read_command(parts: list[str]) -> str:
    result = subprocess.run(parts, capture_output=True, text=True, timeout=10)
    if result.returncode:
        raise AvdGuardError('Read-only emulator identity inspection failed')
    return result.stdout.strip()


def inspect_owned_emulator(serial: str, avd_dir: pathlib.Path,
                           android_root: pathlib.Path, sdk_root: pathlib.Path,
                           adb: pathlib.Path) -> dict:
    match = re.fullmatch(r'emulator-(\d{4,5})', serial)
    if not match or not 1024 <= int(match[1]) <= 65534 or int(match[1]) % 2:
        raise AvdGuardError('A valid emulator console serial is required')
    prepared = read_prepared_avd(avd_dir, android_root, sdk_root)
    lsof = shutil.which('lsof')
    ps = shutil.which('ps')
    if not lsof or not ps:
        raise AvdGuardError('Host process inspection tools are unavailable; refusing a guess')
    port = int(match[1])
    owners = []
    for value in [port, port + 1]:
        text = _read_command([lsof, '-nP', '-t', '-iTCP:' + str(value), '-sTCP:LISTEN'])
        ids = set(text.splitlines())
        if len(ids) != 1 or not next(iter(ids)).isdigit():
            raise AvdGuardError('Could not identify a unique emulator listener')
        owners.append(next(iter(ids)))
    if owners[0] != owners[1]:
        raise AvdGuardError('Console and adb listeners have different owners')
    argv = shlex.split(_read_command([ps, '-p', owners[0], '-o', 'command=']))
    validate_process_args(argv, prepared, sdk_root, port)
    host_start = _read_command([ps, '-p', owners[0], '-o', 'lstart='])
    # Refuse before invoking adb if the pre-existing server is unavailable.
    server = _read_command([lsof, '-nP', '-t', '-iTCP:5037', '-sTCP:LISTEN']).splitlines()
    if len(set(server)) != 1 or not server[0].isdigit():
        raise AvdGuardError('A stable, already running adb server is required')
    server_start = _read_command([ps, '-p', server[0], '-o', 'lstart='])
    transport = _read_command([str(adb), '-s', serial, 'get-transport-id'])
    if not transport.isdigit() or int(transport) < 1:
        raise AvdGuardError('A pinned adb transport ID is unavailable')
    # All subsequent adb calls select this transport, never a re-used serial.
    guest_name = _read_command([str(adb), '-t', transport, 'emu', 'avd', 'name']).splitlines()
    if guest_name != [prepared['name'], 'OK']:
        raise AvdGuardError('Guest AVD identity does not match the verified host process')
    return {**prepared, 'serial': serial, 'hostPid': int(owners[0]),
            'hostStarted': host_start, 'adbServerPid': int(server[0]),
            'adbServerStarted': server_start, 'transportId': int(transport),
            'ownership': 'workspace-path/marker/config/host-process/guest-name verified'}


def verify_pinned_transport(prepared: dict, sdk_root: pathlib.Path) -> None:
    # Repeat host identity checks before each adb action; a restart is a failure.
    lsof, ps = shutil.which('lsof'), shutil.which('ps')
    if not lsof or not ps:
        raise AvdGuardError('Pinned host inspection is unavailable')
    port = int(prepared['serial'].removeprefix('emulator-'))
    for value, expected in [(port, prepared['hostPid']),
                            (port + 1, prepared['hostPid']),
                            (5037, prepared['adbServerPid'])]:
        owners = _read_command([lsof, '-nP', '-t', '-iTCP:' + str(value), '-sTCP:LISTEN'])
        if set(owners.splitlines()) != {str(expected)}:
            raise AvdGuardError('The verified emulator or adb server changed')
    for pid, started in [(prepared['hostPid'], prepared['hostStarted']),
                         (prepared['adbServerPid'], prepared['adbServerStarted'])]:
        if _read_command([ps, '-p', str(pid), '-o', 'lstart=']) != started:
            raise AvdGuardError('A pinned process restarted or its PID was reused')
    argv = shlex.split(_read_command([ps, '-p', str(prepared['hostPid']), '-o', 'command=']))
    validate_process_args(argv, prepared, sdk_root, port)
    avd_dir = pathlib.Path(prepared['path'])
    _no_links(avd_dir, avd_dir.parent.parent.parent)
    if hashlib.sha256((avd_dir / 'config.ini').read_bytes()).hexdigest() != prepared['configSha256']:
        raise AvdGuardError('The verified AVD configuration changed')
    _check_storage(avd_dir, pathlib.Path(prepared['systemImage']))


def claim_first_validation(prepared: dict, run_id: str) -> None:
    """Create one owned journal before the first app mutation; never reuse it."""
    path = pathlib.Path(prepared['path']) / CLAIM
    payload = json.dumps({'runId': run_id, 'name': prepared['name'],
                          'configSha256': prepared['configSha256']}, sort_keys=True).encode()
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except OSError as error:
        raise AvdGuardError('QA AVD was already claimed or its journal is unavailable') from error
    try:
        with os.fdopen(descriptor, 'wb') as target:
            target.write(payload)
            target.flush()
            os.fsync(target.fileno())
    except OSError as error:
        # Retain even a partial claim rather than making a failed attempt reusable.
        raise AvdGuardError('QA ownership journal could not be persisted') from error
