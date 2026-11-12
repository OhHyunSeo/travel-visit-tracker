import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { regions } from '../src/data/regions';
import {
  matchBackgroundMapTileRequest,
  planBackgroundMapFromMetadata,
} from '../src/domain/backgroundMapMetadata';

const origin = 'https://tiles.openfreemap.org';
const tileVersion = '20261025_080012_pt';
const vector = `${origin}/planet/${tileVersion}/{z}/{x}/{y}.pbf`;
const raster = `${origin}/natural_earth/ne2sr/{z}/{x}/{y}.png`;
const glyphs = `${origin}/fonts/{fontstack}/{range}.pbf`;
const sprite = `${origin}/sprites/ofm_f384/ofm`;
const regionId = regions.find((region) => region.sourceName === 'Gangnam-gu')!.id;
const style = {
  version: 8,
  sources: {
    openmaptiles: { type: 'vector', url: `${origin}/planet` },
    ne2_shaded: { type: 'raster', maxzoom: 6, tileSize: 256, tiles: [raster] },
  },
  glyphs,
  sprite,
  layers: [
    { id: 'background', type: 'background' },
    { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water' },
  ],
};
const tileJson = {
  tilejson: '3.0.0',
  tiles: [vector],
  minzoom: 0,
  maxzoom: 14,
  bounds: [-180, -85.05113, 180, 85.05113],
  attribution: 'OpenFreeMap · OpenStreetMap',
};

const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const digest = async (bytes: Uint8Array) => sha256(bytes);

function fixture(styleBytes: Uint8Array = encode(style), tileBytes: Uint8Array = encode(tileJson)) {
  return {
    bytes: { style: styleBytes, tileJson: tileBytes },
    reference: { styleSha256: sha256(styleBytes), tileJsonSha256: sha256(tileBytes), tileVersion },
  };
}

describe('background map metadata verification', () => {
  it('plans a region and returns the four reviewed resource templates', async () => {
    const { bytes, reference } = fixture();
    const result = await planBackgroundMapFromMetadata(regionId, bytes, reference, digest);
    expect(result.plan.revision).toEqual({ styleSha256: reference.styleSha256, tileVersion });
    expect(result.plan.estimatedTileCount).toBe(64);
    expect(result.tileJsonSha256).toBe(reference.tileJsonSha256);
    expect(result.resources).toEqual({ vector, raster, glyphs, sprite });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.resources)).toBe(true);
  });

  it('uses the pinned tile template directly and preserves the other style fields', async () => {
    const { bytes, reference } = fixture();
    const result = await planBackgroundMapFromMetadata(regionId, bytes, reference, digest);
    expect(JSON.parse(result.offlineStyleJson)).toEqual({
      ...style,
      sources: {
        ne2_shaded: style.sources.ne2_shaded,
        openmaptiles: {
          type: 'vector',
          tiles: [vector],
          scheme: 'xyz',
          bounds: tileJson.bounds,
          minzoom: tileJson.minzoom,
          maxzoom: tileJson.maxzoom,
          attribution: tileJson.attribution,
        },
      },
    });
  });

  it.each(['style', 'tileJson'] as const)(
    'rejects any change to the reviewed %s bytes',
    async (key) => {
      const { bytes, reference } = fixture();
      bytes[key] = Buffer.concat([bytes[key], Buffer.from('\n')]);
      await expect(
        planBackgroundMapFromMetadata(regionId, bytes, reference, digest),
      ).rejects.toMatchObject({ reason: 'digest' });
    },
  );

  it('bounds both inputs before calling the digest', async () => {
    const { bytes, reference } = fixture();
    const observed = vi.fn(digest);
    await expect(
      planBackgroundMapFromMetadata(
        regionId,
        { ...bytes, style: Buffer.alloc(65_537) },
        reference,
        observed,
      ),
    ).rejects.toMatchObject({ reason: 'size' });
    await expect(
      planBackgroundMapFromMetadata(
        regionId,
        { ...bytes, tileJson: Buffer.alloc(0) },
        reference,
        observed,
      ),
    ).rejects.toMatchObject({ reason: 'size' });
    expect(observed).not.toHaveBeenCalled();
  });

  it('copies the documents and revision before waiting on the digest', async () => {
    const { bytes, reference } = fixture();
    const originalTileSha = reference.tileJsonSha256;
    const result = planBackgroundMapFromMetadata(regionId, bytes, reference, async (input) => {
      await Promise.resolve();
      return sha256(input);
    });
    bytes.style.fill(0);
    bytes.tileJson.fill(0);
    reference.tileVersion = '20261026_080012_pt';
    reference.tileJsonSha256 = '0'.repeat(64);
    await expect(result).resolves.toMatchObject({
      plan: { revision: { tileVersion } },
      tileJsonSha256: originalTileSha,
    });
  });

  it.each([
    { ...style, sources: { ...style.sources, extra: { type: 'geojson' } } },
    {
      ...style,
      sources: {
        ...style.sources,
        openmaptiles: { type: 'vector', url: `${origin}/planet?next=elsewhere` },
      },
    },
    {
      ...style,
      sources: {
        ...style.sources,
        ne2_shaded: { ...style.sources.ne2_shaded, tiles: [raster, 'https://other.invalid/tile'] },
      },
    },
    { ...style, sprite: `${sprite}?revision=2` },
    { ...style, sprite: `${sprite}\n` },
    { ...style, glyphs: 'https://other.invalid/fonts/{fontstack}/{range}.pbf' },
    { ...style, imports: [{ id: 'remote', url: 'https://other.invalid/style' }] },
  ])(
    'rejects unsupported style resource declarations even with matching digests',
    async (value) => {
      const { bytes, reference } = fixture(encode(value));
      await expect(
        planBackgroundMapFromMetadata(regionId, bytes, reference, digest),
      ).rejects.toMatchObject({ reason: 'style' });
    },
  );

  it.each([
    { ...tileJson, tiles: [vector.replace(tileVersion, '20261026_080012_pt')] },
    { ...tileJson, tiles: [vector, 'https://other.invalid/tile'] },
    { ...tileJson, tiles: [`${vector}?token=unreviewed`] },
    { ...tileJson, maxzoom: 11 },
    { ...tileJson, minzoom: 9 },
    { ...tileJson, scheme: 'tms' },
    { ...tileJson, attribution: '  ' },
    { ...tileJson, attribution: undefined },
    { ...tileJson, bounds: [-180, -85, 180] },
    { ...tileJson, bounds: [-180, -85, 180, 20] },
    { ...tileJson, bounds: [-181, -85, 180, 85] },
  ])('rejects inconsistent or incomplete tile metadata', async (value) => {
    const { bytes, reference } = fixture(encode(style), encode(value));
    await expect(
      planBackgroundMapFromMetadata(regionId, bytes, reference, digest),
    ).rejects.toMatchObject({ reason: 'tile-json' });
  });

  it('rejects invalid UTF-8 even when its digest matches', async () => {
    const { bytes, reference } = fixture(Buffer.from([0x22, 0xc0, 0x22]));
    await expect(
      planBackgroundMapFromMetadata(regionId, bytes, reference, digest),
    ).rejects.toMatchObject({ reason: 'style' });
  });
});

