"""Keep bounded, repeatable pan observations separate from raster acceptance."""

import hashlib
import io
import json
import math

from PIL import Image

from product_map_frames import map_frame
from verify_device_capture import LOG_LIMIT, PNG_LIMIT, read_bounded


STABLE_FRAMES = 3
MAX_FRAMES = 6
INTERVAL_SECONDS = .5
CENTER_TOLERANCE = 1e-7


def frame_metrics(data):
    size, orange, _, _ = map_frame(data, product_tab=True, zoom=8)
    _, blue, _, _ = map_frame(data, product_tab=True, zoom=9)
    overlay = {(203, 91, 49): 0, (52, 117, 195): 0}
    digest = hashlib.sha256()
    with Image.open(io.BytesIO(data)) as frame:
        width, height = size
        for y in range(height * 22 // 100, height * 86 // 100, 4):
            for x in range(width * 12 // 100, width * 88 // 100, 4):
                pixel = frame.getpixel((x, y))
                digest.update(bytes(pixel[:3]))
                if len(pixel) == 4 and pixel[3] != 255:
                    continue
                for color in overlay:
                    if all(abs(component - expected) <= 3 for component, expected in zip(pixel, color)):
                        overlay[color] += 1
    return {'dimensions': list(size), 'topTileSamples': len(orange), 'bottomTileSamples': len(blue),
            'topOverlaySamples': overlay[(203, 91, 49)], 'bottomOverlaySamples': overlay[(52, 117, 195)],
            'sampleGridSha256': digest.hexdigest()}


def observation(root):
    snapshot = json.loads(read_bounded(root / 'zoom9-source.json', LOG_LIMIT))
    return {'snapshot': snapshot, 'frame': frame_metrics(read_bounded(root / 'screen.png', PNG_LIMIT))}


def validate_snapshot(snapshot, baseline, pid):
    center = snapshot.get('center')
    bounds = baseline['source']['bounds']
    if (snapshot.get('pid') != pid or snapshot.get('phase') != 'zoom9' or
            snapshot.get('connected') is not False or snapshot.get('viewIdentity') != baseline['viewIdentity'] or
            snapshot.get('source') != baseline['source'] or snapshot.get('zoom') != 9 or
            not isinstance(center, list) or len(center) != 2 or
            any(type(value) not in (int, float) or not math.isfinite(value) for value in center) or
            not bounds[0] <= center[0] <= bounds[2] or not bounds[1] <= center[1] <= bounds[3]):
        raise ValueError('Row pan changed the process, renderer, source or allowed camera')


def stable_tail(records):
    if len(records) < STABLE_FRAMES:
        return False
    tail = records[-STABLE_FRAMES:]
    first = tail[0]
    return all(record['frame'] == first['frame'] and
               all(math.isclose(value, expected, rel_tol=0, abs_tol=CENTER_TOLERANCE)
                   for value, expected in zip(record['snapshot']['center'], first['snapshot']['center']))
               for record in tail[1:])


def verify_settling(root, baseline, pid):
    report = json.loads(read_bounded(root / 'settling.json', LOG_LIMIT))
    attempts = report.get('attempts')
    if (type(attempts) is not int or not STABLE_FRAMES <= attempts <= MAX_FRAMES or
            report.get('stable') is not True or report.get('selectedAttempt') != attempts - 1):
        raise ValueError('Row pan has no bounded settled observation')
    records = [observation(root / 'observations' / f'{index:02d}') for index in range(attempts)]
    for record in records:
        validate_snapshot(record['snapshot'], baseline, pid)
    if not stable_tail(records):
        raise ValueError('Row pan did not settle across three consecutive observations')
    final = root / 'observations' / f'{attempts - 1:02d}'
    for name, limit in (('zoom9-source.json', LOG_LIMIT), ('screen.png', PNG_LIMIT)):
        if read_bounded(root / name, limit) != read_bounded(final / name, limit):
            raise ValueError('Row pan selected a different frame from the settled observation')
    return {'attempts': attempts, 'stableFrames': STABLE_FRAMES, **records[-1]['frame']}
