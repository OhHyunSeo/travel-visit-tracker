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
COAST_PLAN = {'id': 'coastal-start-v1', 'startSwipePercent': [63, 45, 38, 45],
              'southSwipePercent': [50, 51, 50, 36], 'northSwipePercent': [50, 36, 50, 60],
              'durationMs': 500}


def return_plan(measured=False):
    from row_return_trial import RETURN_POLICY, MEASURED_RETURN_POLICY
    return {**COAST_PLAN, 'id':'coastal-measured-return-v1' if measured else 'coastal-return-v1',
            'returnPolicy':MEASURED_RETURN_POLICY if measured else RETURN_POLICY}


def samples(directory, name):
    data = read_bounded(directory / name, PNG_LIMIT)
    orange = map_frame(data, product_tab=True, zoom=8)
    blue = map_frame(data, product_tab=True, zoom=9)
    return orange[0], len(orange[1]), len(blue[1])


def verify_row_pan(directory, pid):
    baseline = json.loads(read_bounded(directory / 'restored-source.json', LOG_LIMIT))
    dimensions, orange, blue = samples(directory, 'restored.png')
    returning = False
    measured = False
    if min(orange, blue) < 40:
        raise ValueError('Row pan requires the verified two-tile baseline')
    if (directory / 'row-pan-plan.json').exists() != (directory / 'pan-start').is_dir():
        raise ValueError('Row pan coastal start and plan must be captured together')
    if (directory / 'row-pan-plan.json').exists():
        plan = json.loads(read_bounded(directory / 'row-pan-plan.json', LOG_LIMIT))
        measured = plan == return_plan(measured=True)
        returning = plan == return_plan() or measured
        if plan != COAST_PLAN and not returning:
            raise ValueError('Row pan used a different predeclared coastal plan')
        if measured:
            from product_map_trial import verify_map_log
            verify_map_log(read_bounded(directory/'map-log-before-row-pan.log',LOG_LIMIT),pid,product_tab=True)
            if b'ring buffer is 8 MiB' not in read_bounded(directory/'map-log-capacity.txt',4096):
                raise ValueError('Measured return lacks the dedicated 8MiB log capacity')
        root = directory / 'pan-start'
        start = json.loads(read_bounded(root / 'zoom9-source.json', LOG_LIMIT))
        validate_snapshot(start, baseline, pid)
        verify_settling(root, baseline, pid)
        if (not .08 <= start['center'][0] - baseline['center'][0] <= .16 or
                abs(start['center'][1] - baseline['center'][1]) > 1e-5):
            raise ValueError('Row pan did not reach the predeclared eastern start')
        size, orange, blue = samples(root, 'screen.png')
        if size != dimensions:
            raise ValueError('Coastal start changed the screen dimensions')
        baseline = start
    if min(orange, blue) < 40:
        raise ValueError('Row pan requires the verified two-tile baseline')
    centers = [baseline['center'][1]]
    result = {}
    for phase in (PHASES[:1] if returning else PHASES):
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
    if returning:
        if centers[1] >= centers[0]-1e-5 or result['pan-south']['bottomTileSamples'] < max(300,blue*4):
            raise ValueError('Return trial did not first expose the wider southern tile')
        from row_return_trial import verify_row_return, RETURN_POLICY, MEASURED_RETURN_POLICY
        return {'baselineBottomTileSamples':blue,'viewIdentity':baseline['viewIdentity'],
                'phases':result,'returned':verify_row_return(directory,baseline,pid,MEASURED_RETURN_POLICY if measured else RETURN_POLICY)}
    if not (centers[1] < centers[0] - 1e-5 and centers[2] > centers[0] + 1e-5):
        raise ValueError('Vertical gestures did not move south and north of the baseline')
    south, north = (result[phase] for phase in PHASES)
    if south['bottomTileSamples'] < max(300, blue * 4) or north['topTileSamples'] < 1000 or north['bottomTileSamples'] >= south['bottomTileSamples']:
        raise ValueError('Gestures did not expose a wider southern tile and a northern view')
    return {'baselineBottomTileSamples': blue, 'viewIdentity': baseline['viewIdentity'], 'phases': result}