function tileUrl(template: string, zoom: number, x: number, y: number) {
  return template.replace('{z}/{x}/{y}', `${zoom}/${x}/${y}`);
}

describe('literal tile URLs for a verified plan', () => {
  it.each(['vector', 'raster'] as const)(
    'includes both boundaries of the %s range',
    async (source) => {
      const { bytes, reference } = fixture();
      const result = await planBackgroundMapFromMetadata(regionId, bytes, reference, digest);
      const range = result.plan.tileRanges.find((item) => item.source === source)!;
      for (const [x, y] of [
        [range.minX, range.minY],
        [range.maxX, range.maxY],
      ]) {
        const url = tileUrl(result.resources[source], range.zoom, x, y);
        expect(matchBackgroundMapTileRequest(result, url)).toEqual({
          source,
          zoom: range.zoom,
          x,
          y,
        });
      }
      for (const [x, y] of [
        [range.minX - 1, range.minY],
        [range.maxX + 1, range.maxY],
        [range.minX, range.minY - 1],
        [range.maxX, range.maxY + 1],
      ]) {
        expect(
          matchBackgroundMapTileRequest(
            result,
            tileUrl(result.resources[source], range.zoom, x, y),
          ),
        ).toBeUndefined();
      }
    },
  );

  it('uses the selected vector zooms and keeps raster at the planned zoom', async () => {
    const { bytes, reference } = fixture();
    const result = await planBackgroundMapFromMetadata(regionId, bytes, reference, digest, 10, 11);
    const rasterRange = result.plan.tileRanges.find((item) => item.source === 'raster')!;
    const vectorRange = result.plan.tileRanges.find((item) => item.source === 'vector')!;
    for (const zoom of [9, 12]) {
      expect(
        matchBackgroundMapTileRequest(
          result,
          tileUrl(vector, zoom, vectorRange.minX, vectorRange.minY),
        ),
      ).toBeUndefined();
    }
    expect(
      matchBackgroundMapTileRequest(result, tileUrl(raster, 7, rasterRange.minX, rasterRange.minY)),
    ).toBeUndefined();
    expect(
      matchBackgroundMapTileRequest(result, tileUrl(raster, 6, rasterRange.minX, rasterRange.minY))
        ?.source,
    ).toBe('raster');
  });

  it('rejects alternate origins, versions, encodings and URL decorations', async () => {
    const { bytes, reference } = fixture();
    const result = await planBackgroundMapFromMetadata(regionId, bytes, reference, digest);
    const { zoom, minX, minY } = result.plan.tileRanges[0];
    const url = tileUrl(vector, zoom, minX, minY);
    const original = `${zoom}/${minX}/${minY}`;
    for (const candidate of [
      url.replace('https:', 'http:'),
      url.replace('.org/', '.org:443/'),
      url.replace('.org/', '.org.other.invalid/'),
      url.replace('tiles.openfreemap.org', 'test@tiles.openfreemap.org'),
      url.replace(tileVersion, '20261026_080012_pt'),
      url.replace(original, `0${original}`),
      url.replace(original, `${zoom}%2f${minX}/${minY}`),
      url.replace(original, `${zoom}//${minX}/${minY}`),
      url.replace('.pbf', '\n.pbf'),
      `${url}?token=unreviewed`,
      `${url}#fragment`,
      `${origin}/planet`,
    ])
      expect(matchBackgroundMapTileRequest(result, candidate)).toBeUndefined();
  });
});
