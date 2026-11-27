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
MIDPOINT_LONGITUDE = 128.50427174022053
MIDPOINT_TOLERANCE_PX = 4
COAST_DIMENSIONS = (720, 1280)
# A 145.71px target plus the 21.96px median input-to-motion difference
# from the three 180px swipes gives a single prospective 168px input.
MIDPOINT_PREPARATION_SWIPE = (453, 576, 285, 576, 500)
MIDPOINT_RESPONSE_SHA256 = '6d9f4b076c022ba19b83ad186fd61f099a1277c2475b759739c11c154951da63'
# Signed finger travel and inclusive error magnitudes from the independent
# rn-horizontal-small-pan.iTC0TJ9j replay. The smallest applicable input wins.
MIDPOINT_CORRECTION_RANGES = (
    (-12, 4, 7.0371093699359335), (12, 4, 7.326171852299012),
    (-16, 4.249999968043994, 11.274414035957307), (16, 4, 11.294921693741344),
)


def return_plan(measured=False, *, midpoint=False):
    from row_return_trial import RETURN_POLICY, MEASURED_RETURN_POLICY, OBSERVED_RETURN_RANGE
    if midpoint:
        return {**COAST_PLAN, 'id': 'coastal-midpoint-return-v1',
                'returnPolicy': MEASURED_RETURN_POLICY,
                'startLongitude': MIDPOINT_LONGITUDE, 'startTolerancePixels': MIDPOINT_TOLERANCE_PX,
                'dimensions': list(COAST_DIMENSIONS), 'observedReturnRange': OBSERVED_RETURN_RANGE}
    return {**COAST_PLAN, 'id':'coastal-measured-return-v1' if measured else 'coastal-return-v1',
            'returnPolicy':MEASURED_RETURN_POLICY if measured else RETURN_POLICY}


def midpoint_preparation_plan():
    plan = return_plan(midpoint=True)
    del plan['startSwipePercent']
    return {**plan, 'id': 'coastal-midpoint-shorter-prep-v1',
            'startSwipePixels': list(MIDPOINT_PREPARATION_SWIPE)}


def midpoint_correction_plan():
    return {**midpoint_preparation_plan(), 'id': 'coastal-midpoint-single-correction-v1',
            'correctionEvidenceSha256': MIDPOINT_RESPONSE_SHA256,
            'correctionRanges': [{'fingerX': finger, 'applicableErrorMagnitudePixels': [low, high]}
                                 for finger, low, high in MIDPOINT_CORRECTION_RANGES],
            'maxPreparationCorrections': 1}


def midpoint_longitude_matches(longitude):
    from row_return_trial import RETURN_POLICY
    degrees = MIDPOINT_TOLERANCE_PX * 360 / RETURN_POLICY['worldPixels']
    return MIDPOINT_LONGITUDE - degrees <= longitude <= MIDPOINT_LONGITUDE + degrees


def midpoint_preparation_decision(start):
    from row_return_trial import RETURN_POLICY
    longitude = start['center'][0]
    error = (longitude - MIDPOINT_LONGITUDE) * RETURN_POLICY['worldPixels'] / 360
    if midpoint_longitude_matches(longitude):
        return {'firstErrorXPixels': error, 'action': 'already-in-range', 'gesture': None}
    for finger, low, high in MIDPOINT_CORRECTION_RANGES:
        if finger * error > 0 and low <= abs(error) <= high:
            return {'firstErrorXPixels': error, 'action': 'single-correction',
                    'gesture': [360, 614, 360 + finger, 614, COAST_PLAN['durationMs']]}
    return {'firstErrorXPixels': error, 'action': 'outside-calibration', 'gesture': None}


def require_calibrated_preparation(decision):
    if decision['action'] == 'outside-calibration':
        raise ValueError(f'Midpoint preparation outside measured correction ranges '
                         f'(X error {decision["firstErrorXPixels"]:+.6f}px)')


