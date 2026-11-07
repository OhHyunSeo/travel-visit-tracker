#!/usr/bin/env python3
"""Explicit macOS single-writer component; no formatter, mount, SDK or AVD.

Only a fresh 512-byte synthetic regular file is used. The observed operations
do not prove a filesystem allocation cap or arbitrary native containment.
"""
from __future__ import annotations

import argparse
import copy
import errno
import fcntl
import hashlib
import json
import os
import pathlib
import re
import resource
import selectors
import signal
import stat
import subprocess
import sys
import tempfile
import time
import uuid

LIMIT_BYTES = 512
OUTPUT_BYTES = 8192
COMMAND_SECONDS = 5
CANARY = b'trip-painting-owned-canary-000001'
PROFILE = '''(version 1)
(deny default)
(allow file-read* file-map-executable)
(deny file-read* (subpath (param "PRIVATE_AVD_ROOT")))
(allow process-exec (literal (param "PYTHON_EXEC")))
(allow sysctl-read)
(allow file-write-data (literal (param "DATA_FILE")))
'''
REQUIRED_FLAGS = (
    'FD_CLOSED', 'STDIN_READ_ONLY', 'CORE_ZERO', 'OVERWRITE',
    'WRITE_GROWTH_DENIED', 'TRUNCATE_GROWTH_DENIED', 'HARD_LIMIT_RAISE_DENIED',
    'OUTSIDE_WRITE_DENIED', 'CREATE_DENIED', 'UNLINK_DENIED', 'RENAME_DENIED',
    'LINK_DENIED', 'CHMOD_DENIED', 'FORK_DENIED',
)


class ComponentError(RuntimeError):
    def __init__(self, message: str, *, fixture_root: str | None = None,
                 controller_root: str | None = None, cleanup_report: dict | None = None):
        super().__init__(message)
        self.fixture_root = fixture_root
        self.controller_root = controller_root
        self.cleanup_report = copy.deepcopy(cleanup_report)


def _unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate component field')
        result[key] = value
    return result


def _stamp(value: os.stat_result) -> tuple:
    return (value.st_dev, value.st_ino, value.st_mode, value.st_nlink,
            value.st_uid, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


def _read_owned(path: pathlib.Path, maximum: int) -> tuple[bytes, os.stat_result]:
    before = path.lstat()
    if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
            or before.st_uid != os.getuid() or stat.S_IMODE(before.st_mode) != 0o600
            or before.st_size > maximum):
        raise ComponentError('Unexpected component file ownership, type or size')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    try:
        actual = os.fstat(descriptor)
        if _stamp(actual) != _stamp(before):
            raise ComponentError('Component file changed before safe open')
        body = bytearray()
        while len(body) <= maximum:
            part = os.read(descriptor, maximum + 1 - len(body))
            if not part:
                break
            body.extend(part)
        if (len(body) != actual.st_size or len(body) > maximum
                or _stamp(os.fstat(descriptor)) != _stamp(actual)
                or _stamp(path.lstat()) != _stamp(actual)):
            raise ComponentError('Component file changed during bounded read')
        return bytes(body), actual
    finally:
        os.close(descriptor)


