"""Bounded direct ADB queries for the cold boot component's own emulator."""

from hashlib import sha256
import re
import shlex
import socket
import struct
import subprocess
import sys
import time
from pathlib import Path


ADB_PORT = 5561
PACKET = struct.Struct('<4sIIIII')
PAYLOAD_LIMIT = 4096
FIXTURE_APK_SHA256 = '24dc68cfb9d213e2da83afbe297577f7d73bc408cf0484589b7711ab9334e60f'
FIXTURE_APK_SIZE = 19_438_330


def receive_exact(connection, length):
    data = bytearray()
    while len(data) < length:
        chunk = connection.recv(length - len(data))
        if not chunk:
            raise EOFError('Guest ADB connection closed')
        data.extend(chunk)
    return bytes(data)


def receive(connection):
    header = receive_exact(connection, PACKET.size)
    command, first, second, length, checksum, magic = PACKET.unpack(header)
    if length > PAYLOAD_LIMIT or magic != int.from_bytes(command, 'little') ^ 0xFFFFFFFF:
        raise ValueError('Invalid guest ADB header')
    payload = receive_exact(connection, length)
    if sum(payload) != checksum:
        raise ValueError('Invalid guest ADB payload checksum')
    return command, first, second, payload


def send(connection, command, first, second, payload=b''):
    magic = int.from_bytes(command, 'little') ^ 0xFFFFFFFF
    header = PACKET.pack(command, first, second, len(payload), sum(payload), magic)
    connection.sendall(header + payload)


def authenticate(connection, key):
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding, utils

    send(connection, b'CNXN', 0x01000000, PAYLOAD_LIMIT, b'host::\0')
    command, first, second, token = receive(connection)
    if (command, first, second, len(token)) != (b'AUTH', 1, 0, 20):
        raise ValueError('Guest ADB did not request authentication')
    signature = key.sign(token, padding.PKCS1v15(), utils.Prehashed(hashes.SHA1()))
    send(connection, b'AUTH', 2, 0, signature)
    command, version, capacity, identity = receive(connection)
    if command != b'CNXN' or version < 0x01000000 or not capacity or not identity.startswith(b'device::'):
        raise ValueError('Guest ADB rejected the disposable key')


def require_owned_listener(key_path):
    owners = subprocess.run(
        ['/usr/sbin/lsof', '-nP', '-a', f'-iTCP:{ADB_PORT}', '-sTCP:LISTEN', '-Fp'],
        capture_output=True, check=False, text=True, timeout=5,
    )
    listeners = {line for line in owners.stdout.splitlines() if line.startswith('p')}
    listener = re.fullmatch(r'p([1-9][0-9]*)', next(iter(listeners), ''))
    if owners.returncode or len(listeners) != 1 or not listener:
        raise ValueError('No unique local guest ADB listener')
    files = subprocess.run(
        ['/usr/sbin/lsof', '-nP', '-p', listener[1], '-Fn'],
        capture_output=True, check=False, text=True, timeout=5,
    )
    owned = key_path.parent.parent.resolve(strict=True)
    for line in files.stdout.splitlines():
        if line.startswith('n/'):
            path = Path(line[1:])
            if path.name.startswith('userdata-qemu.img') and path.is_relative_to(owned):
                return
    raise ValueError('Listener does not have the owned emulator disk open')


def load_key(key_path):
    from cryptography.hazmat.primitives.serialization import load_pem_private_key

    if key_path.is_symlink() or not key_path.is_file() or key_path.stat().st_size > 4096:
        raise ValueError('Expected the private key generated in the disposable volume')
    return load_pem_private_key(key_path.read_bytes(), password=None)


def open_stream(connection, service):
    send(connection, b'OPEN', 1, 0, service + b'\0')
    command, remote, local, payload = receive(connection)
    if (command, local, payload) != (b'OKAY', 1, b'') or not remote:
        raise ValueError('Guest ADB did not open the requested stream')
    return remote


def stream_output(connection, remote, limit, deadline):
    output = bytearray()
    while time.monotonic() < deadline:
        command, source, target, payload = receive(connection)
        if (source, target) != (remote, 1):
            raise ValueError('Unexpected guest ADB stream ID')
        if command == b'CLSE' and not payload:
            return bytes(output)
        if command != b'WRTE' or len(output) + len(payload) > limit:
            raise ValueError('Unexpected or excessive guest ADB output')
        output.extend(payload)
        send(connection, b'OKAY', 1, remote)
    raise ValueError('Guest ADB stream did not close in time')


def query_boot_property(key_path):
    require_owned_listener(key_path)
    key = load_key(key_path)
    with socket.create_connection(('127.0.0.1', ADB_PORT), timeout=5) as connection:
        try:
            authenticate(connection, key)
        except TimeoutError as error:
            raise ValueError('Guest ADB authentication timed out') from error
        remote = open_stream(connection, b'shell:getprop sys.boot_completed')
        return stream_output(connection, remote, 32, time.monotonic() + 10).strip() == b'1'


def install_fixture(key_path, apk):
    # Reuse the smoke suite's checks for exact package identity and installed bytes.
    sys.path.append(str(Path(__file__).with_name('sdk-smoke')))
    from capture_device import check_installed_apk
    from device_preflight import check_fresh_device

    if apk.is_symlink() or not apk.is_file() or apk.stat().st_size != FIXTURE_APK_SIZE:
        raise ValueError('Expected the pinned fixture APK size')
    data = apk.read_bytes()
    if len(data) != FIXTURE_APK_SIZE or sha256(data).hexdigest() != FIXTURE_APK_SHA256:
        raise ValueError('Fixture APK hash changed')
    key = load_key(key_path)

    def command(limit, mode, *args):
        if mode != 'shell':
            raise ValueError('The install check uses shell queries only')
        require_owned_listener(key_path)
        with socket.create_connection(('127.0.0.1', ADB_PORT), timeout=5) as connection:
            authenticate(connection, key)
            remote = open_stream(connection, ('shell:' + shlex.join(args)).encode('ascii'))
            return stream_output(connection, remote, limit, time.monotonic() + 10)

    device = check_fresh_device(command)
    require_owned_listener(key_path)
    with socket.create_connection(('127.0.0.1', ADB_PORT), timeout=7) as connection:
        authenticate(connection, key)
        remote = open_stream(connection, f'exec:cmd package install -t -S {len(data)}'.encode('ascii'))
        deadline = time.monotonic() + 90
        for start in range(0, len(data), PAYLOAD_LIMIT):
            if time.monotonic() >= deadline:
                raise ValueError('Fixture APK streaming deadline expired')
            send(connection, b'WRTE', 1, remote, data[start:start + PAYLOAD_LIMIT])
            if receive(connection) != (b'OKAY', remote, 1, b''):
                raise ValueError('Guest did not acknowledge the fixture APK stream')
        connection.settimeout(45)
        if stream_output(connection, remote, 4096, time.monotonic() + 45).strip() != b'Success':
            raise ValueError('Guest package manager did not accept the fixture APK')
    check_installed_apk(command, FIXTURE_APK_SHA256)
    return {**device, 'installedApkSha256': FIXTURE_APK_SHA256}
