import {
  backgroundMapPolicy,
  planBackgroundMap,
  type BackgroundMapPlan,
  type BackgroundMapRevision,
} from './backgroundMapPlan';

type ReviewedMetadata = BackgroundMapRevision & Readonly<{ tileJsonSha256: string }>;
type MetadataBytes = Readonly<{ style: Uint8Array; tileJson: Uint8Array }>;
type Sha256 = (bytes: Uint8Array) => Promise<string>;
type BackgroundMapMetadata = Readonly<{
  plan: BackgroundMapPlan;
  tileJsonSha256: string;
  offlineStyleJson: string;
  resources: Readonly<{
    vector: string;
    raster: string;
    glyphs: string;
    fontStacks: readonly string[];
    sprite: string;
  }>;
}>;
type TileCoordinates = Readonly<{
  source: 'vector' | 'raster';
  zoom: number;
  x: number;
  y: number;
}>;

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
const coordinatesPattern = /^(0|[1-9]\d?)\/(0|[1-9]\d{0,6})\/(0|[1-9]\d{0,6})$/;
const coordinateTemplate = '{z}/{x}/{y}';
const glyphTemplate = '{fontstack}/{range}.pbf';
const libertyFontStacks = ['Noto Sans Regular', 'Noto Sans Italic', 'Noto Sans Bold'];
const glyphRangePattern = /^(0|[1-9]\d{0,4})-(0|[1-9]\d{0,4})\.pbf$/;
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

function readStyleSources(style: Record<string, unknown>) {
  const layers = style.layers;
  const sources = object(style.sources);
  const vectorSource = object(sources?.openmaptiles);
  const rasterSource = object(sources?.ne2_shaded);
  if (
    style.version !== 8 ||
    style.glyphs !== glyphs ||
    typeof style.sprite !== 'string' ||
    style.sprite.match(spritePattern)?.[0] !== style.sprite ||
    !Array.isArray(layers) ||
    !layers.length ||
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
  const fontStacks = libertyFontStacks.filter((font) =>
    layers.some((layer) => onlyEntry(object(object(layer)?.layout)?.['text-font'], font)),
  );
  return { sprite: style.sprite, rasterSource, fontStacks: Object.freeze(fontStacks) };
}

function matchTile(
  metadata: BackgroundMapMetadata,
  url: string,
  source: TileCoordinates['source'],
): TileCoordinates | undefined {
  const [prefix, suffix] = metadata.resources[source].split(coordinateTemplate);
  if (!prefix || !suffix || !url.startsWith(prefix) || !url.endsWith(suffix)) return;
  const coordinates = url.slice(prefix.length, -suffix.length);
  const match = coordinatesPattern.exec(coordinates);
  if (!match || match[0] !== coordinates) return;
  const zoom = Number(match[1]);
  const x = Number(match[2]);
  const y = Number(match[3]);
  const range = metadata.plan.tileRanges.find(
    (item) => item.source === source && item.zoom === zoom,
  );
  if (range && x >= range.minX && x <= range.maxX && y >= range.minY && y <= range.maxY)
    return { source, zoom, x, y };
}

/** Classifies a literal tile URL against a plan produced from verified metadata. */
export function matchBackgroundMapTileRequest(
  metadata: BackgroundMapMetadata,
  url: string,
): TileCoordinates | undefined {
  return matchTile(metadata, url, 'vector') ?? matchTile(metadata, url, 'raster');
}

/** Recognizes only explicit Liberty font stacks and the reviewed sprite base. */
export function matchBackgroundMapSymbolRequest(metadata: BackgroundMapMetadata, url: string) {
  const spriteBase = metadata.resources.sprite;
  if (url.startsWith(spriteBase)) {
    const sprite = /^(|@2x)\.(json|png)$/.exec(url.slice(spriteBase.length));
    if (sprite && `${spriteBase}${sprite[0]}` === url)
      return { kind: 'sprite' as const, scale: sprite[1] ? 2 : 1, format: sprite[2] };
  }

  const prefix = metadata.resources.glyphs.split(glyphTemplate)[0];
  for (const font of metadata.resources.fontStacks) {
    const fontPrefix = `${prefix}${encodeURIComponent(font)}/`;
    if (!url.startsWith(fontPrefix)) continue;
    const range = glyphRangePattern.exec(url.slice(fontPrefix.length));
    if (!range || `${fontPrefix}${range[0]}` !== url) return;
    const first = Number(range[1]);
    const last = Number(range[2]);
    if (first % 256 === 0 && last === first + 255 && last <= 65_535)
      return { kind: 'glyph' as const, font, first, last };
  }
}

function readCoverage(value: unknown, region: BackgroundMapPlan['bounds']) {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite))
    throw new BackgroundMapMetadataError('tile-json');
  const [west, south, east, north] = value as [number, number, number, number];
  if (
    west < -180 ||
    south < -90 ||
    east > 180 ||
    north > 90 ||
    west > region[0] ||
    south > region[1] ||
    east < region[2] ||
    north < region[3]
  ) {
    throw new BackgroundMapMetadataError('tile-json');
  }
  return [west, south, east, north];
}

/** Checks two local documents against a separately reviewed reference before planning a region. */
export async function planBackgroundMapFromMetadata(
  regionId: string,
  bytes: MetadataBytes,
  reference: ReviewedMetadata,
  digestSha256: Sha256,
  minZoom?: number,
  maxZoom?: number,
): Promise<BackgroundMapMetadata> {
  const { styleSha256, tileJsonSha256, tileVersion } = reference;
  if (
    typeof tileJsonSha256 !== 'string' ||
    tileJsonSha256.length !== 64 ||
    !sha256Pattern.test(tileJsonSha256)
  ) {
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

  const style = readJson(styleBytes, 'style');
  const { sprite, rasterSource, fontStacks } = readStyleSources(style);
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
    tileJson.maxzoom > 22 ||
    typeof tileJson.attribution !== 'string' ||
    !tileJson.attribution.trim() ||
    tileJson.attribution.length > 4096
  ) {
    throw new BackgroundMapMetadataError('tile-json');
  }

  const bounds = readCoverage(tileJson.bounds, plan.bounds);
  // Inline the verified TileJSON fields so MapLibre cannot resolve a newer /planet version.
  const offlineStyleJson = JSON.stringify({
    ...style,
    sources: {
      ne2_shaded: rasterSource,
      openmaptiles: {
        type: 'vector',
        tiles: [vector],
        scheme: 'xyz',
        bounds,
        minzoom: tileJson.minzoom,
        maxzoom: tileJson.maxzoom,
        attribution: tileJson.attribution,
      },
    },
  });

  return Object.freeze({
    plan,
    tileJsonSha256,
    offlineStyleJson,
    resources: Object.freeze({ vector, raster, glyphs, fontStacks, sprite }),
  });
}
