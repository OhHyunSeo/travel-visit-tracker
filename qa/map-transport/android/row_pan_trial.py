"""Observe cached tile rows after bounded vertical gestures in the existing QA APK."""

import json
import math
from pathlib import Path
import time

from product_map_frames import map_frame
from product_map_sources import capture_source
from verify_device_capture import LOG_LIMIT, PNG_LIMIT, read_bounded
from capture_device import require_foreground, running_pid, write_capture


PHASES = ('pan-south', 'pan-north')


def samples(directory, name):
    data = read_bounded(directory / name, PNG_LIMIT)
    orange = map_frame(data, product_tab=True, zoom=8)
    blue = map_frame(data, product_tab=True, zoom=9)
    return orange[0], len(orange[1]), len(blue[1])


def verify_row_pan(directory, pid):
    baseline = json.loads(read_bounded(directory / 'restored-source.json', LOG_LIMIT))
    dimensions, orange, blue = samples(directory, 'restored.png')
    if min(orange, blue) < 40:
        raise ValueError('Row pan requires the verified two-tile baseline')
    centers = [baseline['center'][1]]
    result = {}
    bounds = baseline['source']['bounds']
    for phase in PHASES:
        root = directory / phase
        snapshot = json.loads(read_bounded(root / 'zoom9-source.json', LOG_LIMIT))
        center = snapshot.get('center')
        if (snapshot.get('pid') != pid or snapshot.get('phase') != 'zoom9' or
                snapshot.get('connected') is not False or snapshot.get('viewIdentity') != baseline['viewIdentity'] or
                snapshot.get('source') != baseline['source'] or snapshot.get('zoom') != 9 or
                not isinstance(center, list) or len(center) != 2 or
                any(type(value) not in (int, float) or not math.isfinite(value) for value in center) or
                not bounds[0] <= center[0] <= bounds[2] or not bounds[1] <= center[1] <= bounds[3]):
            raise ValueError('Row pan changed the process, renderer, source or allowed camera')
        size, top, bottom = samples(root, 'screen.png')
        if size != dimensions or top < 40:
            raise ValueError('Row pan lost the cached northern tile')
        centers.append(center[1])
        result[phase] = {'latitude': center[1], 'topTileSamples': top, 'bottomTileSamples': bottom}
    if not (centers[1] < centers[0] - 1e-5 and centers[2] > centers[0] + 1e-5):
        raise ValueError('Vertical gestures did not move south and north of the baseline')
    south, north = (result[phase] for phase in PHASES)
    if south['bottomTileSamples'] < max(300, blue * 4) or north['topTileSamples'] < 1000 or north['bottomTileSamples'] >= south['bottomTileSamples']:
        raise ValueError('Gestures did not expose a wider southern tile and a northern view')
    return {'baselineBottomTileSamples': blue, 'viewIdentity': baseline['viewIdentity'], 'phases': result}


def capture_row_pan(command, directory, package, activity, pid):
    width, height = samples(directory, 'restored.png')[0]
    # Stay within the map, above attribution and below the screen header.
    x = str(width // 2)
    for phase, start, end in ((PHASES[0], 51, 36), (PHASES[1], 36, 60)):
        require_foreground(command, activity)
        if running_pid(command, package) != pid:
            raise ValueError('Product process changed before the pan gesture')
        command(512, 'shell', 'input', 'swipe', x, str(height * start // 100), x, str(height * end // 100), '500')
        time.sleep(.75)
        root = directory / phase
        root.mkdir(mode=0o700)
        # Only this generated QA snapshot is replaced; the host keeps each observation.
        command(256, 'exec-out', 'run-as', package, 'rm', '-f', 'files/map-source/zoom9.json')
        capture_source(command, root, 'zoom9', package, activity, camera_zoom=9)
        require_foreground(command, activity)
        if running_pid(command, package) != pid:
            raise ValueError('Product process changed during the pan gesture')
        write_capture(root / 'screen.png', command(PNG_LIMIT, 'exec-out', 'screencap', '-p'))
    return verify_row_pan(directory, pid)
