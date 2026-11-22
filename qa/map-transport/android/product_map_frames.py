"""Verify the visible phases of the product map in the isolated Android fixture."""

import io
from pathlib import Path
import sys

from PIL import Image

sys.path.append(str(Path(__file__).with_name('sdk-smoke')))
from verify_device_capture import PNG_LIMIT, RASTER_TILE_RGB, read_bounded


PHASES = ('saved', 'disabled', 'restored')
TAB_PHASES = ('initial', *PHASES)
BACKGROUND_RGB = (11, 25, 26)
SELECTED_REGION_RGB = (48, 74, 74)
SELECTED_REGION_WITH_RASTER_RGB = (141, 84, 59)
SELECTED_BORDER_RGB = (255, 255, 255)
UNSELECTED_COLORS = ((38, 60, 61), (203, 91, 49), (82, 113, 112))


def map_frame(data, *, product_tab=False, zoom=8):
    if not data or len(data) > PNG_LIMIT:
        raise ValueError('Invalid product map screenshot size')
    with Image.open(io.BytesIO(data), formats=('PNG',)) as frame:
        width, height = frame.size
        if not (64 <= width <= 4096 and 64 <= height <= 4096 and width * height <= 8_388_608):
            raise ValueError('Unsupported product map screenshot dimensions')
        if frame.mode not in ('RGB', 'RGBA') or frame.n_frames != 1:
            raise ValueError('Product map screenshot must be one RGB or RGBA frame')
        frame.load()
        raster_rgb = (52, 121, 206) if zoom == 9 else RASTER_TILE_RGB
        unselected = ((38, 60, 61), (52, 117, 195), (82, 113, 112)) if zoom == 9 else UNSELECTED_COLORS
        selected_raster = (50, 100, 147) if zoom == 9 else SELECTED_REGION_WITH_RASTER_RGB
        region_colors = unselected if product_tab else (
            SELECTED_REGION_RGB, selected_raster, SELECTED_BORDER_RGB,
        )
        colors = (raster_rgb, BACKGROUND_RGB, *region_colors)
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
    region = set.union(*(matches[color] for color in region_colors))
    return (width, height), matches[raster_rgb], len(matches[BACKGROUND_RGB]), region


def frame_matches(phase, samples):
    _, raster, background, region = samples
    if phase in ('initial', 'disabled'):
        return not raster and background >= 40 and len(region) >= 40
    return len(raster) >= 40 and len(region) >= 40


def adjacent_frame_matches(phase, left, right):
    region = left[3] | right[3]
    if phase in ('initial', 'disabled'):
        return not left[1] and not right[1] and right[2] >= 40 and len(region) >= 40
    return len(left[1]) >= 40 and len(right[1]) >= 40 and len(region) >= 40


def verify_product_map_frames(directory, *, product_tab=False, zoom=8, multi_zoom=False, adjacent_tiles=False):
    zoom = 9 if multi_zoom or adjacent_tiles else zoom
    phases = TAB_PHASES if product_tab else PHASES
    frames = {phase: map_frame(read_bounded(directory / f'{phase}.png', PNG_LIMIT), product_tab=product_tab, zoom=zoom)
              for phase in phases}
    left_frames = {phase: map_frame(read_bounded(directory / f'{phase}.png', PNG_LIMIT), product_tab=product_tab, zoom=8)
                   for phase in phases} if adjacent_tiles else {}
    if len({samples[0] for samples in frames.values()}) != 1:
        raise ValueError('Product map screenshot dimensions changed during the switch')
    for phase, samples in frames.items():
        matches = adjacent_frame_matches(phase, left_frames[phase], samples) if adjacent_tiles else frame_matches(phase, samples)
        if not matches:
            raise ValueError(f'Product map screenshot does not show the expected {phase} background')
    first, last = frames['saved'][1], frames['restored'][1]
    overlap = len(first & last)
    if overlap * 5 < max(len(first), len(last)) * 4:
        raise ValueError('Restored tile does not cover the same map area')
    first_region, last_region = frames['saved'][3], frames['restored'][3]
    region_overlap = len(first_region & last_region)
    if region_overlap * 5 < max(len(first_region), len(last_region)) * 4:
        raise ValueError('Region boundaries moved when restoring the saved background')
    zoom_samples = {}
    if multi_zoom:
        for camera_zoom in (8, 9):
            samples = map_frame(read_bounded(directory / f'zoom{camera_zoom}.png', PNG_LIMIT),
                                product_tab=product_tab, zoom=camera_zoom)
            if samples[0] != frames['saved'][0] or not frame_matches('saved', samples):
                raise ValueError(f'Product map did not display the zoom {camera_zoom} cached tile')
            zoom_samples[str(camera_zoom)] = len(samples[1])
    adjacent = {}
    if adjacent_tiles:
        first, last = left_frames['saved'][1], left_frames['restored'][1]
        if len(first & last) * 5 < max(len(first), len(last)) * 4:
            raise ValueError('Restored left tile moved')
        for phase in ('saved', 'restored'):
            left, right = left_frames[phase][1], frames[phase][1]
            if sum(x for x, _ in left) / len(left) >= sum(x for x, _ in right) / len(right):
                raise ValueError('Adjacent tile colors are not in left-to-right order')
        adjacent = {'leftTileSamples': {phase: len(left_frames[phase][1]) for phase in phases},
                    'rightTileSamples': {phase: len(frames[phase][1]) for phase in phases},
                    'leftRestoredOverlap': len(first & last)}
    return {'dimensions': list(frames['saved'][0]), 'tileSamples': {phase: len(frames[phase][1]) for phase in phases},
            'defaultBackgroundSamples': frames['disabled'][2], 'restoredOverlap': overlap,
            'regionOverlap': region_overlap, **({'zoomTileSamples': zoom_samples} if multi_zoom else {}),
            **({'adjacentTiles': adjacent} if adjacent_tiles else {})}