def check_coastal_start(start, baseline, dimensions, *, midpoint):
    longitude, latitude = start['center']
    base_longitude, base_latitude = baseline['center']
    if not .08 <= longitude - base_longitude <= .16 or abs(latitude - base_latitude) > 1e-5:
        raise ValueError('Row pan did not reach the predeclared eastern start')
    if midpoint:
        if dimensions != COAST_DIMENSIONS:
            raise ValueError('Midpoint return requires a 720×1280 capture')
        if not midpoint_longitude_matches(longitude):
            raise ValueError(f'Midpoint start condition not met (longitude {longitude:.12f}°)')


def samples(directory, name):
    data = read_bounded(directory / name, PNG_LIMIT)
    orange = map_frame(data, product_tab=True, zoom=8)
    blue = map_frame(data, product_tab=True, zoom=9)
    return orange[0], len(orange[1]), len(blue[1])


def verify_row_pan(directory, pid, *, require_midpoint=False):
    baseline = json.loads(read_bounded(directory / 'restored-source.json', LOG_LIMIT))
    dimensions, orange, blue = samples(directory, 'restored.png')
    returning = False
    measured = midpoint = False
    preparation = None
    if min(orange, blue) < 40:
        raise ValueError('Row pan requires the verified two-tile baseline')
    plan_path = directory / 'row-pan-plan.json'
    recorded_start = (directory / 'pan-start').is_dir() or (directory / 'pan-preparation').is_dir()
    if plan_path.exists() != recorded_start:
        raise ValueError('Row pan coastal start and plan must be captured together')
    if plan_path.exists():
        plan = json.loads(read_bounded(plan_path, LOG_LIMIT))
        single_correction = plan == midpoint_correction_plan()
        shorter_preparation = single_correction or plan == midpoint_preparation_plan()
        midpoint = shorter_preparation or plan == return_plan(midpoint=True)
        measured = midpoint or plan == return_plan(measured=True)
        returning = plan == return_plan() or measured
        if plan != COAST_PLAN and not returning:
            raise ValueError('Row pan used a different predeclared coastal plan')
        if measured:
            from product_map_trial import verify_map_log
            verify_map_log(read_bounded(directory/'map-log-before-row-pan.log',LOG_LIMIT),pid,product_tab=True)
            if b'ring buffer is 8 MiB' not in read_bounded(directory/'map-log-capacity.txt',4096):
                raise ValueError('Measured return lacks the dedicated 8MiB log capacity')
        root = directory / 'pan-start'
        if shorter_preparation:
            first_root = directory / 'pan-preparation' if single_correction else root
            recorded_swipe = json.loads(read_bounded(first_root / 'gesture.json', LOG_LIMIT))
            if recorded_swipe != plan['startSwipePixels']:
                raise ValueError('Midpoint preparation swipe differs from the predeclared plan')
        if single_correction:
            first = json.loads(read_bounded(first_root / 'zoom9-source.json', LOG_LIMIT))
            verify_settling(first_root, baseline, pid)
            check_coastal_start(first, baseline, dimensions, midpoint=False)
            preparation = midpoint_preparation_decision(first)
            if json.loads(read_bounded(first_root / 'correction-decision.json', LOG_LIMIT)) != preparation:
                raise ValueError('Midpoint correction differs from the measured selection')
            require_calibrated_preparation(preparation)
        start = json.loads(read_bounded(root / 'zoom9-source.json', LOG_LIMIT))
        validate_snapshot(start, baseline, pid)
        verify_settling(root, baseline, pid)
        check_coastal_start(start, baseline, dimensions, midpoint=midpoint)
        size, orange, blue = samples(root, 'screen.png')
        if size != dimensions:
            raise ValueError('Coastal start changed the screen dimensions')
        baseline = start
    if require_midpoint and not midpoint:
        raise ValueError('Expected the predeclared midpoint return plan')
    if min(orange, blue) < 40:
        raise ValueError('Row pan requires the verified two-tile baseline')
    centers = [baseline['center'][1]]
    result = {}
    for phase in (PHASES[:1] if returning else PHASES):
        root = directory / phase
        snapshot = json.loads(read_bounded(root / 'zoom9-source.json', LOG_LIMIT))
        validate_snapshot(snapshot, baseline, pid)
        center = snapshot['center']
        if midpoint or (root / 'settling.json').exists():
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
        returned = verify_row_return(directory, baseline, pid, MEASURED_RETURN_POLICY if measured else RETURN_POLICY,
                                     observed_only=midpoint)
        report = {'baselineBottomTileSamples': blue, 'viewIdentity': baseline['viewIdentity'],
                  'phases': result, 'returned': returned}
        if preparation is not None:
            report['preparation'] = preparation
        return report
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