def create_fixture() -> pathlib.Path:
    root = pathlib.Path(tempfile.mkdtemp(prefix='trip-single-writer-' + uuid.uuid4().hex[:12] + '-')).resolve()

    def create(name: str, body: bytes) -> None:
        descriptor = os.open(root / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL
                             | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
        try:
            remaining = memoryview(body)
            while remaining:
                count = os.write(descriptor, remaining)
                if count <= 0 or count > len(remaining):
                    raise ComponentError('Fixture write made invalid progress')
                remaining = remaining[count:]
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    try:
        create('data.bin', bytes(LIMIT_BYTES))
        create('canary.bin', CANARY)
        value = (root / 'data.bin').stat()
        contract = {'schema': 1, 'device': value.st_dev, 'inode': value.st_ino,
                    'privateAvdRoot': str(pathlib.Path.home() / '.android/avd')}
        create('contract.json', json.dumps(contract, sort_keys=True).encode())
    except BaseException as error:
        if isinstance(error, (KeyboardInterrupt, SystemExit)):
            raise
        raise ComponentError('Fixture creation failed; retained fixture=' + str(root),
                             fixture_root=str(root)) from error
    return root


def inspect_fixture(root: pathlib.Path) -> dict:
    root = pathlib.Path(root)
    if (not root.is_absolute() or '..' in root.parts or root != root.resolve()
            or not re.fullmatch(r'trip-single-writer-[a-f0-9]{12}-[a-zA-Z0-9_]+', root.name)):
        raise ComponentError('Only a fresh canonical component directory is allowed')
    value = root.lstat()
    if (not stat.S_ISDIR(value.st_mode) or value.st_uid != os.getuid()
            or stat.S_IMODE(value.st_mode) != 0o700):
        raise ComponentError('Component directory must be private and owned')
    names = set()
    with os.scandir(root) as entries:
        for entry in entries:
            if entry.name not in {'data.bin', 'canary.bin', 'contract.json'}:
                raise ComponentError('Unexpected component artifact')
            names.add(entry.name)
    if len(names) != 3:
        raise ComponentError('Incomplete component inventory')
    body, target = _read_owned(root / 'data.bin', LIMIT_BYTES)
    canary, _ = _read_owned(root / 'canary.bin', len(CANARY))
    raw, _ = _read_owned(root / 'contract.json', 4096)
    try:
        contract = json.loads(raw, object_pairs_hook=_unique_pairs)
    except (ValueError, UnicodeError) as error:
        raise ComponentError('Invalid component contract') from error
    if (not isinstance(contract, dict) or type(contract.get('schema')) is not int
            or contract['schema'] != 1 or type(contract.get('device')) is not int
            or type(contract.get('inode')) is not int
            or contract.get('device') != target.st_dev or contract.get('inode') != target.st_ino
            or not isinstance(contract.get('privateAvdRoot'), str)
            or not pathlib.Path(contract['privateAvdRoot']).is_absolute()
            or len(body) != LIMIT_BYTES or canary != CANARY):
        raise ComponentError('Component identity or canary differs from its contract')
    return {'contract': contract, 'target': target, 'body': body}


def component_environment(root: pathlib.Path) -> dict[str, str]:
    return {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LANG': 'C', 'TMPDIR': str(root)}


def launcher_argv(root: pathlib.Path, closed_fd: int) -> list[str]:
    return [str(pathlib.Path(sys.executable).resolve()), '-I', '-S', '-B',
            str(pathlib.Path(__file__).resolve()), '--launch-worker', str(root), str(closed_fd)]


def _fd_closed(descriptor: int) -> bool:
    if type(descriptor) is not int or descriptor < 3:
        return False
    try:
        os.fstat(descriptor)
    except OSError as error:
        return error.errno == errno.EBADF
    return False


def launch_worker(root: pathlib.Path, closed_fd: int) -> None:
    if sys.platform != 'darwin' or not _fd_closed(closed_fd):
        raise ComponentError('macOS and a closed inherited descriptor are required')
    inspected = inspect_fixture(root)
    if inspected['body'] != bytes(LIMIT_BYTES):
        raise ComponentError('Worker must start with a fresh zero-filled file')
    resource.setrlimit(resource.RLIMIT_FSIZE, (LIMIT_BYTES, LIMIT_BYTES))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    python = str(pathlib.Path(sys.executable).resolve())
    argv = ['/usr/bin/sandbox-exec', '-D', 'DATA_FILE=' + str(root / 'data.bin'),
            '-D', 'PYTHON_EXEC=' + python,
            '-D', 'PRIVATE_AVD_ROOT=' + inspected['contract']['privateAvdRoot'],
            '-p', PROFILE, python, '-I', '-S', '-B', str(pathlib.Path(__file__).resolve()),
            '--worker', str(root), str(closed_fd)]
    os.execve(argv[0], argv, component_environment(root))


def _denied(operation) -> bool:
    try:
        operation()
    except OSError as error:
        return error.errno in (errno.EPERM, errno.EACCES)
    return False


def worker(root: pathlib.Path, closed_fd: int) -> dict:
    closed = _fd_closed(closed_fd)  # Before this worker opens any fixture file.
    if not closed or resource.getrlimit(resource.RLIMIT_FSIZE) != (LIMIT_BYTES, LIMIT_BYTES):
        raise ComponentError('Inherited descriptor or file limit contract failed')
    inspected = inspect_fixture(root)
    if inspected['body'] != bytes(LIMIT_BYTES):
        raise ComponentError('Worker target is not a fresh zero file')
    signal.signal(signal.SIGXFSZ, signal.SIG_IGN)
    flags = {'FD_CLOSED': closed,
             'STDIN_READ_ONLY': fcntl.fcntl(0, fcntl.F_GETFL) & os.O_ACCMODE == os.O_RDONLY,
             'CORE_ZERO': resource.getrlimit(resource.RLIMIT_CORE) == (0, 0)}
    descriptor = os.open(root / 'data.bin', os.O_WRONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        if _stamp(os.fstat(descriptor)) != _stamp(inspected['target']):
            raise ComponentError('Target changed before write')
        remaining = memoryview(b'Q' * LIMIT_BYTES)
        while remaining:
            count = os.write(descriptor, remaining)
            if count <= 0:
                raise ComponentError('Worker write made no progress')
            remaining = remaining[count:]
        os.fsync(descriptor)
        flags['OVERWRITE'] = os.fstat(descriptor).st_size == LIMIT_BYTES
        for name, operation in [
                ('WRITE_GROWTH_DENIED', lambda: os.write(descriptor, b'!')),
                ('TRUNCATE_GROWTH_DENIED', lambda: os.ftruncate(descriptor, LIMIT_BYTES + 1))]:
            try:
                operation()
            except OSError as error:
                flags[name] = error.errno == errno.EFBIG
            else:
                flags[name] = False
    finally:
        os.close(descriptor)
    try:
        resource.setrlimit(resource.RLIMIT_FSIZE, (LIMIT_BYTES + 1, LIMIT_BYTES + 1))
    except (ValueError, OSError):
        flags['HARD_LIMIT_RAISE_DENIED'] = True
    else:
        flags['HARD_LIMIT_RAISE_DENIED'] = False

    def outside_write():
        handle = os.open(root / 'canary.bin', os.O_WRONLY | os.O_APPEND)
        try:
            os.write(handle, b'!')
        finally:
            os.close(handle)

    def create_outside():
        handle = os.open(root / 'forbidden-created', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.close(handle)

    operations = {
        'OUTSIDE_WRITE_DENIED': outside_write,
        'CREATE_DENIED': create_outside,
        'LINK_DENIED': lambda: os.link(root / 'data.bin', root / 'forbidden-link'),
        'CHMOD_DENIED': lambda: os.chmod(root / 'data.bin', 0o644),
        'RENAME_DENIED': lambda: os.rename(root / 'data.bin', root / 'forbidden-renamed'),
        'UNLINK_DENIED': lambda: os.unlink(root / 'data.bin'),
    }
    flags.update({name: _denied(operation) for name, operation in operations.items()})
    try:
        child = os.fork()
    except OSError as error:
        flags['FORK_DENIED'] = error.errno in (errno.EPERM, errno.EACCES)
    else:
        if child == 0:
            os._exit(0)
        os.waitpid(child, 0)
        flags['FORK_DENIED'] = False
    return {'pid': os.getpid(), 'limits': list(resource.getrlimit(resource.RLIMIT_FSIZE)),
            'logicalBytes': (root / 'data.bin').stat().st_size, 'flags': flags}


def parse_worker_report(body: bytes, expected_pid: int) -> dict:
    if not 0 < len(body) <= OUTPUT_BYTES:
        raise ComponentError('Worker report exceeded its allowance')
    try:
        report = json.loads(body, object_pairs_hook=_unique_pairs)
    except (ValueError, UnicodeError) as error:
        raise ComponentError('Invalid worker report') from error
    if (not isinstance(report, dict) or set(report) != {'pid', 'limits', 'logicalBytes', 'flags'}
            or type(report.get('pid')) is not int
            or report['pid'] != expected_pid
            or not isinstance(report.get('limits'), list) or len(report['limits']) != 2
            or any(type(value) is not int or value != LIMIT_BYTES for value in report['limits'])
            or type(report.get('logicalBytes')) is not int or report['logicalBytes'] != LIMIT_BYTES
            or not isinstance(report.get('flags'), dict)
            or set(report['flags']) != set(REQUIRED_FLAGS)
            or any(report['flags'][name] is not True for name in REQUIRED_FLAGS)):
        raise ComponentError('Worker did not prove every component observation')
    return report


def _capture(argv: list[str], *, cwd: pathlib.Path, env: dict) -> tuple[bytes, int]:
    """Capture the fixed trusted worker, not an arbitrary native process tree."""
    with open(os.devnull, 'rb', buffering=0) as read_only:
        process = subprocess.Popen(argv, cwd=cwd, env=env, stdin=read_only,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   close_fds=True, pass_fds=(), start_new_session=True)
    streams = {process.stdout: bytearray(), process.stderr: bytearray()}
    deadline = time.monotonic() + COMMAND_SECONDS
    completed = False
    try:
        with selectors.DefaultSelector() as selector:
            for stream in streams:
                selector.register(stream, selectors.EVENT_READ)
            while selector.get_map():
                if time.monotonic() >= deadline:
                    raise ComponentError('Component command timed out')
                for key, _ in selector.select(.05):
                    body = os.read(key.fileobj.fileno(), 4096)
                    if not body:
                        selector.unregister(key.fileobj)
                    else:
                        streams[key.fileobj].extend(body)
                        if sum(map(len, streams.values())) > OUTPUT_BYTES:
                            raise ComponentError('Component output exceeded its allowance')
        try:
            process.wait(timeout=max(.001, deadline - time.monotonic()))
        except subprocess.TimeoutExpired as error:
            raise ComponentError('Component command timed out before exit') from error
        completed = True
    finally:
        cleanup_error = None
        try:
            if not completed:
                # Failure/timeout cleanup occurs before reaping the leader.
                # Never signal a PID after a successful wait and possible reuse.
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                except OSError as error:
                    cleanup_error = error
                try:
                    process.wait(timeout=1)
                except subprocess.TimeoutExpired as error:
                    raise ComponentError('Owned component termination is unconfirmed') from error
        finally:
            for stream in streams:
                stream.close()
        if cleanup_error is not None:
            raise ComponentError('Owned process-group cleanup is unconfirmed') from cleanup_error
    if process.returncode:
        raise ComponentError('Component command failed: '
                             + bytes(streams[process.stderr]).decode(errors='replace')[:1024])
    return bytes(streams[process.stdout]), process.pid


def run_component(android_root: pathlib.Path) -> dict:
    if sys.platform != 'darwin' or not pathlib.Path('/usr/bin/sandbox-exec').is_file():
        raise ComponentError('Explicit macOS component only; use portable host tests elsewhere')
    from bounded_controller import ControllerArtifacts, ControllerError

    try:
        artifacts = ControllerArtifacts.create(android_root)
    except ControllerError as error:
        raise ComponentError('Controller creation failed: ' + str(error),
                             controller_root=error.controller_root,
                             cleanup_report=error.cleanup_report) from error
    root = None
    try:
        with artifacts:
            root = create_fixture()
            before = inspect_fixture(root)
            artifacts.write('controller.sb', PROFILE.encode())
            inherited = os.open(root / 'canary.bin', os.O_WRONLY | os.O_APPEND | os.O_CLOEXEC)
            os.set_inheritable(inherited, True)
            try:
                output, pid = _capture(launcher_argv(root, inherited), cwd=root,
                                       env=component_environment(root))
            finally:
                os.close(inherited)
            observed = parse_worker_report(output, pid)
            after = inspect_fixture(root)
            if (after['body'] != b'Q' * LIMIT_BYTES
                    or (after['target'].st_dev, after['target'].st_ino)
                    != (before['target'].st_dev, before['target'].st_ino)):
                raise ComponentError('Target content or identity changed unexpectedly')
            artifacts.write('output.txt', output)
            result = {'status': 'COMPONENT_PASS_ONLY', 'scope': 'fixed-python-single-writer-only',
                      'componentRoot': str(root), 'controllerRoot': str(artifacts.root),
                      'observations': observed,
                      'observedLogicalBytes': after['target'].st_size,
                      'observedAllocatedBytes': after['target'].st_blocks * 512,
                      'targetSha256': hashlib.sha256(after['body']).hexdigest(),
                      'allocationBoundProven': False, 'imageFormatted': False,
                      'nativeAdmissionEnabled': False, 'filesRetained': True,
                      'cleanup': 'PENDING'}
            artifacts.write_json('result.json', result)
            audit = artifacts.audit()
            if audit['status'] != 'READY':
                raise ComponentError('Controller integrity failed after component records')
        return {**result, 'controllerAudit': audit, 'cleanup': artifacts.cleanup_report}
    except BaseException as error:
        if isinstance(error, (KeyboardInterrupt, SystemExit)):
            raise
        retained = str(root) if root is not None else getattr(error, 'fixture_root', None)
        raise ComponentError('Component failed; retained fixture=' + str(retained)
                             + ', controller=' + str(artifacts.root) + ': ' + str(error),
                             fixture_root=retained, controller_root=str(artifacts.root),
                             cleanup_report=artifacts.cleanup_report) from error


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--run-component', action='store_true')
    modes.add_argument('--launch-worker', nargs=2, metavar=('ROOT', 'CLOSED_FD'))
    modes.add_argument('--worker', nargs=2, metavar=('ROOT', 'CLOSED_FD'))
    parser.add_argument('--android-root', type=pathlib.Path)
    args = parser.parse_args(argv)
    try:
        if args.launch_worker:
            launch_worker(pathlib.Path(args.launch_worker[0]), int(args.launch_worker[1]))
            raise ComponentError('exec unexpectedly returned')
        if args.worker:
            result = worker(pathlib.Path(args.worker[0]), int(args.worker[1]))
        else:
            if args.android_root is None:
                parser.error('--android-root is required for the explicit component')
            result = run_component(args.android_root)
        print(json.dumps(result, sort_keys=True))
        return 0
    except (ComponentError, OSError, ValueError) as error:
        print(json.dumps({'status': 'FAILED', 'error': str(error),
                          'componentRoot': getattr(error, 'fixture_root', None),
                          'controllerRoot': getattr(error, 'controller_root', None),
                          'cleanup': getattr(error, 'cleanup_report', None),
                          'nativeAdmissionEnabled': False}, sort_keys=True), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
