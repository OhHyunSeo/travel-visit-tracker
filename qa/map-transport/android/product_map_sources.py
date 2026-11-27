"""Compare the loaded Android renderer source with the downloaded pack."""

import json
import math
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).with_name('sdk-smoke')))
from capture_device import write_capture
from verify_device_capture import LOG_LIMIT, read_bounded
from product_map_frames import TAB_PHASES


def capture_source(command, destination, phase, package, activity, *, camera_zoom=None):
    import time

    args = [] if camera_zoom is None else ['--ei', 'fixture-camera-zoom', str(camera_zoom)]
    launch = command(4096, 'shell', 'am', 'start', '-W', '--activity-single-top', '-n', activity,
                     '--es', 'fixture-source-phase', phase, *args)
    write_capture(destination / f'{phase}-source-launch.txt', launch)
    if b'Status: ok' not in launch:
        raise ValueError('Source inspection did not reach the active product map')
    path = f'files/map-source/{phase}.json'
    for _ in range(20):
        data = command(LOG_LIMIT, 'exec-out', 'run-as', package, 'sh', '-c', f'if [ -f {path} ]; then cat {path}; fi')
        if data:
            write_capture(destination / f'{phase}-source.json', data)
            return
        time.sleep(.2)
    log = command(LOG_LIMIT, 'logcat', '-d', '-v', 'threadtime', '-s', 'TripMapSourceQa:V', '*:S')
    write_capture(destination / f'{phase}-source-error.log', log)
    raise ValueError('Active product map source snapshot was not written')


def verify_source_bounds(directory, pid, metadata, style_json, *, multi_zoom=False):
    plan = json.loads(metadata['plan'])
    expected_bounds = plan['bounds']
    original = json.loads(style_json)['sources']['fixture']
    checked = {}
    phases = (*TAB_PHASES, 'zoom8', 'zoom9') if multi_zoom else TAB_PHASES
    views = {}
    for phase in phases:
        snapshot = json.loads(read_bounded(directory / f'{phase}-source.json', LOG_LIMIT))
        if (not isinstance(snapshot, dict) or snapshot.get('pid') != pid or snapshot.get('phase') != phase
                or snapshot.get('connected') is not False or not isinstance(snapshot.get('viewIdentity'), int)
                or snapshot['viewIdentity'] <= 0 or 'source' not in snapshot):
            raise ValueError('Native product source snapshot has a different process, phase or connection state')
        source = snapshot.get('source')
        if phase in ('initial', 'disabled'):
            if source is not None:
                raise ValueError('Boundary-only map still contains the saved raster source')
            continue
        if not isinstance(source, dict) or source.get('type') != original['type'] or source.get('tiles') != original['tiles']:
            raise ValueError('Renderer source type or tile URLs differ from the saved style')
        bounds = source.get('bounds')
        if (not isinstance(bounds, list) or len(bounds) != 4 or
                any(type(value) not in (int, float) or not math.isfinite(value) for value in bounds) or
                any(not math.isclose(value, expected, rel_tol=0, abs_tol=1e-5)
                    for value, expected in zip(bounds, expected_bounds))):
            raise ValueError('Renderer tile bounds differ from the downloaded pack')
        if (source.get('minzoom'), source.get('maxzoom')) != (plan['minZoom'], plan['maxZoom']):
            raise ValueError('Renderer source zoom differs from the downloaded pack')
        camera_zoom = snapshot.get('zoom')
        if type(camera_zoom) not in (int, float) or not plan['minZoom'] <= camera_zoom <= plan['maxZoom']:
            raise ValueError('Renderer camera zoom is outside the downloaded pack')
        if phase.startswith('zoom') and camera_zoom != int(phase[-1]):
            raise ValueError('Renderer camera did not reach the requested zoom')
        checked[phase] = bounds
        views[phase] = snapshot['viewIdentity']
    if checked['saved'] != checked['restored']:
        raise ValueError('Restoring the saved map changed its native tile bounds')
    if multi_zoom and ((plan['minZoom'], plan['maxZoom']) != (8, 9) or
                       any(views[phase] != views['restored'] for phase in ('zoom8', 'zoom9'))):
        raise ValueError('Both zooms must use the same restored MapView and multi-zoom pack')
    return {'bounds': checked['saved'], 'zoomRange': [plan['minZoom'], plan['maxZoom']],
            'phases': list(phases), 'tileUrlsPreserved': True,
            **({'zoomViewIdentity': views['restored']} if multi_zoom else {})}
