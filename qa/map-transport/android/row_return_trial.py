"""Predeclared bounded return gestures for the existing synthetic row APK."""

import json
import math
import time

from capture_device import require_foreground, running_pid, write_capture
from product_map_frames import map_frame
from row_pan_observations import validate_snapshot, verify_settling
from verify_device_capture import LOG_LIMIT, PNG_LIMIT, read_bounded


RETURN_POLICY = {'maxGestures': 4, 'cameraTolerancePixels': 2, 'sampleOverlapPercent': 80,
                 'touchSlopPixels': 12, 'maxDisplacementPixels': 200, 'durationMs': 500,
                 'worldPixels': 524288}
MEASURED_RETURN_POLICY = {**RETURN_POLICY, 'controller':'measured-small-v1',
                          'microThresholdPixels':10,
                          'verticalResponsePixels':[[10,1.675],[12,3.695],[16,7.551]],
                          'responseCapture':'rn-small-pan-log.uutG7wMo'}
OBSERVED_RETURN_RANGE = {
    'coarseErrorYPixels': [-180.47851385045215, -178.09179512309493],
    'coarseSwipeYPixels': [190, 192],
    'fineErrorYPixels': [-7.091796779597644, -5.757812470925273],
    'fineSwipeYPixels': [16, 16],
}


