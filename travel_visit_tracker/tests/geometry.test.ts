import { describe, it, expect } from 'vitest';
import type { Polygon, MultiPolygon } from 'geojson';
import { boundaryDistance, containsPoint } from '../src/domain/geometry';
import { findRegion, regions, regionPack } from '../src/data/regions';

const square: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [127, 37],
      [128, 37],
      [128, 38],
      [127, 38],
      [127, 37],
    ],
  ],
};
describe('administrative polygon membership', () => {
  it('includes the exterior and excludes points outside', () => {
    expect(containsPoint([127.5, 37.5], square)).toBe(true);
    expect(containsPoint([126.9, 37.5], square)).toBe(false);
  });
  it('excludes holes and their boundaries', () => {
    const hole: Polygon = {
      ...square,
      coordinates: [
        ...square.coordinates,
        [
          [127.3, 37.3],
          [127.7, 37.3],
          [127.7, 37.7],
          [127.3, 37.7],
          [127.3, 37.3],
        ],
      ],
    };
    expect(containsPoint([127.5, 37.5], hole)).toBe(false);
    expect(containsPoint([127.3, 37.5], hole)).toBe(false);
    expect(containsPoint([127.1, 37.1], hole)).toBe(true);
  });
  it('includes disconnected islands of a multipolygon', () => {
    const multi: MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [
        square.coordinates,
        [
          [
            [125, 33],
            [126, 33],
            [126, 34],
            [125, 34],
            [125, 33],
          ],
        ],
      ],
    };
    expect(containsPoint([125.5, 33.5], multi)).toBe(true);
    expect(containsPoint([126.5, 35], multi)).toBe(false);
  });
  it('measures distance from a shared boundary for uncertainty filtering', () => {
    expect(boundaryDistance([127, 37.5], square)).toBeCloseTo(0);
    expect(boundaryDistance([127.5, 37.5], square)).toBeGreaterThan(40000);
  });
});
describe('downloaded development pack', () => {
  it('has unique region identities and a denominator matching actual features', () => {
    expect(regionPack.count).toBe(regions.length);
    expect(new Set(regions.map((r) => r.id)).size).toBe(regions.length);
  });
  it('locates a known interior point in Gangnam and rejects a Paris point', () => {
    expect(findRegion(127.0473, 37.5172)?.sourceName).toBe('Gangnam-gu');
    expect(findRegion(2.3522, 48.8566)).toBeUndefined();
  });
  it('has valid closed rings and geographically plausible coordinates', () => {
    for (const region of regions) {
      const g = region.feature.geometry,
        polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      for (const rings of polygons)
        for (const ring of rings) {
          expect(ring.length).toBeGreaterThanOrEqual(4);
          expect(ring[0]).toEqual(ring.at(-1));
          expect(
            ring.every((p) => p[0] > 123 && p[0] < 133 && p[1] > 32 && p[1] < 40),
            `Invalid coordinate in ${region.name}`,
          ).toBe(true);
        }
    }
  });
});
