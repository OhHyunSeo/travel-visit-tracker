"""Capture product-map frames while driving the fixture's background switch."""

from pathlib import Path
import re
import sys
import time
from xml.etree import ElementTree

sys.path.append(str(Path(__file__).with_name('sdk-smoke')))
from capture_device import require_foreground, running_pid, write_capture
from verify_device_capture import LOG_LIMIT, PNG_LIMIT, read_bounded
from product_map_frames import PHASES, TAB_PHASES, adjacent_frame_matches, frame_matches, map_frame, verify_product_map_frames


TAG = 'TripProductMapQa'
TOGGLE_LABEL = 'Fixture saved background map'
MAP_TITLE = '여행으로 채우는 지도'
TAB_BUTTONS = {'initial': '저장 지도 보기', 'saved': '경계 지도만 보기',
               'disabled': '저장 지도 보기', 'restored': '경계 지도만 보기'}
UI_LIMIT = 128 * 1024
MAP_LOG = re.compile(r'\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+(\d+)\s+\d+\s+I\s+' + TAG + r':\s*(.*)')


def verify_product_map(directory, pid, *, product_tab=False, package=None, zoom=8, multi_zoom=False, adjacent_tiles=False, row_tiles=False):
    raw = read_bounded(directory / 'map.log', LOG_LIMIT).decode().splitlines()
    messages = []
    for line in raw:
        if TAG + ':' in line:
            entry = MAP_LOG.fullmatch(line)
            if not entry or int(entry[1]) != pid:
                raise ValueError('Unexpected product map log identity')
            messages.append(entry[2])
    phases = TAB_PHASES if product_tab else PHASES
    expected = ['MAP_OFFLINE connected=false']
    if product_tab:
        expected.append('MAP_ROUTE /(tabs)/index')
    else:
        expected.extend(f'MAP_PHASE {phase}' for phase in PHASES)
    if messages != expected:
        raise ValueError('Product map phase order, SDK connectivity or transport count differs')
    result = verify_product_map_frames(directory, product_tab=product_tab, zoom=zoom, multi_zoom=multi_zoom, adjacent_tiles=adjacent_tiles, row_tiles=row_tiles)
    if product_tab:
        for phase in phases:
            layout = read_bounded(directory / f'{phase}.xml', UI_LIMIT)
            toggle_center(layout, package, result['dimensions'], title=TAB_BUTTONS[phase])
        if read_bounded(directory / 'visit-storage.txt', 32) != b'absent\n':
            raise ValueError('The product map trial opened visit storage')
        result['route'] = '/(tabs)/index'
    return {'pid': pid, 'phases': list(phases), 'transportCalls': 0, **result}


def wait_for_frame(command, destination, phase, package, activity, pid, *, product_tab=False, zoom=8, adjacent_tiles=False, row_tiles=False):
    deadline = time.monotonic() + 18
    while time.monotonic() < deadline:
        require_foreground(command, activity)
        frame = command(PNG_LIMIT, 'exec-out', 'screencap', '-p')
        samples = map_frame(frame, product_tab=product_tab, zoom=zoom)
        matches = (adjacent_frame_matches(phase, map_frame(frame, product_tab=product_tab, zoom=8), samples)
                   if adjacent_tiles or row_tiles else frame_matches(phase, samples))
        if matches:
            require_foreground(command, activity)
            if running_pid(command, package) != pid:
                raise ValueError('Product map process changed during screen capture')
            write_capture(destination / f'{phase}.png', frame)
            return samples[0]
        time.sleep(.4)
    write_capture(destination / f'{phase}-unexpected.png', frame)
    raise ValueError(f'Product map did not display the expected {phase} frame')


