"""Measure fixed small inputs before and after a camera-zoom reassertion."""

import json
import time

from product_map_frames import map_frame
from capture_device import require_foreground, running_pid, write_capture
from row_pan_trial import (COAST_DIMENSIONS, COAST_PLAN, MIDPOINT_LONGITUDE,
                           MIDPOINT_PREPARATION_SWIPE, MIDPOINT_TOLERANCE_PX, capture_settled)
from row_pan_observations import verify_settling
from row_return_trial import world
from verify_device_capture import LOG_LIMIT, PNG_LIMIT, read_bounded


STEPS = [('control',0), ('up10',-10), ('down10',10), ('up12',-12),
         ('down12',12), ('up16',-16), ('down16',16)]
PLAN = {'id':'small-pan-observers-v1', 'coastalPreparation':COAST_PLAN['startSwipePercent'],
        'durationMs':500, 'waitAfterInputSeconds':.75, 'steps':[list(step) for step in STEPS],
        'passivePhase':'saved', 'reassertPhase':'zoom9', 'worldPixels':524288}
HORIZONTAL_STEPS = [('control', 0), ('left12', -12), ('right12', 12), ('left16', -16), ('right16', 16),
                    ('right16-repeat', 16), ('left16-repeat', -16),
                    ('right12-repeat', 12), ('left12-repeat', -12), ('control-after', 0)]
HORIZONTAL_PLAN = {**PLAN, 'id': 'horizontal-small-pan-observers-v1',
                   'coastalPreparation': list(MIDPOINT_PREPARATION_SWIPE),
                   'steps': [list(step) for step in HORIZONTAL_STEPS],
                   'axis': 'X', 'observationRadiusPixels': 32,
                   'maximumObserverDriftPixels': .25, 'latitudeToleranceDegrees': 1e-5,
                   'minimumResponsePixels': .5, 'maximumRepeatSpreadPixels': 2,
                   'startTolerancePixels': MIDPOINT_TOLERANCE_PX}


def gesture(dimensions, delta, *, horizontal=False):
    width,height = dimensions
    x,y = width//2,height*48//100
    if delta == 0:
        return None
    return [x, y, x + delta if horizontal else x, y if horizontal else y + delta, PLAN['durationMs']]


def snapshot(root, phase):
    return json.loads(read_bounded(root/f'{phase}-source.json',LOG_LIMIT))


def displacement(before, after):
    return [first-last for first,last in zip(world(before['center']),world(after['center']))]


def check_horizontal_location(snapshot, reference):
    longitude, latitude = snapshot['center']
    error_x = (longitude - MIDPOINT_LONGITUDE) * PLAN['worldPixels'] / 360
    if (abs(error_x) > HORIZONTAL_PLAN['observationRadiusPixels'] or
            abs(latitude - reference['center'][1]) > HORIZONTAL_PLAN['latitudeToleranceDegrees']):
        raise ValueError(f'Horizontal observer left its midpoint neighborhood (X error {error_x:.6f}px)')


def horizontal_corrections(rows):
    noise = HORIZONTAL_PLAN['maximumObserverDriftPixels']
    if any(max(map(abs, row['reassertScreenDelta'])) > noise or
           (row['fingerX'] == 0 and max(map(abs, row['passiveScreenDelta'])) > noise) for row in rows):
        return []
    candidates = []
    for finger in (-12, 12, -16, 16):
        movements = [row['passiveScreenDelta'][0] * (1 if finger > 0 else -1)
                     for row in rows if row['fingerX'] == finger]
        if len(movements) != 2 or min(movements) < HORIZONTAL_PLAN['minimumResponsePixels']:
            continue
        low, high = min(movements), max(movements)
        if high - low > HORIZONTAL_PLAN['maximumRepeatSpreadPixels']:
            continue
        tolerance = HORIZONTAL_PLAN['startTolerancePixels']
        candidates.append({'fingerX': finger, 'measuredResponsePixels': [low, high],
                           'applicableErrorMagnitudePixels': [max(tolerance, high + noise - tolerance),
                                                              low - noise + tolerance]})
    return candidates


