import { describe, expect, it } from 'vitest';
import { regions } from '../src/data/regions';
import {
  createBackgroundMapPackMetadata,
  findBackgroundMapPack,
} from '../src/domain/backgroundMapPack';
import { planBackgroundMap } from '../src/domain/backgroundMapPlan';

const firstPack = '1b433638-83b7-4d7b-ae95-63c41f70abcd';
const secondPack = '2b433638-83b7-4d7b-ae95-63c41f70abcd';
const plan = planBackgroundMap(regions[0].id, {
  styleSha256: 'a'.repeat(64),
  tileVersion: '20261028_120000_pt',
});
const identity = {
  operationId: '3b433638-83b7-4d7b-ae95-63c41f70abcd',
  localStyleSha256: 'b'.repeat(64),
  tileJsonSha256: 'c'.repeat(64),
};
const metadata = createBackgroundMapPackMetadata(plan, identity);
const pack = { id: firstPack, bounds: plan.bounds, metadata };

describe('background map SDK pack identity', () => {
  it('recovers a single pack if the process stopped before recording its SDK ID', () => {
    const restored = { ...pack, metadata: JSON.parse(JSON.stringify(metadata)) };
    expect(findBackgroundMapPack([restored], metadata)).toEqual({
      kind: 'found',
      packId: firstPack,
    });
    expect(findBackgroundMapPack([restored], metadata, firstPack)).toEqual({
      kind: 'found',
      packId: firstPack,
    });
  });

  it('skips packs that belong to another operation or older map feature', () => {
    expect(
      findBackgroundMapPack(
        [
          { ...pack, metadata: { ...metadata, operationId: secondPack } },
          { id: secondPack, bounds: plan.bounds, metadata: {} },
        ],
        metadata,
      ),
    ).toEqual({ kind: 'missing' });
  });

  it('refuses two matching packs even when one ID was already recorded', () => {
    expect(findBackgroundMapPack([pack, { ...pack, id: secondPack }], metadata, firstPack)).toEqual(
      { kind: 'conflict' },
    );
  });

  it('refuses metadata from a different operation if it uses the recorded ID', () => {
    expect(findBackgroundMapPack([{ ...pack, metadata: {} }], metadata, firstPack)).toEqual({
      kind: 'conflict',
    });
    expect(findBackgroundMapPack([{ ...pack, id: secondPack }], metadata, firstPack)).toEqual({
      kind: 'conflict',
    });
  });

  it.each([
    { localStyleSha256: '0'.repeat(64) },
    { tileJsonSha256: '1'.repeat(64) },
    { plan: '{}' },
    { schemaVersion: 2 },
  ])('flags a changed pack context for the same operation', (change) => {
    expect(
      findBackgroundMapPack([{ ...pack, metadata: { ...metadata, ...change } }], metadata),
    ).toEqual({ kind: 'conflict' });
  });

  it('flags mismatched native bounds and a malformed matching SDK ID', () => {
    expect(
      findBackgroundMapPack([{ ...pack, bounds: [...plan.bounds].reverse() }], metadata),
    ).toEqual({ kind: 'conflict' });
    expect(findBackgroundMapPack([{ ...pack, id: 'unexpected' }], metadata)).toEqual({
      kind: 'conflict',
    });
  });

  it('refuses an invalid operation, digest or derived plan before SDK creation', () => {
    expect(() =>
      createBackgroundMapPackMetadata(plan, { ...identity, operationId: 'recent' }),
    ).toThrow();
    expect(() =>
      createBackgroundMapPackMetadata(plan, { ...identity, localStyleSha256: '' }),
    ).toThrow();
    expect(() =>
      createBackgroundMapPackMetadata({ ...plan, estimatedTileCount: 1 }, identity),
    ).toThrow();
  });
});
