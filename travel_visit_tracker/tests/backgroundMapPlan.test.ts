import { describe, expect, it, vi } from 'vitest';
import { regionById, regionPack, regions } from '../src/data/regions';
import {
  BackgroundMapPlanError,
  backgroundMapPolicy,
  planBackgroundMap,
  readBackgroundMapPlan,
  type BackgroundMapPlan,
  type BackgroundMapRevision,
} from '../src/domain/backgroundMapPlan';

const revision = { styleSha256: 'a'.repeat(64), tileVersion: '20261028_120000_pt' };
const gangnam = regions.find((region) => region.sourceName === 'Gangnam-gu')!;

function serializedPlan(change: (input: Record<string, unknown>) => void): string {
  const input = JSON.parse(JSON.stringify(planBackgroundMap(gangnam.id, revision)));
  change(input);
  return JSON.stringify(input);
}

describe('background map planning without SDK or network access', () => {
  it.each([
    ['Gangnam-gu', 64],
    ['Jeju-si', 181],
    ['Ongjin-gun', 663],
    ['Ulleung-gun', 61],
  ])('retains the reviewed padded planning estimate for %s', (name, count) => {
    const region = regions.find((candidate) => candidate.sourceName === name)!;
    const plan = planBackgroundMap(region.id, revision);
    expect(plan.estimatedTileCount).toBe(count);
    expect(plan.bounds).toEqual(region.bounds);
    expect(plan.boundaryPackId).toBe(regionPack.id);
    expect(plan.boundaryPackVersion).toBe(regionPack.version);
    expect(plan.tileRanges.filter((range) => range.source === 'raster')).toEqual([
      expect.objectContaining({ zoom: 6, count: 9 }),
    ]);
  });

  it('keeps all 228 public boundary previews within valid XYZ grids and the planning target', () => {
    expect(regions).toHaveLength(228);
    for (const region of regions) {
      const plan = planBackgroundMap(region.id, revision);
      expect(plan.estimatedTileCount).toBeGreaterThan(0);
      expect(plan.estimatedTileCount).toBeLessThanOrEqual(backgroundMapPolicy.maxTileAttempts);
      expect(
        plan.tileRanges.filter((range) => range.source === 'vector').map((range) => range.zoom),
      ).toEqual([8, 9, 10, 11, 12]);
      for (const range of plan.tileRanges) {
        expect(range.minX).toBeGreaterThanOrEqual(0);
        expect(range.minY).toBeGreaterThanOrEqual(0);
        expect(range.maxX).toBeLessThan(2 ** range.zoom);
        expect(range.maxY).toBeLessThan(2 ** range.zoom);
        expect(range.minX).toBeLessThanOrEqual(range.maxX);
        expect(range.minY).toBeLessThanOrEqual(range.maxY);
        expect(range.count).toBe((range.maxX - range.minX + 1) * (range.maxY - range.minY + 1));
      }
    }
    // These are tile-coordinate estimates; no SDK request count or byte limit is established here.
  });

  it('allows a narrower integer zoom range while retaining the raster allowance', () => {
    const full = planBackgroundMap(gangnam.id, revision);
    const narrowed = planBackgroundMap(gangnam.id, revision, 10, 11);
    expect(narrowed.tileRanges.map((range) => [range.source, range.zoom])).toEqual([
      ['vector', 10],
      ['vector', 11],
      ['raster', 6],
    ]);
    expect(narrowed.estimatedTileCount).toBeLessThan(full.estimatedTileCount);
    expect(planBackgroundMap(gangnam.id, revision, 12, 12).tileRanges).toHaveLength(2);
  });

  it('rejects an unknown region rather than accepting an arbitrary area', () => {
    expect(() => planBackgroundMap('synthetic:unknown', revision)).toThrow(
      new BackgroundMapPlanError('region'),
    );
  });

  it.each([
    [7, 12],
    [8, 13],
    [12, 8],
    [8.5, 12],
    [8, 11.5],
    [NaN, 12],
    [8, Infinity],
  ])('rejects unsupported zooms %s to %s', (min, max) => {
    expect(() => planBackgroundMap(gangnam.id, revision, min, max)).toThrow(
      new BackgroundMapPlanError('zoom'),
    );
  });

  it.each([
    { ...revision, styleSha256: 'a'.repeat(63) },
    { ...revision, styleSha256: 'g'.repeat(64) },
    { ...revision, styleSha256: 'A'.repeat(64) },
    { ...revision, tileVersion: '../20261028_120000_pt' },
    { ...revision, tileVersion: '20261028_120000_pt?token=synthetic' },
    { ...revision, tileVersion: 'https://example.invalid/tiles' },
    { ...revision, tileVersion: 'latest' },
    { ...revision, styleSha256: { toString: () => 'a'.repeat(64) } },
    { ...revision, tileVersion: { toString: () => revision.tileVersion } },
    null,
  ])('rejects missing or malformed pinned revisions: %j', (input) => {
    expect(() => planBackgroundMap(gangnam.id, input as BackgroundMapRevision)).toThrow(
      new BackgroundMapPlanError('revision'),
    );
  });

  it('copies and freezes the plan without freezing or retaining the caller revision object', () => {
    const mutableRevision = { ...revision };
    const plan = planBackgroundMap(gangnam.id, mutableRevision);
    mutableRevision.styleSha256 = 'b'.repeat(64);
    mutableRevision.tileVersion = '20261029_120000_pt';
    expect(plan.revision).toEqual(revision);
    expect(plan.bounds).not.toBe(gangnam.bounds);
    expect(plan.revision).not.toBe(mutableRevision);
    for (const value of [plan, plan.bounds, plan.revision, plan.tileRanges, ...plan.tileRanges])
      expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(mutableRevision)).toBe(false);
  });

  it('rejects invalid canonical geometry and an oversized estimate before producing a plan', () => {
    const region = regionById.get(gangnam.id)!;
    const getRegion = vi.spyOn(regionById, 'get');
    try {
      for (const bounds of [
        [NaN, 30, 127, 40],
        [128, 30, 127, 40],
        [127, 40, 128, 30],
        [-181, 30, 128, 40],
        [127, -86, 128, 40],
      ]) {
        getRegion.mockReturnValue({ ...region, bounds: bounds as typeof region.bounds });
        expect(() => planBackgroundMap(region.id, revision)).toThrow(
          new BackgroundMapPlanError('region'),
        );
      }
      getRegion.mockReturnValue({ ...region, bounds: [-179, -80, 179, 80] });
      expect(() => planBackgroundMap(region.id, revision)).toThrow(
        new BackgroundMapPlanError('tile-target'),
      );
    } finally {
      getRegion.mockRestore();
    }
  });
});

