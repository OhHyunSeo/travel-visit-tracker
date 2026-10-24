"""Read this app's test state from an Android emulator without exposing coordinates."""

import argparse
import io
import json
import os
import re
from pathlib import Path
import sqlite3
import subprocess
import tarfile
import tempfile
import time


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--serial", default="emulator-5554")
parser.add_argument("--output", type=Path)
args = parser.parse_args()
if not args.serial.startswith("emulator-"):
    parser.error("This helper only reads synthetic emulator test data.")
sdk = Path(os.environ.get("ANDROID_HOME", Path.home() / "Library/Android/sdk"))
result = subprocess.run(
    [str(sdk / "platform-tools/adb"), "-s", args.serial, "exec-out", "run-as",
     "app.trippainting.mobile", "tar", "-cf", "-", "files/SQLite"],
    capture_output=True, check=True,
)
with tempfile.TemporaryDirectory(prefix="trip-painting-test-state-") as directory:
    destination = Path(directory)
    with tarfile.open(fileobj=io.BytesIO(result.stdout)) as archive:
        for member in archive.getmembers():
            path = destination / member.name
            if not path.resolve().is_relative_to(destination.resolve()):
                raise RuntimeError("Unexpected archive path")
            if member.isdir():
                path.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(archive.extractfile(member).read())
            else:
                raise RuntimeError("Unexpected archive entry")
    connection = sqlite3.connect(destination / "files/SQLite/trip-painting-v1.db")
    settings = {key: json.loads(value) for key, value in connection.execute(
        "SELECT key,value FROM settings WHERE key LIKE 'guest:%'"
    )}
    candidate = connection.execute(
        "SELECT started_at,last_observed_at,confirmed_at FROM candidates WHERE owner_id='guest'"
    ).fetchone()
    photo_files = {"verified": 0, "missing": 0, "unverified": 0}
    for (uri,) in connection.execute("SELECT uri FROM photos WHERE owner_id='guest'"):
        # Never pass arbitrary database content to a device shell or read other paths.
        if not re.fullmatch(r"visit-photos/[A-Za-z0-9-]+\.(jpg|jpeg|png|heic|webp)", uri):
            photo_files["unverified"] += 1
            continue
        check = subprocess.run(
            [str(sdk / "platform-tools/adb"), "-s", args.serial, "shell", "run-as",
             "app.trippainting.mobile", "test", "-f", "files/" + uri],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        photo_files["verified" if check.returncode == 0 else "missing"] += 1
    state = {
        "capturedAt": int(time.time() * 1000),
        "virtualDevice": True,
        "integrity": connection.execute("PRAGMA integrity_check").fetchone()[0],
        "recording": settings.get("guest:recording", False),
        "recordingMode": settings.get("guest:recordingMode", "foreground"),
        "status": settings.get("guest:status"),
        "message": settings.get("guest:message"),
        "diagnostics": settings.get("guest:diagnostics", {}),
        "candidate": {
            "startedAt": candidate[0], "lastObservedAt": candidate[1],
            "confirmedAt": candidate[2],
            "observedSeconds": round((candidate[1] - candidate[0]) / 1000, 3),
        } if candidate else None,
        "gpsVisits": connection.execute(
            "SELECT count(*) FROM visits WHERE owner_id='guest' AND source='gps' AND deleted_at IS NULL"
        ).fetchone()[0],
        "gpsDwellSeconds": [round((end - start) / 1000, 3) for start, end in connection.execute(
            "SELECT started_at,confirmed_at FROM visits WHERE owner_id='guest' AND source='gps' AND deleted_at IS NULL ORDER BY confirmed_at"
        )],
        "photos": connection.execute("SELECT count(*) FROM photos WHERE owner_id='guest'").fetchone()[0],
        "photoFiles": photo_files,
        "orphanPhotoAssociations": connection.execute(
            "SELECT count(*) FROM photos p LEFT JOIN visits v "
            "ON p.visit_id=v.id AND p.owner_id=v.owner_id WHERE p.owner_id='guest' AND v.id IS NULL"
        ).fetchone()[0],
        "activeVisits": connection.execute(
            "SELECT count(*) FROM visits WHERE owner_id='guest' AND deleted_at IS NULL"
        ).fetchone()[0],
        "pendingOutbox": connection.execute("SELECT count(*) FROM outbox WHERE owner_id='guest'").fetchone()[0],
    }
    connection.close()
text = json.dumps(state, ensure_ascii=False, indent=2) + "\n"
if args.output:
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(text)
print(text, end="")
