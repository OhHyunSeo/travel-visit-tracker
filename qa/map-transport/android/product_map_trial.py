"""Capture product-map frames while driving the fixture's background switch."""

from pathlib import Path
import re
import sys
import time
from xml.etree import ElementTree

sys.path.append(str(Path(__file__).with_name('sdk-smoke')))
from capture_device import require_foreground, running_pid, write_capture
from verify_device_capture import LOG_LIMIT, PNG_LIMIT, read_bounded
from product_map_frames import PHASES, frame_matches, map_frame, verify_product_map_frames


TAG = 'TripProductMapQa'
TOGGLE_LABEL = 'Fixture saved background map'
MAP_LOG = re.compile(r'\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+(\d+)\s+\d+\s+I\s+' + TAG + r':\s*(.*)')


def verify_product_map(directory, pid):
    raw = read_bounded(directory / 'map.log', LOG_LIMIT).decode().splitlines()
    messages = []
    for line in raw:
        if TAG + ':' in line:
            entry = MAP_LOG.fullmatch(line)
            if not entry or int(entry[1]) != pid:
                raise ValueError('Unexpected product map log identity')
            messages.append(entry[2])
    expected = ['MAP_OFFLINE connected=false', *(f'MAP_PHASE {phase}' for phase in PHASES)]
    if messages != expected:
        raise ValueError('Product map phase order, SDK connectivity or transport count differs')
    return {'pid': pid, 'phases': list(PHASES), 'transportCalls': 0, **verify_product_map_frames(directory)}


def wait_for_frame(command, destination, phase, package, activity, pid):
    deadline = time.monotonic() + 18
    while time.monotonic() < deadline:
        require_foreground(command, activity)
        frame = command(PNG_LIMIT, 'exec-out', 'screencap', '-p')
        samples = map_frame(frame)
        if frame_matches(phase, samples):
            require_foreground(command, activity)
            if running_pid(command, package) != pid:
                raise ValueError('Product map process changed during screen capture')
            write_capture(destination / f'{phase}.png', frame)
            return samples[0]
        time.sleep(.4)
    write_capture(destination / f'{phase}-unexpected.png', frame)
    raise ValueError(f'Product map did not display the expected {phase} frame')


def toggle_center(data, package, dimensions):
    try:
        layout = ElementTree.fromstring(data)
    except ElementTree.ParseError as error:
        raise ValueError('Could not read the saved-background switch layout') from error
    nodes = [node for node in layout.iter('node')
             if node.get('package') == package and node.get('content-desc') == TOGGLE_LABEL
             and node.get('clickable') == 'true' and node.get('enabled') == 'true']
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


def capture_product_map(command, destination, package, activity, pid):
    # Capture the log even when a frame or UI query fails so the saved data can
    # distinguish a spinner, an unhandled toggle and a transport attempt.
    try:
        for phase in PHASES:
            dimensions = wait_for_frame(command, destination, phase, package, activity, pid)
            if phase == PHASES[-1]:
                continue
            location = f'/data/local/tmp/fixture-product-map-{phase}.xml'
            command(2048, 'shell', 'uiautomator', 'dump', location, timeout=15)
            layout = command(128 * 1024, 'exec-out', 'cat', location)
            write_capture(destination / f'{phase}.xml', layout)
            x, y = toggle_center(layout, package, dimensions)
            require_foreground(command, activity)
            command(512, 'shell', 'input', 'tap', str(x), str(y))
    finally:
        log = command(LOG_LIMIT, 'logcat', '-d', '--pid', str(pid), '-v', 'threadtime', '-s', TAG + ':V', '*:S')
        write_capture(destination / 'map.log', log)
    return verify_product_map(destination, pid)
