"""Check evidence from one fresh run of the isolated Android MapLibre fixture."""

import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import struct
from zipfile import BadZipFile, ZipFile
import zlib

from PIL import Image


LOG_LIMIT = 16_384
PNG_LIMIT = 8 * 1024 * 1024
STYLE_BYTES = 124
RESERVATION = 4_096
STYLE_RGB = (23, 120, 120)
APP_LOG = re.compile(
    r"\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+(\d+)\s+\d+\s+([A-Z])\s+TripMapSdkFixture:\s*(.*)"
)
JOURNAL_HEADER = struct.Struct(">IIIIQI")
JOURNAL_RECORD = struct.Struct(">IIQII")


def read_bounded(path, limit):
    if not path.is_file():
        raise ValueError(f"Missing regular capture file: {path.name}")
    with path.open("rb") as source:
        data = source.read(limit + 1)
    if not data or len(data) > limit:
        raise ValueError(f"Invalid capture file length: {path.name}")
    return data


def read_apk(path):
    data = read_bounded(path, 32 * 1024 * 1024)
    with ZipFile(io.BytesIO(data)) as apk:
        matches = [entry for entry in apk.infolist() if entry.filename == "assets/fixture-port"]
        if len(matches) != 1 or not 4 <= matches[0].file_size <= 5:
            raise ValueError("APK must contain one fixture port")
        value = apk.read(matches[0])
    if not re.fullmatch(rb"[1-9][0-9]{3,4}", value) or not 1024 <= int(value) <= 65_535:
        raise ValueError("Invalid fixture port in APK")
    return int(value), hashlib.sha256(data).hexdigest()


def check_logs(capture, port, pid, require_render_event):
    server = read_bounded(capture / "server.log", LOG_LIMIT).decode().splitlines()
    if server != [f"STYLE_SERVER_READY port={port}", f"SERVED_STYLE bytes={STYLE_BYTES}"]:
        raise ValueError("Server must record one matching fixture style response")

    relay = read_bounded(capture / "relay.log", LOG_LIMIT).decode().splitlines()
    if len(relay) != 2 or relay[0] != f"RELAY_READY port={port}":
        raise ValueError("Relay must record one ready and completed connection")
    forwarded = re.fullmatch(r"RELAY_COMPLETE forwarded=([0-9]{1,6})", relay[1])
    if not forwarded or not STYLE_BYTES < int(forwarded[1]) <= 2 * 65_536:
        raise ValueError("Invalid completed relay byte count")

    messages = []
    for line in read_bounded(capture / "app.log", LOG_LIMIT).decode().splitlines():
        if "TripMapSdkFixture:" not in line:
            continue
        match = APP_LOG.fullmatch(line)
        if not match or int(match[1]) != pid or match[2] != "I":
            raise ValueError("App capture includes a failed or unexpected fixture log")
        messages.append(match[3])
    style_messages = ["TRANSPORT_READY", f"STYLE_LOADED attempts=1 tiles=0 reserved={RESERVATION}"]
    rendered = messages == [*style_messages, "FRAME_RENDERED fully=true"]
    if not rendered and (require_render_event or messages != style_messages):
        raise ValueError("App startup, style load or completed frame evidence differs")
    return int(forwarded[1]), rendered


def check_journal(path):
    expected_size = JOURNAL_HEADER.size + JOURNAL_RECORD.size
    data = read_bounded(path, expected_size)
    if len(data) != expected_size:
        raise ValueError("Journal must contain exactly one complete reservation")
    header = data[:JOURNAL_HEADER.size]
    record = data[JOURNAL_HEADER.size:]
    if JOURNAL_HEADER.unpack(header) != (0x54504231, 16, 8, RESERVATION, 65_536, zlib.crc32(header[:-4])):
        raise ValueError("Journal configuration or checksum differs")
    if JOURNAL_RECORD.unpack(record) != (1, 0, RESERVATION, 0, zlib.crc32(record[:-4])):
        raise ValueError("Journal does not contain one style reservation")


def check_render(path):
    data = read_bounded(path, PNG_LIMIT)
    with Image.open(io.BytesIO(data), formats=("PNG",)) as frame:
        width, height = frame.size
        if not (64 <= width <= 4096 and 64 <= height <= 4096 and width * height <= 8_388_608):
            raise ValueError("Unsupported screenshot dimensions")
        if frame.mode not in ("RGB", "RGBA") or frame.n_frames != 1:
            raise ValueError("Screenshot must be a single RGB or RGBA frame")
        frame.load()
        samples = (3, 4, 5, 6, 7)
        matching = 0
        for x in samples:
            for y in samples:
                pixel = frame.getpixel((width * x // 10, height * y // 10))
                if (len(pixel) == 3 or pixel[3] == 255) and all(abs(a - b) <= 3 for a, b in zip(pixel, STYLE_RGB)):
                    matching += 1
        if matching < 24:
            raise ValueError("Screenshot does not show the fixture map background")
        return {"width": width, "height": height, "matchingSamples": matching}


def verify(capture, apk_path, pid, *, require_render_event=False):
    if pid <= 0:
        raise ValueError("Capture requires the positive fixture process ID")
    port, apk_hash = read_apk(apk_path)
    forwarded, rendered = check_logs(capture, port, pid, require_render_event)
    check_journal(capture / "budget.journal")
    frame = check_render(capture / "screen.png")
    return {
        "apkSha256": apk_hash,
        "fixturePort": port,
        "styleResponses": 1,
        "styleBodyBytes": STYLE_BYTES,
        "relayForwardedBytes": forwarded,
        "attempts": 1,
        "tileAttempts": 0,
        "reservedBodyBytes": RESERVATION,
        "renderEventObserved": rendered,
        "renderedFrame": frame,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture", type=Path)
    parser.add_argument("apk", type=Path)
    parser.add_argument("--pid", required=True, type=int)
    parser.add_argument("--require-render-event", action="store_true")
    args = parser.parse_args()
    try:
        result = verify(args.capture, args.apk, args.pid, require_render_event=args.require_render_event)
    except (OSError, ValueError, BadZipFile, Image.DecompressionBombError) as error:
        parser.exit(1, f"Fixture capture failed: {error}\n")
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
