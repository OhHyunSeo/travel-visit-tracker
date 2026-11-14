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
RASTER_TILE_RGB = (217, 93, 47)
APP_LOG = re.compile(
    r"\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+(\d+)\s+\d+\s+([A-Z])\s+TripMapSdkFixture:\s*(.*)"
)
JOURNAL_HEADER = struct.Struct(">IIIIQI")
JOURNAL_RECORD = struct.Struct(">IIQII")
FRAME_EVENT = "FRAME_RENDERED fully=true"


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


def check_transport_logs(capture, port, *, raster_tile=False):
    server = read_bounded(capture / "server.log", LOG_LIMIT).decode().splitlines()
    if raster_tile:
        if len(server) != 3 or server[0] != f"STYLE_SERVER_READY port={port}":
            raise ValueError("Expected one style and one tile in the server log")
        style = re.fullmatch(r"SERVED_STYLE bytes=([1-9][0-9]{0,3})", server[1])
        tile = re.fullmatch(r"SERVED_TILE path=/resource/tile/0_0_0 bytes=([1-9][0-9]{0,3})", server[2])
        if not style or not tile:
            raise ValueError("Server did not record the expected zoom-zero tile after the style")
        style_bytes, tile_bytes = int(style[1]), int(tile[1])
        if max(style_bytes, tile_bytes) > RESERVATION:
            raise ValueError("A synthetic response exceeded its reservation")
    elif server == [f"STYLE_SERVER_READY port={port}", f"SERVED_STYLE bytes={STYLE_BYTES}"]:
        style_bytes, tile_bytes = STYLE_BYTES, 0
    else:
        raise ValueError("Server must record one matching fixture style response")

    relay = read_bounded(capture / "relay.log", LOG_LIMIT).decode().splitlines()
    if len(relay) != 2 or relay[0] != f"RELAY_READY port={port}":
        raise ValueError("Relay must record one ready and completed connection")
    pattern = r"RELAY_COMPLETE connections=2 forwarded=([0-9]{1,6})" if raster_tile else r"RELAY_COMPLETE forwarded=([0-9]{1,6})"
    forwarded = re.fullmatch(pattern, relay[1])
    connections = 2 if raster_tile else 1
    if not forwarded or not style_bytes + tile_bytes < int(forwarded[1]) <= connections * 2 * 65_536:
        raise ValueError("Invalid completed relay byte count")
    return style_bytes, tile_bytes, int(forwarded[1])


def check_app_log(log, pid, require_render_event, *, raster_tile=False):
    messages = []
    for line in log.decode().splitlines():
        if "TripMapSdkFixture:" not in line:
            continue
        match = APP_LOG.fullmatch(line)
        if not match or int(match[1]) != pid or match[2] != "I":
            raise ValueError("App capture includes a failed or unexpected fixture log")
        messages.append(match[3])
    style_messages = ["TRANSPORT_READY", f"STYLE_LOADED attempts=1 tiles=0 reserved={RESERVATION}"]
    if raster_tile:
        if len(messages) != 3 or messages[0] != "TRANSPORT_READY" or messages[2] != FRAME_EVENT or messages[1] not in (
            style_messages[1], f"STYLE_LOADED attempts=2 tiles=1 reserved={2 * RESERVATION}",
        ):
            raise ValueError("Raster run lacks style and complete-frame evidence")
        return True
    rendered = messages == [*style_messages, FRAME_EVENT]
    if not rendered and (require_render_event or messages != style_messages):
        raise ValueError("App startup, style load or completed frame evidence differs")
    return rendered


