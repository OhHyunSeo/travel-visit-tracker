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
APK_PATH = re.compile(rb"package:(/data/app/(?:[A-Za-z0-9_.~+=-]+/){1,4}base\.apk)\r?\n?")
APK_HASH_LINE = re.compile(rb"([a-f0-9]{64})[ \t]+([^\r\n]+)\r?\n?")


def running_pid(command, package=PACKAGE):
    result = command(128, "shell", "pidof", package).strip()
    if not re.fullmatch(rb"[1-9][0-9]{0,8}", result):
        raise ValueError("Expected exactly one running fixture process")
    return int(result)


def require_foreground(command, activity=ACTIVITY):
    output = command(65_536, "shell", "dumpsys", "activity", "activities")
    resumed = {item for line in RESUMED.findall(output) for item in line.decode().split() if "/" in item}
    if resumed != {activity}:
        raise ValueError("Fixture must be the sole resumed activity before screen capture")


def check_installed_apk(command, expected_hash, package=PACKAGE):
    path_output = command(1024, "shell", "pm", "path", package)
    match = APK_PATH.fullmatch(path_output)
    if not match:
        raise ValueError("Expected one installed fixture base APK path")
    path = match[1]
    segments = path.split(b"/")
    if any(segment in (b".", b"..") for segment in segments) or not segments[-2].startswith(package.encode() + b"-"):
        raise ValueError("Installed APK is outside the fixture package path")
    result = command(1024, "shell", "sha256sum", path.decode("ascii"))
    checksum = APK_HASH_LINE.fullmatch(result)
    if not checksum or checksum[2] != path or checksum[1].decode("ascii") != expected_hash:
        raise ValueError("Installed fixture APK differs from the checked build")
    return path


def write_capture(path, content):
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as target:
        target.write(content)


def collect(command, destination, apk, server_log, relay_log, *, expected_apk_sha256, raster_tile=False):
    """Use command(max_output_bytes, *adb_args) with a pinned, admitted transport.

    The caller supplies a read-only transport that fails on nonzero exit,
    enforces an output limit and deadline, and verifies identity before and
    after each call. This module does not select, start or admit a device.
    """
    if not destination.is_absolute():
        raise ValueError("Use an absolute path for a new capture directory")
    if any(not log or len(log) > LOG_LIMIT for log in (server_log, relay_log)):
        raise ValueError("Server or relay log is missing or exceeds the capture limit")
    apk = Path(apk)
    port, apk_hash = read_apk(apk)
    if apk_hash != expected_apk_sha256:
        raise ValueError("Fixture APK differs from the checked build")
    destination.mkdir(mode=0o700)
    write_capture(destination / "server.log", server_log)
    write_capture(destination / "relay.log", relay_log)
    check_transport_logs(destination, port, raster_tile=raster_tile)

    installed = check_installed_apk(command, apk_hash)
    pid = running_pid(command)
    log = command(LOG_LIMIT, "logcat", "-d", "--pid", str(pid), "-v", "threadtime", "-s", "TripMapSdkFixture:V", "*:S")
    write_capture(destination / "app.log", log)
    check_app_log(log, pid, require_render_event=True, raster_tile=raster_tile)
    require_foreground(command)
    frame = command(PNG_LIMIT, "exec-out", "screencap", "-p")
    require_foreground(command)
    if running_pid(command) != pid:
        raise ValueError("Fixture PID changed during screen capture")
    write_capture(destination / "screen.png", frame)

    journal_size = JOURNAL_HEADER.size + JOURNAL_RECORD.size * (2 if raster_tile else 1)
    journal = command(journal_size, "exec-out", "run-as", PACKAGE, "cat", JOURNAL)
    if running_pid(command) != pid:
        raise ValueError("Fixture PID changed during journal capture")
    write_capture(destination / "budget.journal", journal)
    if check_installed_apk(command, apk_hash) != installed or running_pid(command) != pid:
        raise ValueError("Installed fixture APK or PID changed during capture")
    result = verify(destination, apk, pid, require_render_event=True, raster_tile=raster_tile)
    if result["apkSha256"] != apk_hash:
        raise ValueError("Fixture APK changed during capture")
    result["installedApkSha256"] = apk_hash
    return result
