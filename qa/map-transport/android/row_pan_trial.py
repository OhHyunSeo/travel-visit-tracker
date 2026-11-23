"""Observe cached tile rows after bounded vertical gestures in the existing QA APK."""

import json
import time

from product_map_frames import map_frame
from product_map_sources import capture_source
from verify_device_capture import LOG_LIMIT, PNG_LIMIT, read_bounded
from capture_device import require_foreground, running_pid, write_capture
from row_pan_observations import (INTERVAL_SECONDS, MAX_FRAMES, STABLE_FRAMES, frame_metrics,
                                  observation, stable_tail, validate_snapshot, verify_settling)


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
    for phase in PHASES:
        root = directory / phase
        snapshot = json.loads(read_bounded(root / 'zoom9-source.json', LOG_LIMIT))
        validate_snapshot(snapshot, baseline, pid)
        center = snapshot['center']
        if (root / 'settling.json').exists():
            verify_settling(root, baseline, pid)
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


def capture_settled(command, root, package, activity, pid, baseline):
    records = []
    started = time.monotonic()
    for attempt in range(MAX_FRAMES):
        target = root / 'observations' / f'{attempt:02d}'
        target.mkdir(mode=0o700, parents=True)
        # Remove only the generated snapshot; keep every raw observation on the host.
        command(256, 'exec-out', 'run-as', package, 'rm', '-f', 'files/map-source/zoom9.json')
        capture_source(command, target, 'zoom9', package, activity, camera_zoom=9)
        require_foreground(command, activity)
        if running_pid(command, package) != pid:
            raise ValueError('Product process changed during the pan gesture')
        write_capture(target / 'screen.png', command(PNG_LIMIT, 'exec-out', 'screencap', '-p'))
        record = observation(target)
        validate_snapshot(record['snapshot'], baseline, pid)
        records.append(record)
        if stable_tail(records):
            break
        if attempt < MAX_FRAMES - 1:
            time.sleep(INTERVAL_SECONDS)
    stable = stable_tail(records)
    report = {'attempts': len(records), 'stable': stable,
              'selectedAttempt': len(records) - 1 if stable else None,
              'requiredStableFrames': STABLE_FRAMES, 'maximumFrames': MAX_FRAMES,
              'minimumIntervalSeconds': INTERVAL_SECONDS, 'elapsedSeconds': time.monotonic() - started,
              'records': records}
    write_capture(root / 'settling.json', json.dumps(report, sort_keys=True).encode())
    if not stable:
        raise ValueError('Row pan did not settle within the bounded observation window')
    for name, limit in (('zoom9-source.json', LOG_LIMIT), ('screen.png', PNG_LIMIT)):
        write_capture(root / name, read_bounded(target / name, limit))
    return verify_settling(root, baseline, pid)


def capture_row_pan(command, directory, package, activity, pid):
    width, height = samples(directory, 'restored.png')[0]
    baseline = json.loads(read_bounded(directory / 'restored-source.json', LOG_LIMIT))
    report = {'baseline': frame_metrics(read_bounded(directory / 'restored.png', PNG_LIMIT)), 'phases': {}}
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
        report['phases'][phase] = capture_settled(command, root, package, activity, pid, baseline)
    # Overlay counts are diagnostic only; the acceptance below still counts bare raster.
    write_capture(directory / 'row-pan-observations.json', json.dumps(report, sort_keys=True).encode())
    return verify_row_pan(directory, pid)