def check_journal(path, *, raster_tile=False):
    expected_size = JOURNAL_HEADER.size + JOURNAL_RECORD.size * (2 if raster_tile else 1)
    data = read_bounded(path, expected_size)
    if len(data) != expected_size:
        raise ValueError("Journal must contain exactly one complete reservation")
    header = data[:JOURNAL_HEADER.size]
    record = data[JOURNAL_HEADER.size:JOURNAL_HEADER.size + JOURNAL_RECORD.size]
    if JOURNAL_HEADER.unpack(header) != (0x54504231, 16, 8, RESERVATION, 65_536, zlib.crc32(header[:-4])):
        raise ValueError("Journal configuration or checksum differs")
    if JOURNAL_RECORD.unpack(record) != (1, 0, RESERVATION, 0, zlib.crc32(record[:-4])):
        raise ValueError("Journal does not contain one style reservation")
    if raster_tile:
        tile = data[-JOURNAL_RECORD.size:]
        if JOURNAL_RECORD.unpack(tile) != (2, 1, 2 * RESERVATION, 1, zlib.crc32(tile[:-4])):
            raise ValueError("Journal does not contain one tile reservation after the style")


def check_render(path, *, raster_tile=False):
    data = read_bounded(path, PNG_LIMIT)
    with Image.open(io.BytesIO(data), formats=("PNG",)) as frame:
        width, height = frame.size
        if not (64 <= width <= 4096 and 64 <= height <= 4096 and width * height <= 8_388_608):
            raise ValueError("Unsupported screenshot dimensions")
        if frame.mode not in ("RGB", "RGBA") or frame.n_frames != 1:
            raise ValueError("Screenshot must be a single RGB or RGBA frame")
        frame.load()
        samples = (42, 46, 50, 54, 58) if raster_tile else (30, 40, 50, 60, 70)
        expected_rgb = RASTER_TILE_RGB if raster_tile else STYLE_RGB
        matching = 0
        for x in samples:
            for y in samples:
                pixel = frame.getpixel((width * x // 100, height * y // 100))
                if (len(pixel) == 3 or pixel[3] == 255) and all(abs(a - b) <= 3 for a, b in zip(pixel, expected_rgb)):
                    matching += 1
        if matching < 24:
            raise ValueError("Screenshot does not show the expected synthetic raster tile" if raster_tile
                             else "Screenshot does not show the fixture map background")
        return {"width": width, "height": height, "matchingSamples": matching}


def verify(capture, apk_path, pid, *, require_render_event=False, raster_tile=False):
    if pid <= 0:
        raise ValueError("Capture requires the positive fixture process ID")
    port, apk_hash = read_apk(apk_path)
    style_bytes, tile_bytes, forwarded = check_transport_logs(capture, port, raster_tile=raster_tile)
    rendered = check_app_log(read_bounded(capture / "app.log", LOG_LIMIT), pid, require_render_event, raster_tile=raster_tile)
    check_journal(capture / "budget.journal", raster_tile=raster_tile)
    frame = check_render(capture / "screen.png", raster_tile=raster_tile)
    result = {
        "apkSha256": apk_hash,
        "fixturePort": port,
        "styleResponses": 1,
        "styleBodyBytes": style_bytes,
        "relayForwardedBytes": forwarded,
        "attempts": 2 if raster_tile else 1,
        "tileAttempts": 1 if raster_tile else 0,
        "reservedBodyBytes": RESERVATION * (2 if raster_tile else 1),
        "renderEventObserved": rendered,
        "renderedFrame": frame,
    }
    if raster_tile:
        result.update(tileResponses=1, tileBodyBytes=tile_bytes, tilePath="/resource/tile/0_0_0")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture", type=Path)
    parser.add_argument("apk", type=Path)
    parser.add_argument("--pid", required=True, type=int)
    parser.add_argument("--require-render-event", action="store_true")
    parser.add_argument("--raster-tile", action="store_true")
    args = parser.parse_args()
    try:
        result = verify(args.capture, args.apk, args.pid, require_render_event=args.require_render_event,
                        raster_tile=args.raster_tile)
    except (OSError, ValueError, BadZipFile, Image.DecompressionBombError) as error:
        parser.exit(1, f"Fixture capture failed: {error}\n")
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
