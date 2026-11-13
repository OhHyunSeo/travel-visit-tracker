"""Bound the output and lifetime of a capture command on an admitted transport."""

import os
from pathlib import Path
import selectors
import signal
import subprocess
import time

from verify_device_capture import PNG_LIMIT


class CaptureCommandError(RuntimeError):
    pass


def capture_output(argv, limit, timeout=10):
    if not 1 <= limit <= PNG_LIMIT or not 0 < timeout <= 30:
        raise ValueError("Invalid command capture budget")
    process = subprocess.Popen(
        argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        start_new_session=True, close_fds=True,
    )
    deadline = time.monotonic() + timeout
    stdout = bytearray()
    stderr = bytearray()
    reaped = False
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ, (stdout, limit))
            selector.register(process.stderr, selectors.EVENT_READ, (stderr, 4_096))
            while selector.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise CaptureCommandError("Capture command timed out")
                for key, _ in selector.select(remaining):
                    buffer, capacity = key.data
                    chunk = os.read(key.fd, min(16_384, capacity - len(buffer) + 1))
                    if not chunk:
                        selector.unregister(key.fileobj)
                    elif len(chunk) > capacity - len(buffer):
                        raise CaptureCommandError("Capture command exceeded its output limit")
                    else:
                        buffer.extend(chunk)
        try:
            status = process.wait(timeout=max(0, deadline - time.monotonic()))
        except subprocess.TimeoutExpired as error:
            raise CaptureCommandError("Capture command timed out") from error
        reaped = True
        if status != 0:
            raise CaptureCommandError(f"Capture command failed with exit {status}")
        return bytes(stdout)
    finally:
        try:
            if not reaped:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                finally:
                    try:
                        process.wait(timeout=1)
                    except subprocess.TimeoutExpired as error:
                        raise CaptureCommandError("Capture command termination is unconfirmed") from error
        finally:
            process.stdout.close()
            process.stderr.close()


def for_admitted_transport(adb, transport_id, verify_identity):
    """Bind capture commands to an existing ADB transport with a caller-owned guard."""
    executable = Path(adb)
    if not executable.is_absolute() or type(transport_id) is not int or transport_id < 1:
        raise ValueError("Expected absolute ADB path and verified transport ID")

    def command(limit, *args):
        verify_identity()
        try:
            return capture_output([str(executable), "-t", str(transport_id), *args], limit)
        finally:
            verify_identity()

    return command