def capture_settled(command, root, package, activity, pid, baseline, phase='zoom9'):
    if phase not in ('saved', 'zoom9'):
        raise ValueError('Unsupported settled inspection phase')
    records = []
    started = time.monotonic()
    for attempt in range(MAX_FRAMES):
        target = root / 'observations' / f'{attempt:02d}'
        target.mkdir(mode=0o700, parents=True)
        # Remove only the generated snapshot; keep every raw observation on the host.
        command(256, 'exec-out', 'run-as', package, 'rm', '-f', f'files/map-source/{phase}.json')
        capture_source(command, target, phase, package, activity, camera_zoom=9 if phase == 'zoom9' else None)
        require_foreground(command, activity)
        if running_pid(command, package) != pid:
            raise ValueError('Product process changed during the pan gesture')
        write_capture(target / 'screen.png', command(PNG_LIMIT, 'exec-out', 'screencap', '-p'))
        record = observation(target, phase)
        validate_snapshot(record['snapshot'], baseline, pid, phase)
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
              'records': records, 'inspectionPhase':phase, 'cameraReasserted':phase == 'zoom9'}
    write_capture(root / 'settling.json', json.dumps(report, sort_keys=True).encode())
    if not stable:
        raise ValueError('Row pan did not settle within the bounded observation window')
    for name, limit in ((f'{phase}-source.json', LOG_LIMIT), ('screen.png', PNG_LIMIT)):
        write_capture(root / name, read_bounded(target / name, limit))
    return verify_settling(root, baseline, pid, phase)


def capture_row_pan(command, directory, package, activity, pid):
    width, height = samples(directory, 'restored.png')[0]
    baseline = json.loads(read_bounded(directory / 'restored-source.json', LOG_LIMIT))
    # Freeze the prospective plan before any gesture; old captures remain separate.
    write_capture(directory / 'row-pan-plan.json', json.dumps(return_plan(measured=True), sort_keys=True).encode())
    require_foreground(command, activity)
    if running_pid(command, package) != pid:
        raise ValueError('Product process changed before coastal preparation')
    x1,y1,x2,y2 = COAST_PLAN['startSwipePercent']
    command(512, 'shell', 'input', 'swipe', str(width*x1//100), str(height*y1//100),
            str(width*x2//100), str(height*y2//100), str(COAST_PLAN['durationMs']))
    time.sleep(.75)
    start = directory / 'pan-start';start.mkdir(mode=0o700)
    capture_settled(command, start, package, activity, pid, baseline)
    prepared = json.loads(read_bounded(start / 'zoom9-source.json', LOG_LIMIT))
    if (not .08 <= prepared['center'][0] - baseline['center'][0] <= .16 or
            abs(prepared['center'][1] - baseline['center'][1]) > 1e-5):
        raise ValueError('Row pan did not reach the predeclared eastern start')
    report = {'originalRestored': frame_metrics(read_bounded(directory / 'restored.png', PNG_LIMIT)),
              'baseline': frame_metrics(read_bounded(start / 'screen.png', PNG_LIMIT)), 'phases': {}}
    # Stay within the map, above attribution and below the screen header.
    for phase, points in ((PHASES[0], COAST_PLAN['southSwipePercent']),):
        require_foreground(command, activity)
        if running_pid(command, package) != pid:
            raise ValueError('Product process changed before the pan gesture')
        x1,y1,x2,y2 = points
        command(512, 'shell', 'input', 'swipe', str(width*x1//100), str(height*y1//100),
                str(width*x2//100), str(height*y2//100), str(COAST_PLAN['durationMs']))
        time.sleep(.75)
        root = directory / phase
        root.mkdir(mode=0o700)
        report['phases'][phase] = capture_settled(command, root, package, activity, pid, prepared)
    from row_return_trial import capture_row_return, MEASURED_RETURN_POLICY
    report['returned'] = capture_row_return(command,directory,package,activity,pid,prepared,(width,height),MEASURED_RETURN_POLICY)
    # Overlay counts are diagnostic only; the acceptance below still counts bare raster.
    write_capture(directory / 'row-pan-observations.json', json.dumps(report, sort_keys=True).encode())
    return verify_row_pan(directory, pid)
