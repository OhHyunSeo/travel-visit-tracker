"""Capture a completed fixture run through an already verified Android transport."""

import os
from pathlib import Path
import re

from verify_device_capture import (
    JOURNAL_HEADER, JOURNAL_RECORD, LOG_LIMIT, PNG_LIMIT, check_app_log, check_transport_logs, read_apk, verify,
)


PACKAGE = "app.trippainting.maptransportqa.sdk"
ACTIVITY = f"{PACKAGE}/app.trippainting.maptransportqa.FixtureMapActivity"
JOURNAL = "files/transport-budget/budget.journal"
RESUMED = re.compile(rb"(?:topResumedActivity|mResumedActivity)\s*[:=]\s*ActivityRecord\{[^\n]+")


def running_pid(command):
    result = command(128, "shell", "pidof", PACKAGE).strip()
    if not re.fullmatch(rb"[1-9][0-9]{0,8}", result):
        raise ValueError("Expected exactly one running fixture process")
    return int(result)


def require_foreground(command):
    output = command(65_536, "shell", "dumpsys", "activity", "activities")
    resumed = {item for line in RESUMED.findall(output) for item in line.decode().split() if "/" in item}
    if resumed != {ACTIVITY}:
        raise ValueError("Fixture must be the sole resumed activity before screen capture")


def write_capture(path, content):
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as target:
        target.write(content)


def collect(command, destination, apk, server_log, relay_log):
    """Use command(max_output_bytes, *adb_args) with a pinned, admitted transport.

    The caller supplies a read-only transport that fails on nonzero exit,
    enforces an output limit and deadline, and verifies identity before and
    after each call. This module does not select, start or admit a device.
    """
    if not destination.is_absolute():
        raise ValueError("Use an absolute path for a new capture directory")
    if any(not log or len(log) > LOG_LIMIT for log in (server_log, relay_log)):
        raise ValueError("Server or relay log is missing or exceeds the capture limit")
    destination.mkdir(mode=0o700)
    write_capture(destination / "server.log", server_log)
    write_capture(destination / "relay.log", relay_log)
    port, _ = read_apk(Path(apk))
    check_transport_logs(destination, port)

    pid = running_pid(command)
    log = command(LOG_LIMIT, "logcat", "-d", "--pid", str(pid), "-v", "threadtime", "-s", "TripMapSdkFixture:V", "*:S")
    write_capture(destination / "app.log", log)
    check_app_log(log, pid, require_render_event=True)
    require_foreground(command)
    frame = command(PNG_LIMIT, "exec-out", "screencap", "-p")
    require_foreground(command)
    if running_pid(command) != pid:
        raise ValueError("Fixture PID changed during screen capture")
    write_capture(destination / "screen.png", frame)

    journal = command(JOURNAL_HEADER.size + JOURNAL_RECORD.size, "exec-out", "run-as", PACKAGE, "cat", JOURNAL)
    if running_pid(command) != pid:
        raise ValueError("Fixture PID changed during journal capture")
    write_capture(destination / "budget.journal", journal)
    return verify(destination, Path(apk), pid, require_render_event=True)