def world(center):
    lon,lat = center
    size = RETURN_POLICY['worldPixels']
    return (lon+180)/360*size, (1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*size


def camera_error(current, target):
    return [wanted-present for present,wanted in zip(world(current),world(target))]


def return_gesture(current, target, dimensions, policy=RETURN_POLICY):
    if policy not in (RETURN_POLICY,MEASURED_RETURN_POLICY):
        raise ValueError('Unknown predeclared return policy')
    width,height = dimensions
    error = camera_error(current,target)
    if max(map(abs,error)) <= RETURN_POLICY['cameraTolerancePixels']:
        return None
    if policy == MEASURED_RETURN_POLICY:
        if abs(error[0]) > policy['cameraTolerancePixels']:
            raise ValueError('Measured return has no calibrated horizontal correction')
        if abs(error[1]) <= policy['microThresholdPixels']:
            distance=min(policy['verticalResponsePixels'],key=lambda pair:(abs(pair[1]-abs(error[1])),pair[0]))[0]
            shift=[0,int(math.copysign(distance,error[1]))]
        else:
            shift=[0,round(error[1])+int(math.copysign(policy['touchSlopPixels'],error[1]))]
    else:
        shift = [0 if abs(delta) <= RETURN_POLICY['cameraTolerancePixels'] else
                 round(delta)+int(math.copysign(RETURN_POLICY['touchSlopPixels'],delta)) for delta in error]
    if max(map(abs,shift)) > RETURN_POLICY['maxDisplacementPixels']:
        raise ValueError('Return displacement exceeds the predeclared bound')
    x,y = width//2,height*48//100
    end = [x-shift[0],y-shift[1]]
    if not (width*.12 <= end[0] <= width*.88 and height*.31 <= end[1] <= height*.65):
        raise ValueError('Return gesture leaves the predeclared map area')
    return [x,y,*end,RETURN_POLICY['durationMs']]


def check_observed_gesture(index, error_y, gesture):
    if index >= 2:
        raise ValueError('Another return gesture would exceed the observed sequence')
    stage = 'coarse' if index == 0 else 'fine'
    minimum_error, maximum_error = OBSERVED_RETURN_RANGE[f'{stage}ErrorYPixels']
    minimum_swipe, maximum_swipe = OBSERVED_RETURN_RANGE[f'{stage}SwipeYPixels']
    swipe_y = gesture[3] - gesture[1] if gesture is not None else 0
    if (not minimum_error <= error_y <= maximum_error or
            not minimum_swipe <= swipe_y <= maximum_swipe):
        raise ValueError(f'{stage.capitalize()} return would leave the observed range '
                         f'(Y error {error_y:.6f}px, input {swipe_y:+d}px)')


def verify_row_return(directory, baseline, pid, policy=RETURN_POLICY, *, observed_only=False):
    root=directory/'pan-return'
    report=json.loads(read_bounded(root/'return-report.json',LOG_LIMIT))
    count=report.get('attempts')
    if (report.get('policy') != policy or type(count) is not int or
            not 1 <= count <= policy['maxGestures'] or report.get('selectedAttempt') != count-1):
        raise ValueError('Return has no bounded selected observation')
    previous=json.loads(read_bounded(directory/'pan-south/zoom9-source.json',LOG_LIMIT))
    for index in range(count):
        folder=root/'attempts'/f'{index:02d}'
        gesture=json.loads(read_bounded(folder/'gesture.json',LOG_LIMIT))
        if gesture != return_gesture(previous['center'],baseline['center'],report['dimensions'],policy):
            raise ValueError('Return gesture differs from the predeclared controller')
        if observed_only:
            check_observed_gesture(index, camera_error(previous['center'], baseline['center'])[1], gesture)
        verify_settling(folder,baseline,pid)
        previous=json.loads(read_bounded(folder/'zoom9-source.json',LOG_LIMIT))
        validate_snapshot(previous,baseline,pid)
    error=camera_error(previous['center'],baseline['center'])
    if max(map(abs,error)) > RETURN_POLICY['cameraTolerancePixels']:
        raise ValueError('Return camera remains outside the predeclared tolerance')
    overlaps={}
    for zoom,name in ((8,'top'),(9,'bottom')):
        before=map_frame(read_bounded(directory/'pan-start/screen.png',PNG_LIMIT),product_tab=True,zoom=zoom)
        after=map_frame(read_bounded(folder/'screen.png',PNG_LIMIT),product_tab=True,zoom=zoom)
        overlap=len(before[1]&after[1])
        if (before[0] != after[0] or before[0] != tuple(report['dimensions']) or
                overlap*100 < max(len(before[1]),len(after[1]))*RETURN_POLICY['sampleOverlapPercent']):
            raise ValueError('Return tile samples do not overlap the starting frame')
        overlaps[name]={'start':len(before[1]),'returned':len(after[1]),'overlap':overlap}
    return {'attempts':count,'cameraErrorPixels':error,'tileSamples':overlaps}


def capture_row_return(command,directory,package,activity,pid,baseline,dimensions,policy=RETURN_POLICY, *, observed_only=False):
    from row_pan_trial import capture_settled
    root=directory/'pan-return';root.mkdir(mode=0o700)
    current=json.loads(read_bounded(directory/'pan-south/zoom9-source.json',LOG_LIMIT))
    records=[]
    for index in range(policy['maxGestures']):
        gesture=return_gesture(current['center'],baseline['center'],dimensions,policy)
        if observed_only:
            check_observed_gesture(index, camera_error(current['center'], baseline['center'])[1], gesture)
        folder=root/'attempts'/f'{index:02d}';folder.mkdir(mode=0o700,parents=True)
        write_capture(folder/'gesture.json',json.dumps(gesture).encode())
        require_foreground(command,activity)
        if running_pid(command,package) != pid:
            raise ValueError('Product process changed before returning')
        if gesture is not None:
            command(512,'shell','input','swipe',*map(str,gesture))
        time.sleep(.75)
        capture_settled(command,folder,package,activity,pid,baseline)
        current=json.loads(read_bounded(folder/'zoom9-source.json',LOG_LIMIT))
        records.append({'center':current['center'],'errorPixels':camera_error(current['center'],baseline['center'])})
        if max(map(abs,records[-1]['errorPixels'])) <= RETURN_POLICY['cameraTolerancePixels']:
            break
    report={'policy':policy,'dimensions':list(dimensions),'attempts':len(records),
            'selectedAttempt':len(records)-1,'records':records}
    write_capture(root/'return-report.json',json.dumps(report,sort_keys=True).encode())
    return verify_row_return(directory,baseline,pid,policy,observed_only=observed_only)