def verify_small_pan(directory, pid, *, horizontal=False):
    plan = HORIZONTAL_PLAN if horizontal else PLAN
    steps = HORIZONTAL_STEPS if horizontal else STEPS
    if json.loads(read_bounded(directory/'small-pan-plan.json',LOG_LIMIT)) != plan:
        raise ValueError('Small-input plan differs from the predeclared sequence')
    baseline=snapshot(directory/'small-pan-start','zoom9')
    original=snapshot(directory,'restored')
    verify_settling(directory/'small-pan-start',original,pid)
    if (not .08 <= baseline['center'][0]-original['center'][0] <= .16 or
            abs(baseline['center'][1]-original['center'][1]) > 1e-5):
        raise ValueError('Small-input trial did not reach its coastal start')
    dimensions=map_frame(read_bounded(directory/'restored.png',PNG_LIMIT),product_tab=True,zoom=9)[0]
    if horizontal:
        if dimensions != COAST_DIMENSIONS:
            raise ValueError('Horizontal observer requires a 720×1280 capture')
        check_horizontal_location(baseline, original)
        if json.loads(read_bounded(directory/'small-pan-start/gesture.json',LOG_LIMIT)) != plan['coastalPreparation']:
            raise ValueError('Horizontal preparation differs from the predeclared swipe')
    rows=[]
    for index,(label,delta) in enumerate(steps):
        root=directory/'small-pan'/f'{index:02d}-{label}'
        if json.loads(read_bounded(root/'gesture.json',LOG_LIMIT)) != gesture(dimensions,delta,horizontal=horizontal):
            raise ValueError('Small-input gesture differs from the fixed distance or duration')
        records={}
        for name,phase in (('before-passive','saved'),('after-passive','saved'),('after-zoom9','zoom9')):
            checked=verify_settling(root/name,baseline,pid,phase)
            if checked['dimensions'] != list(dimensions) or min(checked['topTileSamples'],checked['bottomTileSamples']) < 40:
                raise ValueError('Small-input screenshot lost its dimensions or either cached tile')
            records[name]=snapshot(root/name,phase)
            if horizontal:
                check_horizontal_location(records[name], original)
        row = {'step':label,'fingerX' if horizontal else 'fingerY':delta,
               'passiveScreenDelta':displacement(records['before-passive'],records['after-passive']),
               'reassertScreenDelta':displacement(records['after-passive'],records['after-zoom9'])}
        if horizontal:
            row['centers'] = {name: record['center'] for name, record in records.items()}
        rows.append(row)
    result = {'planId':plan['id'],'observationsOnly':True,'steps':rows}
    if horizontal:
        result['correctionCandidates'] = horizontal_corrections(rows)
    return result


def capture_small_pan(command,directory,package,activity,pid, *, horizontal=False):
    plan = HORIZONTAL_PLAN if horizontal else PLAN
    steps = HORIZONTAL_STEPS if horizontal else STEPS
    write_capture(directory/'small-pan-plan.json',json.dumps(plan,sort_keys=True).encode())
    original=snapshot(directory,'restored')
    dimensions=map_frame(read_bounded(directory/'restored.png',PNG_LIMIT),product_tab=True,zoom=9)[0]
    width,height=dimensions
    if horizontal and dimensions != COAST_DIMENSIONS:
        raise ValueError('Horizontal observer requires a 720×1280 capture')
    require_foreground(command,activity)
    if running_pid(command,package) != pid:
        raise ValueError('Product process changed before small-input preparation')
    start=directory/'small-pan-start';start.mkdir(mode=0o700)
    if horizontal:
        preparation = plan['coastalPreparation']
        write_capture(start/'gesture.json',json.dumps(preparation).encode())
    else:
        x1,y1,x2,y2=plan['coastalPreparation']
        preparation = [width*x1//100,height*y1//100,width*x2//100,height*y2//100,plan['durationMs']]
    command(512,'shell','input','swipe',*map(str,preparation))
    time.sleep(plan['waitAfterInputSeconds'])
    capture_settled(command,start,package,activity,pid,original)
    baseline=snapshot(start,'zoom9')
    if (not .08 <= baseline['center'][0]-original['center'][0] <= .16 or
            abs(baseline['center'][1]-original['center'][1]) > 1e-5):
        raise ValueError('Small-input trial did not reach its coastal start')
    if horizontal:
        check_horizontal_location(baseline, original)
    for index,(label,delta) in enumerate(steps):
        root=directory/'small-pan'/f'{index:02d}-{label}';root.mkdir(mode=0o700,parents=True)
        before=root/'before-passive';before.mkdir(mode=0o700)
        capture_settled(command,before,package,activity,pid,baseline,phase='saved')
        if horizontal:
            check_horizontal_location(snapshot(before,'saved'), original)
        move=gesture(dimensions,delta,horizontal=horizontal)
        write_capture(root/'gesture.json',json.dumps(move).encode())
        require_foreground(command,activity)
        if running_pid(command,package) != pid:
            raise ValueError('Product process changed before the fixed small input')
        if move is not None:
            command(512,'shell','input','swipe',*map(str,move))
        time.sleep(plan['waitAfterInputSeconds'])
        for name,phase in (('after-passive','saved'),('after-zoom9','zoom9')):
            target=root/name;target.mkdir(mode=0o700)
            capture_settled(command,target,package,activity,pid,baseline,phase=phase)
            if horizontal:
                check_horizontal_location(snapshot(target,phase), original)
    result=verify_small_pan(directory,pid,horizontal=horizontal)
    write_capture(directory/'small-pan-observations.json',json.dumps(result,sort_keys=True).encode())
    return result
