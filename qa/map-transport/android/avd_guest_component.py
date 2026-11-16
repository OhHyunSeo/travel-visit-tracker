"""Bounded direct ADB queries for the cold boot component's own emulator."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import errno
from hashlib import sha256
from pathlib import Path
import re
import shlex
import socket
import struct
import subprocess
import sys
import time


ADB_PORT = 5561
PACKET = struct.Struct('<4sIIIII')
PAYLOAD_LIMIT = 4096
FIXTURE_APK_SHA256 = '24dc68cfb9d213e2da83afbe297577f7d73bc408cf0484589b7711ab9334e60f'
FIXTURE_APK_SIZE = 19_438_330
FIXTURE_RELAY_PATH = '/data/local/tmp/trip-map-transport-relay.jar'
FIXTURE_RELAY_SHA256 = 'b01869854c2fdc4905c7b28af95af2da7f0c6ca39088e011d7ec4ece63516968'
RASTER_RELAY_SHA256 = '9bf441df427e903309f459f917f802b8d31c612ccf33c789282fd3f941a02b94'


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
        if command == b'OKAY' and not payload:
            continue
        if command != b'WRTE':
            raise ValueError(f'Unexpected guest ADB output packet {command!r}')
        if len(output) + len(payload) > limit:
            raise ValueError(f'Guest ADB output exceeded {limit} bytes')
        output.extend(payload)
        send(connection, b'OKAY', 1, remote)
    raise ValueError('Guest ADB stream did not close in time')


def return_stream(connection, remote, data, deadline):
    for start in range(0, len(data), PAYLOAD_LIMIT):
        if time.monotonic() >= deadline:
            raise ValueError('Guest ADB upload deadline expired')
        send(connection, b'WRTE', 1, remote, data[start:start + PAYLOAD_LIMIT])
        if receive(connection) != (b'OKAY', remote, 1, b''):
            raise ValueError('Guest did not acknowledge the upload stream')


def guest_command(key_path, limit, mode, *args, input_data=b'', timeout=15):
    prefixes = {'exec-out': 'exec:', 'shell': 'shell:', 'logcat': 'shell:logcat '}
    if mode not in prefixes:
        raise ValueError('Unexpected fixture guest command mode')
    command = (prefixes[mode] + shlex.join(args)).encode('ascii')
    require_owned_listener(key_path)
    with socket.create_connection(('127.0.0.1', ADB_PORT), timeout=6) as connection:
        try:
            authenticate(connection, load_key(key_path))
            remote = open_stream(connection, command)
            deadline = time.monotonic() + timeout
            if input_data:
                return_stream(connection, remote, input_data, deadline)
            connection.settimeout(timeout)
            data = stream_output(connection, remote, limit, deadline)
        except (EOFError, OSError) as error:
            raise ValueError(f'Guest ADB {args[0] if args else mode} stream failed: {error}') from error
    require_owned_listener(key_path)
    return data.replace(b'\r\n', b'\n') if mode != 'exec-out' else data


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


def install_fixture(key_path, apk, *, expected_hash=FIXTURE_APK_SHA256):
    # Reuse the smoke suite's checks for exact package identity and installed bytes.
    sys.path.append(str(Path(__file__).with_name('sdk-smoke')))
    from capture_device import check_installed_apk
    from device_preflight import check_fresh_device

    if apk.is_symlink() or not apk.is_file() or not 0 < apk.stat().st_size <= 32 * 1024**2:
        raise ValueError('Expected the pinned fixture APK size')
    with apk.open('rb') as stream:
        data = stream.read(32 * 1024**2 + 1)
    if len(data) > 32 * 1024**2 or (expected_hash == FIXTURE_APK_SHA256 and len(data) != FIXTURE_APK_SIZE) or sha256(data).hexdigest() != expected_hash:
        raise ValueError('Fixture APK hash changed')
    key = load_key(key_path)

    def command(limit, mode, *args):
        if mode != 'shell':
            raise ValueError('The install check uses shell queries only')
        for attempt in range(3):
            require_owned_listener(key_path)
            try:
                with socket.create_connection(('127.0.0.1', ADB_PORT), timeout=5) as connection:
                    authenticate(connection, key)
                    remote = open_stream(connection, ('shell:' + shlex.join(args)).encode('ascii'))
                    return stream_output(connection, remote, limit, time.monotonic() + 10)
            except (EOFError, OSError) as error:
                if attempt == 2:
                    raise ValueError(f'Guest {args[0]} query failed: {error}') from error
                time.sleep(.5)
            except ValueError as error:
                raise ValueError(f'Guest {args[0]} query failed: {error}') from error

    device = check_fresh_device(command)
    require_owned_listener(key_path)
    try:
        with socket.create_connection(('127.0.0.1', ADB_PORT), timeout=7) as connection:
            authenticate(connection, key)
            remote = open_stream(connection, f'exec:cmd package install -t -S {len(data)}'.encode('ascii'))
            return_stream(connection, remote, data, time.monotonic() + 90)
            connection.settimeout(45)
            if stream_output(connection, remote, 4096, time.monotonic() + 45).strip() != b'Success':
                raise ValueError('Guest package manager did not accept the fixture APK')
    except (EOFError, OSError, ValueError) as error:
        raise ValueError(f'Guest APK install stream failed: {error}') from error
    check_installed_apk(command, expected_hash)
    return {**device, 'installedApkSha256': expected_hash}


@contextmanager
def pack_server(java, identity, source, port, log_path, *, expire_pack, online_recovery=False):
    with log_path.open('xb') as log:
        arguments = [java, '-Djava.awt.headless=true', source, identity, str(port), '--raster-tile']
        if expire_pack:
            arguments.append('--expire-pack')
        if online_recovery:
            arguments.append('--online-recovery')
        process = subprocess.Popen(arguments, stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 15
            ready = f'STYLE_SERVER_READY port={port}\n'.encode('ascii')
            while time.monotonic() < deadline and process.poll() is None:
                if log_path.read_bytes() == ready:
                    break
                time.sleep(.25)
            else:
                raise ValueError('Owned synthetic server did not become ready')
            yield
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


def reopen_fixture(key_path, apk, relay, server_log, destination, java, identity, *, expected_hash,
                   expire_pack=False, sdk_offline=False, online_recovery=False, verify_refreshed_pack=False):
    sys.path.append(str(Path(__file__).with_name('sdk-smoke')))
    from capture_device import ACTIVITY, JOURNAL, PACKAGE, check_installed_apk, running_pid, write_capture
    from verify_device_capture import JOURNAL_HEADER, JOURNAL_RECORD, read_apk
    from verify_pack_reopen import DATABASE, pack_database, verify_reopen
    from verify_online_recovery import verify_online, verify_refreshed

    def command(limit, mode, *args, timeout=15):
        return guest_command(key_path, limit, mode, *args, timeout=timeout)

    def stop_app():
        command(1024, 'shell', 'am', 'force-stop', PACKAGE)
        if command(128, 'shell', 'pidof', PACKAGE).strip():
            raise ValueError('Fixture app process did not stop')

    def require_server_closed():
        with socket.socket() as probe:
            probe.settimeout(2)
            if probe.connect_ex(('127.0.0.1', port)) != errno.ECONNREFUSED:
                raise ValueError('Host fixture server still accepts connections')

    def capture_database(directory):
        for name in (DATABASE, DATABASE + '-wal'):
            guest_path = f'files/{name}'
            data = command(4 * 1024**2, 'exec-out', 'run-as', PACKAGE, 'sh', '-c',
                           f'if [ -s {guest_path} ]; then cat {guest_path}; fi')
            if data:
                write_capture(directory / name, data)
            elif name == DATABASE:
                raise ValueError('SDK offline database was not found in the fixture files directory')

    port, digest = read_apk(apk)
    if digest != expected_hash:
        raise ValueError('Reopen fixture APK hash changed')
    destination.mkdir(mode=0o700)
    download = destination / 'download'
    server_source = Path(__file__).with_name('sdk-smoke') / 'FixtureStyleServer.java'
    with pack_server(java, identity, server_source, port, server_log, expire_pack=expire_pack):
        pack = render_fixture(key_path, apk, relay, server_log, download, raster_tile=True,
                              offline_pack=True, expected_hash=expected_hash)
        first_pid = running_pid(command)
    require_server_closed()
    stop_app()
    capture_database(download)

    reopen = destination / 'reopen'
    reopen.mkdir(mode=0o700)
    if expire_pack:
        saved = pack_database(download, pack['packId'], port)
        expiration = (saved['styleStorage'][1], saved['tileStorage'][1])
        epoch = command(32, 'shell', 'date', '+%s').strip()
        if not epoch.isdigit() or any(not isinstance(value, int) or value >= int(epoch) for value in expiration):
            raise ValueError('Style and tile must both expire before the app restarts')
        write_capture(reopen / 'guest-epoch.txt', epoch + b'\n')
    extras = ['--el', 'fixture-reopen-pack', str(pack['packId'])]
    if sdk_offline:
        extras.extend(('--ez', 'fixture-sdk-offline', 'true'))
    if online_recovery:
        extras.extend(('--ez', 'fixture-online-recovery', 'true'))
    launch = command(4096, 'shell', 'am', 'start', '-W', '-n', ACTIVITY, *extras)
    if b'Status: ok' not in launch:
        raise ValueError('Guest fixture reopen activity did not start')
    second_pid = running_pid(command)
    if second_pid == first_pid:
        raise ValueError('Reopen did not start a new process')
    journal_size = JOURNAL_HEADER.size + 2 * JOURNAL_RECORD.size
    capture_reopened_view(command, reopen, second_pid, journal_size, expected_hash)
    write_capture(reopen / 'server.log', server_log.read_bytes())
    if online_recovery:
        verify_reopen(destination, pack, port, first_pid, second_pid, expire_pack=True, sdk_offline=True,
                      online_recovery=True)
        online = destination / 'online'
        online.mkdir(mode=0o700)
        with pack_server(java, identity, server_source, port, online / 'server.log', expire_pack=False,
                         online_recovery=True):
            capture_online_recovery(command, online, port, pack['packId'], second_pid)
        online_journal_size = journal_size + 2 * JOURNAL_RECORD.size
        write_capture(online / 'budget.journal', command(online_journal_size, 'exec-out', 'run-as', PACKAGE, 'cat', JOURNAL))
        check_installed_apk(command, expected_hash)
        stop_app()
        capture_database(online)
        result = {'download': pack, **verify_online(destination, pack, port, first_pid, second_pid)}
        if verify_refreshed_pack:
            require_server_closed()
            restored = destination / 'restored'
            restored.mkdir(mode=0o700)
            launch = command(4096, 'shell', 'am', 'start', '-W', '-n', ACTIVITY,
                             '--el', 'fixture-reopen-pack', str(pack['packId']), '--ez', 'fixture-sdk-offline', 'true')
            if b'Status: ok' not in launch:
                raise ValueError('Refreshed pack activity did not start')
            restored_pid = running_pid(command)
            capture_reopened_view(command, restored, restored_pid, online_journal_size, expected_hash)
            write_capture(restored / 'server.log', (online / 'server.log').read_bytes())
            stop_app()
            capture_database(restored)
            result['restored'] = verify_refreshed(destination, result, port, restored_pid)
        return result
    stop_app()
    capture_database(reopen)
    return {'download': pack, **verify_reopen(destination, pack, port, first_pid, second_pid,
                                              expire_pack=expire_pack, sdk_offline=sdk_offline)}


def capture_reopened_view(command, directory, pid, journal_size, expected_hash):
    from capture_device import JOURNAL, PACKAGE, check_installed_apk, require_foreground, running_pid, write_capture
    from verify_device_capture import LOG_LIMIT, PNG_LIMIT

    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        app = command(LOG_LIMIT, 'logcat', '-d', '--pid', str(pid), '-v', 'threadtime',
                      '-s', 'TripMapSdkFixture:V', '*:S')
        if b'REOPEN_TRANSPORT ' in app or b'PACK_FAILED ' in app or b'STYLE_LOAD_FAILED' in app:
            break
        time.sleep(1)
    write_capture(directory / 'app.log', app)
    if b'REOPEN_TRANSPORT ' not in app:
        raise ValueError('Reopened pack did not report a complete frame and request count')
    require_foreground(command)
    write_capture(directory / 'screen.png', command(PNG_LIMIT, 'exec-out', 'screencap', '-p'))
    require_foreground(command)
    write_capture(directory / 'budget.journal', command(journal_size, 'exec-out', 'run-as', PACKAGE, 'cat', JOURNAL))
    check_installed_apk(command, expected_hash)
    if running_pid(command) != pid:
        raise ValueError('Reopened app process changed during capture')


def capture_online_recovery(command, online, port, pack_id, pid):
    from capture_device import ACTIVITY, require_foreground, running_pid, write_capture
    from verify_device_capture import LOG_LIMIT, PNG_LIMIT

    # Leave live relay output in the isolated guest so readiness can be observed before signaling the map.
    relay_log = '/data/local/tmp/trip-map-online-relay.log'
    relay_command = (f'CLASSPATH={FIXTURE_RELAY_PATH} app_process /system/bin FixtureLoopbackRelay {port} '
                     f'--raster-tile > {relay_log} 2>&1; cat {relay_log}')
    ready_message = f'RELAY_READY port={port}\n'.encode('ascii')
    with ThreadPoolExecutor(max_workers=1) as executor:
        relay = executor.submit(command, LOG_LIMIT, 'shell', 'sh', '-c', relay_command, timeout=40)
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline and not relay.done():
            ready = command(LOG_LIMIT, 'shell', 'sh', '-c', f'if [ -f {relay_log} ]; then cat {relay_log}; fi')
            if ready == ready_message:
                break
            time.sleep(.25)
        else:
            raise ValueError('Online relay was not ready before reconnecting')
        launch = command(4096, 'shell', 'am', 'start', '-W', '--activity-single-top', '-n', ACTIVITY,
                         '--el', 'fixture-reconnect-pack', str(pack_id))
        write_capture(online / 'transition.txt', launch)
        if b'Status: ok' not in launch or running_pid(command) != pid:
            raise ValueError('Reconnect did not reach the original fixture app process')
        output = relay.result()
        write_capture(online / 'relay.log', output)
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        app = command(LOG_LIMIT, 'logcat', '-d', '--pid', str(pid), '-v', 'threadtime', '-s', 'TripMapSdkFixture:V', '*:S')
        if b'ONLINE_TRANSPORT ' in app:
            break
        time.sleep(.25)
    write_capture(online / 'app.log', app)
    require_foreground(command)
    write_capture(online / 'screen.png', command(PNG_LIMIT, 'exec-out', 'screencap', '-p'))
    require_foreground(command)
    if running_pid(command) != pid:
        raise ValueError('The online app process changed during capture')


def render_fixture(key_path, apk, relay, server_log, destination, *, raster_tile=False,
                   offline_pack=False, expected_hash=FIXTURE_APK_SHA256):
    sys.path.append(str(Path(__file__).with_name('sdk-smoke')))
    from capture_device import ACTIVITY, JOURNAL, PACKAGE, check_installed_apk, collect, running_pid, write_capture
    from verify_device_capture import (JOURNAL_HEADER, JOURNAL_RECORD, LOG_LIMIT, check_journal,
                                       check_pack_log, check_transport_logs, read_apk)

    port, apk_hash = read_apk(apk)
    if apk_hash != expected_hash or relay.is_symlink() or relay.stat().st_size > 16_384:
        raise ValueError('Unexpected fixture APK or relay')
    with relay.open('rb') as stream:
        relay_data = stream.read(16_385)
    relay_hash = RASTER_RELAY_SHA256 if raster_tile else FIXTURE_RELAY_SHA256
    if sha256(relay_data).hexdigest() != relay_hash:
        raise ValueError('Fixture relay hash changed')
    expected = f'STYLE_SERVER_READY port={port}\n'.encode('ascii')
    if server_log.is_symlink() or not server_log.is_file() or server_log.stat().st_size != len(expected) or server_log.read_bytes() != expected:
        raise ValueError('Expected a fresh synthetic server on the APK port')

    def command(limit, mode, *args):
        return guest_command(key_path, limit, mode, *args)

    stage = (f'umask 077; head -c {len(relay_data)} > {FIXTURE_RELAY_PATH} && '
             f'chmod 400 {FIXTURE_RELAY_PATH} && sha256sum {FIXTURE_RELAY_PATH}')
    reply = guest_command(key_path, 512, 'exec-out', 'sh', '-c', stage, input_data=relay_data)
    expected_relay = f'{relay_hash}  {FIXTURE_RELAY_PATH}'.encode('ascii')
    if reply.strip() != expected_relay:
        raise ValueError('Guest relay hash does not match the staged file')

    relay_arguments = [str(port), '--raster-tile'] if raster_tile else [str(port)]
    with ThreadPoolExecutor(max_workers=1) as executor:
        relay_task = executor.submit(
            guest_command, key_path, LOG_LIMIT, 'shell', 'env', f'CLASSPATH={FIXTURE_RELAY_PATH}',
            'app_process', '/system/bin', 'FixtureLoopbackRelay', *relay_arguments, timeout=40,
        )
        time.sleep(2)
        if relay_task.done():
            raise ValueError('Guest relay stopped before launching the map')
        launch_args = ['--ez', 'fixture-offline-pack', 'true'] if offline_pack else []
        launch = command(4096, 'shell', 'am', 'start', '-W', '-n', ACTIVITY, *launch_args)
        if b'Status: ok' not in launch:
            raise ValueError('Guest fixture activity did not start')
        relay_output = relay_task.result()
        if b'RELAY_COMPLETE ' not in relay_output:
            if raster_tile:
                destination.mkdir(mode=0o700)
                write_capture(destination / 'relay.log', relay_output)
                pid = running_pid(command)
                app_log = command(LOG_LIMIT, 'logcat', '-d', '--pid', str(pid), '-v', 'threadtime',
                                  '-s', 'TripMapSdkFixture:V', '*:S')
                write_capture(destination / 'app.log', app_log)
            raise ValueError(f'Guest relay did not complete: {relay_output.decode(errors="replace")[:500]}')
    pid = running_pid(command)
    deadline = time.monotonic() + 18
    while time.monotonic() < deadline:
        app = command(LOG_LIMIT, 'logcat', '-d', '--pid', str(pid), '-v', 'threadtime', '-s', 'TripMapSdkFixture:V', '*:S')
        if offline_pack and b'PACK_STORED ' in app:
            destination.mkdir(mode=0o700)
            write_capture(destination / 'app.log', app)
            write_capture(destination / 'relay.log', relay_output)
            write_capture(destination / 'server.log', server_log.read_bytes())
            journal_size = JOURNAL_HEADER.size + 2 * JOURNAL_RECORD.size
            write_capture(destination / 'budget.journal', command(journal_size, 'exec-out', 'run-as', PACKAGE, 'cat', JOURNAL))
            style_bytes, tile_bytes, _ = check_transport_logs(destination, port, raster_tile=True)
            check_journal(destination / 'budget.journal', raster_tile=True)
            stats = check_pack_log(app, pid)
            check_installed_apk(command, expected_hash)
            if running_pid(command) != pid:
                raise ValueError('Offline pack process changed during capture')
            return {**stats, 'styleBodyBytes': style_bytes, 'tileBodyBytes': tile_bytes, 'installedApkSha256': expected_hash}
        if not offline_pack and b'FRAME_RENDERED fully=true' in app:
            return collect(command, destination, apk, server_log.read_bytes(), relay_output,
                           expected_apk_sha256=expected_hash, raster_tile=raster_tile)
        time.sleep(1)
    raise ValueError('Guest fixture did not report a stored pack' if offline_pack else
                     'Guest fixture did not report a rendered map frame')