def toggle_center(data, package, dimensions, *, title=None):
    try:
        layout = ElementTree.fromstring(data)
    except ElementTree.ParseError as error:
        raise ValueError('Could not read the saved-background switch layout') from error
    package_nodes = [node for node in layout.iter('node') if node.get('package') == package]
    if title and not any(MAP_TITLE in (node.get('text'), node.get('content-desc')) for node in package_nodes):
        raise ValueError('Product map tab title is missing from the foreground screen')
    nodes = [node for node in package_nodes if node.get('clickable') == 'true' and node.get('enabled') == 'true']
    if title:
        nodes = [node for node in nodes if any(item.get('package') == package and
                 title in (item.get('text'), item.get('content-desc')) for item in node.iter('node'))]
    else:
        nodes = [node for node in nodes if node.get('content-desc') == TOGGLE_LABEL]
    if len(nodes) != 1:
        raise ValueError('Expected one enabled saved-background switch in the QA package')
    bounds = re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', nodes[0].get('bounds', ''))
    if not bounds:
        raise ValueError('Missing saved-background switch bounds')
    left, top, right, bottom = map(int, bounds.groups())
    width, height = dimensions
    if not (0 <= left < right <= width and 0 <= top < bottom <= height):
        raise ValueError('Saved-background switch is outside the captured screen')
    return (left + right) // 2, (top + bottom) // 2


def capture_product_map(command, destination, package, activity, pid, *, product_tab=False, source_bounds=False, zoom=8, multi_zoom=False, adjacent_tiles=False, row_tiles=False):
    display_zoom = 9 if multi_zoom or adjacent_tiles or row_tiles else zoom
    # Capture the log even when a frame or UI query fails so the saved data can
    # distinguish a spinner, an unhandled toggle and a transport attempt.
    try:
        phases = TAB_PHASES if product_tab else PHASES
        for phase in phases:
            dimensions = wait_for_frame(command, destination, phase, package, activity, pid, product_tab=product_tab, zoom=display_zoom, adjacent_tiles=adjacent_tiles, row_tiles=row_tiles)
            if not product_tab and phase == phases[-1]:
                continue
            location = f'/data/local/tmp/fixture-product-map-{phase}.xml'
            title = TAB_BUTTONS.get(phase) if product_tab else None
            for attempt in range(3):
                command(2048, 'shell', 'uiautomator', 'dump', location, timeout=15)
                layout = command(UI_LIMIT, 'exec-out', 'cat', location)
                try:
                    x, y = toggle_center(layout, package, dimensions, title=title)
                    break
                except ValueError:
                    if attempt == 2:
                        write_capture(destination / f'{phase}.xml', layout)
                        raise
            write_capture(destination / f'{phase}.xml', layout)
            require_foreground(command, activity)
            if source_bounds:
                from product_map_sources import capture_source
                capture_source(command, destination, phase, package, activity)
                require_foreground(command, activity)
                if running_pid(command, package) != pid:
                    raise ValueError('Source inspection replaced the product map process')
            if phase != phases[-1]:
                command(512, 'shell', 'input', 'tap', str(x), str(y))
        if multi_zoom:
            from product_map_sources import capture_source
            for camera_zoom in (8, 9):
                phase = f'zoom{camera_zoom}'
                capture_source(command, destination, phase, package, activity, camera_zoom=camera_zoom)
                wait_for_frame(command, destination, phase, package, activity, pid,
                               product_tab=product_tab, zoom=camera_zoom)
        if product_tab:
            status = command(64, 'exec-out', 'run-as', package, 'sh', '-c',
                             'if [ -e files/SQLite/trip-painting-v1.db ]; then echo present; else echo absent; fi')
            write_capture(destination / 'visit-storage.txt', status)
    finally:
        log = command(LOG_LIMIT, 'logcat', '-d', '--pid', str(pid), '-v', 'threadtime', '-s',
                      TAG + ':V', 'ReactNativeJS:E', 'AndroidRuntime:E', '*:S')
        write_capture(destination / 'map.log', log)
    return verify_product_map(destination, pid, product_tab=product_tab, package=package, zoom=zoom, multi_zoom=multi_zoom, adjacent_tiles=adjacent_tiles, row_tiles=row_tiles)
