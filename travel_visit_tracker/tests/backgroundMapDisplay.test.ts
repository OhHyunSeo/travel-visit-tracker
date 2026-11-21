import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { regions } from '../src/data/regions';
import { createBackgroundMapPackMetadata } from '../src/domain/backgroundMapPack';
import { planBackgroundMap } from '../src/domain/backgroundMapPlan';
import { loadSavedBackgroundMap } from '../src/services/backgroundMapDisplay';

const packId = '1b433638-83b7-4d7b-ae95-63c41f70abcd';
const plan = planBackgroundMap(regions[0].id, {
  styleSha256: 'a'.repeat(64),
  tileVersion: '20261028_120000_pt',
});
const style = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background' }] };
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

function setup(authoredStyle: unknown = style) {
  const styleJson = JSON.stringify(authoredStyle);
  const metadata = createBackgroundMapPackMetadata(plan, {
    operationId: '3b433638-83b7-4d7b-ae95-63c41f70abcd',
    tileJsonSha256: 'b'.repeat(64),
    localStyleSha256: digest(styleJson),
  });
  const saved = { styleJson, metadata };
  const dependencies = {
    isCacheOnly: vi.fn(() => true),
    recover: vi.fn(async (): Promise<{ kind: string; packId?: string }> => ({
      kind: 'complete',
      packId,
    })),
    styleForPack: vi.fn(async (_id: string): Promise<typeof saved | null> => saved),
    digestStyle: async (value: string) => digest(value),
  };
  return { saved, dependencies };
}

describe('displaying a saved map', () => {
  it('provides the matching completed pack, style, region and zoom limits', async () => {
    const { dependencies } = setup();
    await expect(loadSavedBackgroundMap(dependencies)).resolves.toEqual({
      packId,
      regionId: plan.regionId,
      bounds: plan.bounds,
      minZoom: plan.minZoom,
      maxZoom: plan.maxZoom,
      style,
    });
    expect(dependencies.styleForPack).toHaveBeenCalledExactlyOnceWith(packId);
  });

  it('restricts the tile source coverage without changing the saved tile URL', async () => {
    const tiles = ['https://fixture.invalid/{z}/{x}/{y}.png'];
    const raster = { type: 'raster', tiles };
    const { dependencies } = setup({ ...style, sources: { raster } });
    const display = await loadSavedBackgroundMap(dependencies);
    expect(display?.style.sources.raster).toEqual({ ...raster, bounds: plan.bounds });
    expect(raster).toEqual({ type: 'raster', tiles });
  });

  it('leaves the SDK untouched when the native app cannot confirm cache-only operation', async () => {
    const { dependencies } = setup();
    dependencies.isCacheOnly.mockReturnValue(false);
    await expect(loadSavedBackgroundMap(dependencies)).resolves.toBeNull();
    expect(dependencies.recover).not.toHaveBeenCalled();
  });

  it('does not publish a style after the cache-only capability changes', async () => {
    const { dependencies } = setup();
    dependencies.isCacheOnly.mockReturnValueOnce(true).mockReturnValue(false);
    await expect(loadSavedBackgroundMap(dependencies)).resolves.toBeNull();
  });

  it('keeps the boundary map for incomplete, legacy or changed packs', async () => {
    const { saved, dependencies } = setup();
    dependencies.recover.mockResolvedValueOnce({ kind: 'incomplete', packId });
    await expect(loadSavedBackgroundMap(dependencies)).resolves.toBeNull();
    expect(dependencies.styleForPack).not.toHaveBeenCalled();
    dependencies.styleForPack.mockResolvedValueOnce(null);
    await expect(loadSavedBackgroundMap(dependencies)).resolves.toBeNull();
    dependencies.styleForPack.mockResolvedValueOnce({ ...saved, styleJson: '{}' });
    await expect(loadSavedBackgroundMap(dependencies)).resolves.toBeNull();
  });

  it('refuses a matching style that would replace the visit overlay source or layers', async () => {
    const source = setup({ ...style, sources: { regions: { type: 'geojson' } } });
    const layer = setup({ ...style, layers: [{ id: 'region-border', type: 'line' }] });
    await expect(loadSavedBackgroundMap(source.dependencies)).resolves.toBeNull();
    await expect(loadSavedBackgroundMap(layer.dependencies)).resolves.toBeNull();
  });
});