describe('persisted background map plan validation', () => {
  it('rebuilds a complete frozen plan from canonical JSON without changing its version identity', () => {
    const plan = planBackgroundMap(gangnam.id, revision, 9, 12);
    const restored = readBackgroundMapPlan(JSON.stringify(plan));
    expect(restored).toEqual(plan);
    expect(restored).not.toBe(plan);
    expect(Object.isFrozen(restored.tileRanges[0])).toBe(true);
  });

  it('accepts equivalent JSON with reordered object keys while retaining the same pinned values', () => {
    const plan = planBackgroundMap(gangnam.id, revision);
    const reordered = {
      ...plan,
      revision: { tileVersion: revision.tileVersion, styleSha256: revision.styleSha256 },
      tileRanges: plan.tileRanges.map((range) =>
        Object.fromEntries(Object.entries(range).reverse()),
      ),
    };
    expect(readBackgroundMapPlan(JSON.stringify(reordered))).toEqual(plan);
  });

  it('rejects an oversized manifest even when padding would otherwise leave valid JSON', () => {
    const serialized = JSON.stringify(planBackgroundMap(gangnam.id, revision));
    expect(() => readBackgroundMapPlan(serialized.padEnd(16_385))).toThrow(
      new BackgroundMapPlanError('manifest'),
    );
  });

  it.each([
    [
      'bounds',
      (input: Record<string, unknown>) => {
        input.bounds = [0, 0, 1, 1];
      },
    ],
    [
      'count',
      (input: Record<string, unknown>) => {
        input.estimatedTileCount = 1;
      },
    ],
    [
      'range',
      (input: Record<string, unknown>) => {
        (input.tileRanges as { maxX: number }[])[0].maxX += 1;
      },
    ],
    [
      'nested extra field',
      (input: Record<string, unknown>) => {
        (input.revision as Record<string, unknown>).unreviewed = true;
      },
    ],
    [
      'provider',
      (input: Record<string, unknown>) => {
        input.provider = 'other';
      },
    ],
    [
      'style',
      (input: Record<string, unknown>) => {
        input.style = 'other';
      },
    ],
    [
      'schema',
      (input: Record<string, unknown>) => {
        input.schemaVersion = 2;
      },
    ],
    [
      'policy',
      (input: Record<string, unknown>) => {
        input.policyRevision = 'unreviewed';
      },
    ],
    [
      'boundary ID',
      (input: Record<string, unknown>) => {
        input.boundaryPackId = 'other';
      },
    ],
    [
      'boundary version',
      (input: Record<string, unknown>) => {
        input.boundaryPackVersion = 'old';
      },
    ],
    [
      'extra field',
      (input: Record<string, unknown>) => {
        input.downloadComplete = true;
      },
    ],
    [
      'missing field',
      (input: Record<string, unknown>) => {
        delete input.minZoom;
      },
    ],
    [
      'unknown region',
      (input: Record<string, unknown>) => {
        input.regionId = 'unknown';
      },
    ],
  ])('rejects an altered %s instead of trusting saved derived values', (_name, change) => {
    expect(() => readBackgroundMapPlan(serializedPlan(change))).toThrow(
      new BackgroundMapPlanError('manifest'),
    );
  });

  it.each(['', '{', 'null', '[]', '123', '"text"', '{}'])(
    'rejects invalid manifest %j',
    (input) => {
      expect(() => readBackgroundMapPlan(input)).toThrow(new BackgroundMapPlanError('manifest'));
    },
  );

  it('does not accept a forged download state alongside an otherwise valid plan', () => {
    const input = JSON.parse(
      JSON.stringify(planBackgroundMap(gangnam.id, revision)),
    ) as BackgroundMapPlan;
    expect('state' in input).toBe(false);
    expect(() => readBackgroundMapPlan(JSON.stringify({ ...input, state: 'complete' }))).toThrow();
  });
});
