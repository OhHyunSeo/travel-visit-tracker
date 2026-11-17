"""Verify the visible phases of the product map in the isolated Android fixture."""

import io
from pathlib import Path
import sys

from PIL import Image

sys.path.append(str(Path(__file__).with_name('sdk-smoke')))
from verify_device_capture import PNG_LIMIT, RASTER_TILE_RGB, read_bounded


PHASES = ('saved', 'disabled', 'restored')
BACKGROUND_RGB = (11, 25, 26)
SELECTED_REGION_RGB = (48, 74, 74)
SELECTED_REGION_WITH_RASTER_RGB = (141, 84, 59)
SELECTED_BORDER_RGB = (255, 255, 255)


def map_frame(data):
    if not data or len(data) > PNG_LIMIT:
        raise ValueError('Invalid product map screenshot size')
    with Image.open(io.BytesIO(data), formats=('PNG',)) as frame:
        width, height = frame.size
        if not (64 <= width <= 4096 and 64 <= height <= 4096 and width * height <= 8_388_608):
            raise ValueError('Unsupported product map screenshot dimensions')
        if frame.mode not in ('RGB', 'RGBA') or frame.n_frames != 1:
            raise ValueError('Product map screenshot must be one RGB or RGBA frame')
        frame.load()
        colors = (RASTER_TILE_RGB, BACKGROUND_RGB, SELECTED_REGION_RGB, SELECTED_REGION_WITH_RASTER_RGB, SELECTED_BORDER_RGB)
        matches = {color: set() for color in colors}
        # Sample the central map area below the fixture controls. The selected
        # region's opaque fill can cover the middle of the saved raster tile.
        for y in range(height * 22 // 100, height * 86 // 100, 4):
            for x in range(width * 12 // 100, width * 88 // 100, 4):
                pixel = frame.getpixel((x, y))
                if len(pixel) == 4 and pixel[3] != 255:
                    continue
                for color in colors:
                    if all(abs(component - expected) <= 3 for component, expected in zip(pixel, color)):
                        matches[color].add((x, y))
    region = matches[SELECTED_REGION_RGB] | matches[SELECTED_REGION_WITH_RASTER_RGB] | matches[SELECTED_BORDER_RGB]
    return (width, height), matches[RASTER_TILE_RGB], len(matches[BACKGROUND_RGB]), region


def frame_matches(phase, samples):
    _, raster, background, region = samples
    if phase == 'disabled':
        return not raster and background >= 40 and len(region) >= 40
    return len(raster) >= 40 and len(region) >= 40


def verify_product_map_frames(directory):
    frames = {phase: map_frame(read_bounded(directory / f'{phase}.png', PNG_LIMIT)) for phase in PHASES}
    if len({samples[0] for samples in frames.values()}) != 1:
        raise ValueError('Product map screenshot dimensions changed during the switch')
    for phase, samples in frames.items():
        if not frame_matches(phase, samples):
            raise ValueError(f'Product map screenshot does not show the expected {phase} background')
    first, last = frames['saved'][1], frames['restored'][1]
    overlap = len(first & last)
    if overlap * 5 < max(len(first), len(last)) * 4:
        raise ValueError('Restored tile does not cover the same map area')
    first_region, last_region = frames['saved'][3], frames['restored'][3]
    region_overlap = len(first_region & last_region)
    if region_overlap * 5 < max(len(first_region), len(last_region)) * 4:
        raise ValueError('Selected region moved when restoring the saved background')
    return {'dimensions': list(frames['saved'][0]), 'tileSamples': {phase: len(frames[phase][1]) for phase in PHASES},
            'defaultBackgroundSamples': frames['disabled'][2], 'restoredOverlap': overlap,
            'regionOverlap': region_overlap}
