"""Measure fixed small inputs before and after a camera-zoom reassertion."""

import json
import time

from product_map_frames import map_frame
from capture_device import require_foreground, running_pid, write_capture
from row_pan_trial import COAST_PLAN, capture_settled
from row_pan_observations import verify_settling
from row_return_trial import world
from verify_device_capture import LOG_LIMIT, PNG_LIMIT, read_bounded


STEPS = [('control',0), ('up10',-10), ('down10',10), ('up12',-12),
         ('down12',12), ('up16',-16), ('down16',16)]
PLAN = {'id':'small-pan-observers-v1', 'coastalPreparation':COAST_PLAN['startSwipePercent'],
        'durationMs':500, 'waitAfterInputSeconds':.75, 'steps':[list(step) for step in STEPS],
        'passivePhase':'saved', 'reassertPhase':'zoom9', 'worldPixels':524288}


def gesture(dimensions, delta):
    width,height = dimensions
    x,y = width//2,height*48//100
    return None if delta == 0 else [x,y,x,y+delta,PLAN['durationMs']]


def snapshot(root, phase):
    return json.loads(read_bounded(root/f'{phase}-source.json',LOG_LIMIT))


def displacement(before, after):
    return [first-last for first,last in zip(world(before['center']),world(after['center']))]


def verify_small_pan(directory, pid):
    if json.loads(read_bounded(directory/'small-pan-plan.json',LOG_LIMIT)) != PLAN:
        raise ValueError('Small-input plan differs from the predeclared sequence')
    baseline=snapshot(directory/'small-pan-start','zoom9')
    original=snapshot(directory,'restored')
    verify_settling(directory/'small-pan-start',original,pid)
    if (not .08 <= baseline['center'][0]-original['center'][0] <= .16 or
            abs(baseline['center'][1]-original['center'][1]) > 1e-5):
        raise ValueError('Small-input trial did not reach its coastal start')
    dimensions=map_frame(read_bounded(directory/'restored.png',PNG_LIMIT),product_tab=True,zoom=9)[0]
    rows=[]
    for index,(label,delta) in enumerate(STEPS):
        root=directory/'small-pan'/f'{index:02d}-{label}'
        if json.loads(read_bounded(root/'gesture.json',LOG_LIMIT)) != gesture(dimensions,delta):
            raise ValueError('Small-input gesture differs from the fixed distance or duration')
        records={}
        for name,phase in (('before-passive','saved'),('after-passive','saved'),('after-zoom9','zoom9')):
            checked=verify_settling(root/name,baseline,pid,phase)
            if checked['dimensions'] != list(dimensions) or min(checked['topTileSamples'],checked['bottomTileSamples']) < 40:
                raise ValueError('Small-input screenshot lost its dimensions or either cached tile')
            records[name]=snapshot(root/name,phase)
        rows.append({'step':label,'fingerY':delta,'passiveScreenDelta':displacement(records['before-passive'],records['after-passive']),
                     'reassertScreenDelta':displacement(records['after-passive'],records['after-zoom9'])})
    return {'planId':PLAN['id'],'observationsOnly':True,'steps':rows}


def capture_small_pan(command,directory,package,activity,pid):
    write_capture(directory/'small-pan-plan.json',json.dumps(PLAN,sort_keys=True).encode())
    original=snapshot(directory,'restored')
    dimensions=map_frame(read_bounded(directory/'restored.png',PNG_LIMIT),product_tab=True,zoom=9)[0]
    width,height=dimensions
    x1,y1,x2,y2=PLAN['coastalPreparation']
    require_foreground(command,activity)
    if running_pid(command,package) != pid:
        raise ValueError('Product process changed before small-input preparation')
    command(512,'shell','input','swipe',str(width*x1//100),str(height*y1//100),
            str(width*x2//100),str(height*y2//100),str(PLAN['durationMs']))
    time.sleep(PLAN['waitAfterInputSeconds'])
    start=directory/'small-pan-start';start.mkdir(mode=0o700)
    capture_settled(command,start,package,activity,pid,original)
    baseline=snapshot(start,'zoom9')
    if (not .08 <= baseline['center'][0]-original['center'][0] <= .16 or
            abs(baseline['center'][1]-original['center'][1]) > 1e-5):
        raise ValueError('Small-input trial did not reach its coastal start')
    for index,(label,delta) in enumerate(STEPS):
        root=directory/'small-pan'/f'{index:02d}-{label}';root.mkdir(mode=0o700,parents=True)
        before=root/'before-passive';before.mkdir(mode=0o700)
        capture_settled(command,before,package,activity,pid,baseline,phase='saved')
        move=gesture(dimensions,delta)
        write_capture(root/'gesture.json',json.dumps(move).encode())
        require_foreground(command,activity)
        if running_pid(command,package) != pid:
            raise ValueError('Product process changed before the fixed small input')
        if move is not None:
            command(512,'shell','input','swipe',*map(str,move))
        time.sleep(PLAN['waitAfterInputSeconds'])
        for name,phase in (('after-passive','saved'),('after-zoom9','zoom9')):
            target=root/name;target.mkdir(mode=0o700)
            capture_settled(command,target,package,activity,pid,baseline,phase=phase)
    result=verify_small_pan(directory,pid)
    write_capture(directory/'small-pan-observations.json',json.dumps(result,sort_keys=True).encode())
    return result
