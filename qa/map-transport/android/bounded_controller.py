"""Finite artifacts for a trusted preparation controller, not a native launcher.

All writes through this API have a predeclared logical size limit. Descriptors
stay pinned and non-inheritable; unlinking a file does not release its charge.
This does not constrain arbitrary native processes or prove allocated storage.
It never creates, formats or mounts a disk image, or issues an AVD marker.
"""
from __future__ import annotations

import dataclasses
import copy
import json
import os
import pathlib
import stat
import threading
import types
import uuid
from collections.abc import Mapping


MAX_OUTSIDE_BYTES = 1024 * 1024
DEFAULT_LIMITS = types.MappingProxyType({
    'controller.sb': 16 * 1024,
    'attach.plist': 64 * 1024,
    'controller-events.json': 64 * 1024,
    'result.json': 64 * 1024,
    'output.txt': 64 * 1024,
    'outside-canary': 4 * 1024,
})


class ControllerError(RuntimeError):
    def __init__(self, message: str, *, cleanup_report: dict | None = None):
        super().__init__(message)
        self.cleanup_report = copy.deepcopy(cleanup_report)


def _stamp(value: os.stat_result) -> tuple:
    return (value.st_dev, value.st_ino, value.st_mode, value.st_nlink,
            value.st_uid, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


def _identity(value: os.stat_result) -> tuple:
    return value.st_dev, value.st_ino, value.st_mode, value.st_uid


def _limits(values: Mapping[str, int] | None, budget: int) -> dict[str, int]:
    if type(budget) is not int or not 0 < budget <= MAX_OUTSIDE_BYTES:
        raise ControllerError('Invalid controller budget')
    if values is None:
        values = DEFAULT_LIMITS
    if not isinstance(values, Mapping) or not values:
        raise ControllerError('A finite artifact inventory is required')
    result = dict(values)
    for name, limit in result.items():
        if (name not in DEFAULT_LIMITS or type(limit) is not int
                or not 0 < limit <= DEFAULT_LIMITS[name]):
            raise ControllerError('Unknown artifact or invalid file cap')
    if sum(result.values()) > budget:
        raise ControllerError('Artifact reservations exceed the controller budget')
    return result


@dataclasses.dataclass
class _Artifact:
    descriptor: int
    stamp: tuple


class ControllerArtifacts:
    """Own one fresh run. Failure is terminal and close never deletes evidence.

    This class is a trusted-writer component. External processes are not given
    its descriptors. Integrity checks detect replacement; they are not an atomic
    OS sandbox against another process racing a write or changing mount state.
    """

    @classmethod
    def create(cls, android_root: pathlib.Path, *,
               limits: Mapping[str, int] | None = None,
               budget_bytes: int = MAX_OUTSIDE_BYTES) -> ControllerArtifacts:
        declared = _limits(limits, budget_bytes)  # Before any filesystem writes.
        path = pathlib.Path(android_root)
        if not path.is_absolute() or '..' in path.parts:
            raise ControllerError('An absolute existing workspace is required')
        required = ('O_DIRECTORY', 'O_NOFOLLOW', 'O_CLOEXEC', 'O_NONBLOCK')
        if not all(hasattr(os, name) for name in required):
            raise ControllerError('Safe descriptor-relative filesystem APIs are unavailable')

        self = cls.__new__(cls)
        self._lock = threading.RLock()
        self._closed = False
        self._failure: str | None = None
        self._cleanup_report: dict | None = None
        self._limits = declared
        self._budget = budget_bytes
        self._directories: list[int] = []
        self._edges: list[tuple[int, str, int, tuple]] = []
        self._artifacts: dict[str, _Artifact] = {}
        directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC

        def descend(parent: int, name: str, *, create: bool = False) -> int:
            if create:
                try:
                    os.mkdir(name, 0o700, dir_fd=parent)
                except FileExistsError:
                    pass
            descriptor = os.open(name, directory_flags, dir_fd=parent)
            self._directories.append(descriptor)
            value = os.fstat(descriptor)
            if create and (value.st_uid != os.getuid() or value.st_mode & 0o022):
                raise ControllerError('Controller directories must be owned and not shared writable')
            self._edges.append((parent, name, descriptor, _identity(value)))
            return descriptor

        try:
            current = os.open(path.anchor, directory_flags)
            self._directories.append(current)
            for part in path.parts[1:]:
                current = descend(current, part)
            value = os.fstat(current)
            if value.st_uid != os.getuid() or value.st_mode & 0o022:
                raise ControllerError('Workspace must be owned and not shared writable')
            current = descend(current, '.build', create=True)
            current = descend(current, 'controller-artifacts', create=True)
            run_name = 'run_' + uuid.uuid4().hex[:12]
            os.mkdir(run_name, 0o700, dir_fd=current)  # Never reuse an old run.
            self._root_fd = descend(current, run_name)
            self.root = path / '.build/controller-artifacts' / run_name
            file_flags = (os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
                          | os.O_CLOEXEC | os.O_NONBLOCK)
            for name in declared:
                descriptor = os.open(name, file_flags, 0o600, dir_fd=self._root_fd)
                self._artifacts[name] = _Artifact(descriptor, ())
                value = os.fstat(descriptor)
                self._artifacts[name].stamp = _stamp(value)
            self._check()
            os.fsync(self._root_fd)
            return self
        except BaseException as error:
            try:
                self.close()
            except ControllerError as cleanup_error:
                raise ControllerError(
                    'Preparation failed and descriptor cleanup is unconfirmed',
                    cleanup_report=cleanup_error.cleanup_report) from error
            if isinstance(error, OSError):
                raise ControllerError('Could not exclusively prepare controller artifacts') from error
            raise

    def _fail(self, message: str) -> None:
        if self._failure is None:
            self._failure = message
        raise ControllerError(self._failure)

    def _open(self) -> None:
        if self._closed:
            raise ControllerError('Controller artifacts are closed')

    def _check(self) -> None:
        self._open()
        if self._failure:
            raise ControllerError(self._failure)
        try:
            for parent, name, descriptor, identity in self._edges:
                visible = os.stat(name, dir_fd=parent, follow_symlinks=False)
                pinned = os.fstat(descriptor)
                if (not stat.S_ISDIR(visible.st_mode)
                        or _identity(visible) != identity or _identity(pinned) != identity):
                    self._fail('Controller directory identity changed')
            names = set()
            with os.scandir(self._root_fd) as entries:
                for entry in entries:
                    if entry.name not in self._artifacts or entry.name in names:
                        self._fail('Unexpected controller artifact')
                    names.add(entry.name)
            if names != self._artifacts.keys():
                self._fail('An owned controller artifact disappeared')
            for name, artifact in self._artifacts.items():
                pinned = os.fstat(artifact.descriptor)
                visible = os.stat(name, dir_fd=self._root_fd, follow_symlinks=False)
                if (not stat.S_ISREG(pinned.st_mode) or pinned.st_nlink != 1
                        or pinned.st_uid != os.getuid() or pinned.st_mode & 0o077
                        or os.get_inheritable(artifact.descriptor)
                        or _stamp(pinned) != artifact.stamp
                        or _stamp(visible) != artifact.stamp):
                    self._fail('Controller artifact identity, content or links changed')
                if pinned.st_size > self._limits[name]:
                    self._fail('Controller artifact exceeds its file cap')
        except OSError as error:
            self._fail('Controller integrity inspection failed: ' + type(error).__name__)

    def write(self, name: str, body: bytes, *, append: bool = False) -> None:
        """Check the entire reservation and proposed size before changing bytes."""
        with self._lock:
            self._check()
            if (type(name) is not str or name not in self._artifacts
                    or type(body) is not bytes or type(append) is not bool):
                self._fail('Unknown artifact or invalid write arguments')
            artifact = self._artifacts[name]
            previous = os.fstat(artifact.descriptor).st_size
            final_size = (previous if append else 0) + len(body)
            if final_size > self._limits[name]:
                self._fail('Write would exceed the artifact file cap')
            try:
                os.lseek(artifact.descriptor, previous if append else 0, os.SEEK_SET)
                remaining = memoryview(body)
                while remaining:
                    count = os.write(artifact.descriptor, remaining)
                    if count <= 0 or count > len(remaining):
                        self._fail('Controller write made invalid progress')
                    remaining = remaining[count:]
                os.ftruncate(artifact.descriptor, final_size)
                os.fsync(artifact.descriptor)
                artifact.stamp = _stamp(os.fstat(artifact.descriptor))
                self._check()
            except OSError as error:
                self._fail('Controller artifact write failed: ' + type(error).__name__)

    def write_json(self, name: str, value: object) -> None:
        with self._lock:
            self._check()
            try:
                body = (json.dumps(value, sort_keys=True, allow_nan=False) + '\n').encode('utf-8')
            except (TypeError, ValueError, OverflowError, RecursionError) as error:
                self._fail('Controller JSON serialization failed: ' + type(error).__name__)
            self.write(name, body)

    def audit(self) -> dict:
        """Report pinned FDs, including unlinked ones; never issue launch proof."""
        with self._lock:
            self._open()
            try:
                self._check()
            except ControllerError:
                pass
            files = {}
            for name, artifact in self._artifacts.items():
                value = os.fstat(artifact.descriptor)
                files[name] = {
                    'logicalBytes': value.st_size,
                    'allocatedBytes': value.st_blocks * 512,
                    'links': value.st_nlink,
                    'limitBytes': self._limits[name],
                    'inheritable': os.get_inheritable(artifact.descriptor),
                }
            return {
                'scope': 'trusted-controller-api/logical-file-caps-only',
                'status': 'FAILED' if self._failure else 'READY',
                'failure': self._failure,
                'budgetBytes': self._budget,
                'reservedLogicalBytes': sum(self._limits.values()),
                'observedOwnedLogicalBytes': sum(x['logicalBytes'] for x in files.values()),
                'observedOwnedAllocatedBytes': sum(x['allocatedBytes'] for x in files.values()),
                'openUnlinkedLogicalBytes': sum(x['logicalBytes'] for x in files.values() if not x['links']),
                'allocationBoundProven': False,
                'nativeAdmissionEnabled': False,
                'files': files,
            }

    @property
    def cleanup_report(self) -> dict | None:
        with self._lock:
            return copy.deepcopy(self._cleanup_report)

    def close(self) -> dict:
        """Release descriptors only; retain even partially written evidence."""
        with self._lock:
            if self._closed:
                if self._cleanup_report['status'] == 'FAILED':
                    raise ControllerError('Descriptor cleanup remains unconfirmed; no blind retry',
                                          cleanup_report=self._cleanup_report)
                return self.cleanup_report
            self._closed = True  # Reused FD numbers must never be closed twice.
            descriptors = [(x.descriptor, name) for name, x in self._artifacts.items()]
            descriptors.extend((descriptor, 'directory') for descriptor in self._directories[::-1])
            failures = []
            for descriptor, kind in descriptors:
                try:
                    os.close(descriptor)
                except OSError as error:
                    failures.append({'kind': kind, 'errno': error.errno})
            self._cleanup_report = {
                'status': 'FAILED' if failures else 'CLOSED',
                'attemptedDescriptors': len(descriptors),
                'unconfirmedDescriptors': failures,
                'filesRetained': True,
                'blindRetryAllowed': False,
            }
            if failures:
                self._failure = 'Controller descriptor cleanup is unconfirmed'
                raise ControllerError(self._failure, cleanup_report=self._cleanup_report)
            return self.cleanup_report

    def __enter__(self) -> ControllerArtifacts:
        self._open()
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        try:
            self.close()
        except ControllerError as error:
            if exc is not None:
                raise error from exc
            raise