def capture_row_pan(command, directory, package, activity, pid, *, midpoint=False):
    width, height = samples(directory, 'restored.png')[0]
    if midpoint and (width, height) != COAST_DIMENSIONS:
        raise ValueError('Midpoint return requires a 720×1280 capture')
    baseline = json.loads(read_bounded(directory / 'restored-source.json', LOG_LIMIT))
    # Freeze the prospective plan before any gesture; old captures remain separate.
    plan = midpoint_correction_plan() if midpoint else return_plan(measured=True)
    write_capture(directory / 'row-pan-plan.json', json.dumps(plan, sort_keys=True).encode())
    require_foreground(command, activity)
    if running_pid(command, package) != pid:
        raise ValueError('Product process changed before coastal preparation')
    start = directory / 'pan-start'
    first_root = directory / 'pan-preparation' if midpoint else start
    first_root.mkdir(mode=0o700)
    if midpoint:
        swipe = plan['startSwipePixels']
        write_capture(first_root / 'gesture.json', json.dumps(swipe).encode())
    else:
        x1, y1, x2, y2 = plan['startSwipePercent']
        swipe = [width*x1//100, height*y1//100, width*x2//100, height*y2//100, plan['durationMs']]
    command(512, 'shell', 'input', 'swipe', *map(str, swipe))
    time.sleep(.75)
    capture_settled(command, first_root, package, activity, pid, baseline)
    if midpoint:
        first = json.loads(read_bounded(first_root / 'zoom9-source.json', LOG_LIMIT))
        check_coastal_start(first, baseline, (width, height), midpoint=False)
        decision = midpoint_preparation_decision(first)
        write_capture(first_root / 'correction-decision.json', json.dumps(decision, sort_keys=True).encode())
        require_calibrated_preparation(decision)
        if decision['gesture'] is not None:
            require_foreground(command, activity)
            if running_pid(command, package) != pid:
                raise ValueError('Product process changed before midpoint correction')
            command(512, 'shell', 'input', 'swipe', *map(str, decision['gesture']))
            time.sleep(.75)
        start.mkdir(mode=0o700)
        capture_settled(command, start, package, activity, pid, baseline)
    prepared = json.loads(read_bounded(start / 'zoom9-source.json', LOG_LIMIT))
    check_coastal_start(prepared, baseline, (width, height), midpoint=midpoint)
    if midpoint and min(samples(start, 'screen.png')[1:]) < 40:
        raise ValueError('Row pan requires the verified two-tile baseline')
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
    if midpoint:
        south = json.loads(read_bounded(root / 'zoom9-source.json', LOG_LIMIT))
        southern = report['phases']['pan-south']
        if (southern['dimensions'] != [width, height] or south['center'][1] >= prepared['center'][1] - 1e-5 or
                southern['topTileSamples'] < 40 or
                southern['bottomTileSamples'] < max(300, report['baseline']['bottomTileSamples'] * 4)):
            raise ValueError('Return trial did not first expose the wider southern tile')
    from row_return_trial import capture_row_return, MEASURED_RETURN_POLICY
    report['returned'] = capture_row_return(command,directory,package,activity,pid,prepared,(width,height),MEASURED_RETURN_POLICY,
                                            observed_only=midpoint)
    # Overlay counts are diagnostic only; the acceptance below still counts bare raster.
    write_capture(directory / 'row-pan-observations.json', json.dumps(report, sort_keys=True).encode())
    return verify_row_pan(directory, pid, require_midpoint=midpoint)
