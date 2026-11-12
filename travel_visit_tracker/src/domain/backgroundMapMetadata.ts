import {
  backgroundMapPolicy,
  planBackgroundMap,
  type BackgroundMapPlan,
  type BackgroundMapRevision,
} from './backgroundMapPlan';

type ReviewedMetadata = BackgroundMapRevision & Readonly<{ tileJsonSha256: string }>;
type MetadataBytes = Readonly<{ style: Uint8Array; tileJson: Uint8Array }>;
type Sha256 = (bytes: Uint8Array) => Promise<string>;

export class BackgroundMapMetadataError extends Error {
  constructor(public readonly reason: 'reference' | 'size' | 'digest' | 'style' | 'tile-json') {
    super(`Invalid background map metadata: ${reason}`);
  }
}

const origin = 'https://tiles.openfreemap.org';
const vectorMetadata = `${origin}/planet`;
const raster = `${origin}/natural_earth/ne2sr/{z}/{x}/{y}.png`;
const glyphs = `${origin}/fonts/{fontstack}/{range}.pbf`;
const spritePattern = /^https:\/\/tiles\.openfreemap\.org\/sprites\/[a-zA-Z0-9_-]{1,64}\/ofm$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const maxDocumentBytes = 64 * 1024;

function snapshot(bytes: Uint8Array): Uint8Array {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > maxDocumentBytes)
    throw new BackgroundMapMetadataError('size');
  return Uint8Array.from(bytes);
}

function object(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value && !Array.isArray(value))
    return value as Record<string, unknown>;
}

function readJson(bytes: Uint8Array, reason: 'style' | 'tile-json'): Record<string, unknown> {
  try {
    const value = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    if (value) return value;
  } catch {
    throw new BackgroundMapMetadataError(reason);
  }
  throw new BackgroundMapMetadataError(reason);
}

function onlyEntry(list: unknown, value: string): boolean {
  return Array.isArray(list) && list.length === 1 && list[0] === value;
}

function readSprite(style: Record<string, unknown>): string {
  const sources = object(style.sources);
  const vectorSource = object(sources?.openmaptiles);
  const rasterSource = object(sources?.ne2_shaded);
  if (
    style.version !== 8 ||
    style.glyphs !== glyphs ||
    typeof style.sprite !== 'string' ||
    !spritePattern.test(style.sprite) ||
    !Array.isArray(style.layers) ||
    !style.layers.length ||
    Object.keys(style).length !== 5 ||
    !sources ||
    Object.keys(sources).length !== 2 ||
    vectorSource?.type !== 'vector' ||
    vectorSource.url !== vectorMetadata ||
    Object.keys(vectorSource).length !== 2 ||
    rasterSource?.type !== 'raster' ||
    rasterSource.maxzoom !== 6 ||
    rasterSource.tileSize !== 256 ||
    !onlyEntry(rasterSource.tiles, raster) ||
    Object.keys(rasterSource).length !== 4
  ) {
    throw new BackgroundMapMetadataError('style');
  }
  return style.sprite;
}

/** Checks two local documents against a separately reviewed reference before planning a region. */
export async function planBackgroundMapFromMetadata(
  regionId: string,
  bytes: MetadataBytes,
  reference: ReviewedMetadata,
  digestSha256: Sha256,
  minZoom?: number,
  maxZoom?: number,
): Promise<
  Readonly<{
    plan: BackgroundMapPlan;
    tileJsonSha256: string;
    resources: Readonly<{ vector: string; raster: string; glyphs: string; sprite: string }>;
  }>
> {
  const { styleSha256, tileJsonSha256, tileVersion } = reference;
  if (typeof tileJsonSha256 !== 'string' || !sha256Pattern.test(tileJsonSha256)) {
    throw new BackgroundMapMetadataError('reference');
  }
  const plan = planBackgroundMap(regionId, { styleSha256, tileVersion }, minZoom, maxZoom);

  const styleBytes = snapshot(bytes.style);
  const tileJsonBytes = snapshot(bytes.tileJson);
  const [actualStyle, actualTileJson] = await Promise.all([
    digestSha256(styleBytes),
    digestSha256(tileJsonBytes),
  ]);
  if (actualStyle !== styleSha256 || actualTileJson !== tileJsonSha256)
    throw new BackgroundMapMetadataError('digest');

  const sprite = readSprite(readJson(styleBytes, 'style'));
  const tileJson = readJson(tileJsonBytes, 'tile-json');
  const vector = `${vectorMetadata}/${tileVersion}/{z}/{x}/{y}.pbf`;
  if (
    tileJson.tilejson !== '3.0.0' ||
    (tileJson.scheme !== undefined && tileJson.scheme !== 'xyz') ||
    !onlyEntry(tileJson.tiles, vector) ||
    typeof tileJson.minzoom !== 'number' ||
    !Number.isInteger(tileJson.minzoom) ||
    tileJson.minzoom < 0 ||
    tileJson.minzoom > backgroundMapPolicy.minZoom ||
    typeof tileJson.maxzoom !== 'number' ||
    !Number.isInteger(tileJson.maxzoom) ||
    tileJson.maxzoom < backgroundMapPolicy.maxZoom ||
    tileJson.maxzoom > 22
  ) {
    throw new BackgroundMapMetadataError('tile-json');
  }

  return Object.freeze({
    plan,
    tileJsonSha256,
    resources: Object.freeze({ vector, raster, glyphs, sprite }),
  });
}
