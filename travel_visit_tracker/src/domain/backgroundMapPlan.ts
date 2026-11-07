import { regionById, regionPack } from '../data/regions';

// These are planning targets. Native transport must enforce the actual download budget.
export const backgroundMapPolicy = Object.freeze({
  revision: 'ofm-liberty-2026-10-28',
  minZoom: 8,
  maxZoom: 12,
  maxTileAttempts: 2500,
  maxBodyBytes: 50_000_000,
  maxConcurrentRequests: 4,
  maxActiveDownloads: 1,
});

export type BackgroundMapRevision = Readonly<{
  styleSha256: string;
  tileVersion: string;
}>;
export type TileRange = Readonly<{
  source: 'vector' | 'raster';
  zoom: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  count: number;
}>;
export type BackgroundMapPlan = Readonly<{
  schemaVersion: 1;
  provider: 'openfreemap';
  style: 'liberty';
  policyRevision: string;
  boundaryPackId: string;
  boundaryPackVersion: string;
  regionId: string;
  bounds: readonly [number, number, number, number];
  minZoom: number;
  maxZoom: number;
  revision: BackgroundMapRevision;
  tileRanges: readonly TileRange[];
  estimatedTileCount: number;
}>;

export class BackgroundMapPlanError extends Error {
  constructor(public readonly reason: 'region' | 'zoom' | 'revision' | 'tile-target' | 'manifest') {
    super(`Invalid background map plan: ${reason}`);
  }
}

const maxLatitude = (Math.atan(Math.sinh(Math.PI)) * 180) / Math.PI;

function tileRange(
  bounds: readonly [number, number, number, number],
  zoom: number,
  source: TileRange['source'],
): TileRange {
  const scale = 2 ** zoom;
  const x = (longitude: number) => Math.floor(((longitude + 180) / 360) * scale);
  const y = (latitude: number) => {
    const radians = (latitude * Math.PI) / 180;
    return Math.floor(((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * scale);
  };
  const clamp = (value: number) => Math.min(scale - 1, Math.max(0, value));
  // A one-tile margin is an estimate, not a claim about the SDK's requested tile set.
  const minX = clamp(x(bounds[0]) - 1);
  const maxX = clamp(x(bounds[2]) + 1);
  const minY = clamp(y(bounds[3]) - 1);
  const maxY = clamp(y(bounds[1]) + 1);
  return Object.freeze({
    source,
    zoom,
    minX,
    maxX,
    minY,
    maxY,
    count: (maxX - minX + 1) * (maxY - minY + 1),
  });
}

/** Pure preview: does not create an SDK pack, open a DB, or make network requests. */
export function planBackgroundMap(
  regionId: string,
  revision: BackgroundMapRevision,
  minZoom: number = backgroundMapPolicy.minZoom,
  maxZoom: number = backgroundMapPolicy.maxZoom,
): BackgroundMapPlan {
  const region = regionById.get(regionId);
  const bounds = region?.bounds;
  if (
    !bounds ||
    bounds.length !== 4 ||
    !bounds.every(Number.isFinite) ||
    bounds[0] < -180 ||
    bounds[2] > 180 ||
    bounds[1] < -maxLatitude ||
    bounds[3] > maxLatitude ||
    bounds[0] >= bounds[2] ||
    bounds[1] >= bounds[3]
  )
    throw new BackgroundMapPlanError('region');
  if (
    !Number.isInteger(minZoom) ||
    !Number.isInteger(maxZoom) ||
    minZoom < backgroundMapPolicy.minZoom ||
    maxZoom > backgroundMapPolicy.maxZoom ||
    minZoom > maxZoom
  )
    throw new BackgroundMapPlanError('zoom');
  if (
    !revision ||
    typeof revision.styleSha256 !== 'string' ||
    typeof revision.tileVersion !== 'string' ||
    !/^[a-f0-9]{64}$/.test(revision.styleSha256) ||
    !/^\d{8}_\d{6}_pt$/.test(revision.tileVersion)
  )
    throw new BackgroundMapPlanError('revision');

  const tileRanges: TileRange[] = [];
  for (let zoom = minZoom; zoom <= maxZoom; zoom++)
    tileRanges.push(tileRange(bounds, zoom, 'vector'));
  // Conservatively include Liberty's low-zoom raster ancestor, even at zoom 8+.
  tileRanges.push(tileRange(bounds, 6, 'raster'));
  const estimatedTileCount = tileRanges.reduce((sum, range) => sum + range.count, 0);
  if (estimatedTileCount > backgroundMapPolicy.maxTileAttempts)
    throw new BackgroundMapPlanError('tile-target');

  return Object.freeze({
    schemaVersion: 1,
    provider: 'openfreemap',
    style: 'liberty',
    policyRevision: backgroundMapPolicy.revision,
    boundaryPackId: regionPack.id,
    boundaryPackVersion: regionPack.version,
    regionId,
    bounds: Object.freeze([...bounds] as [number, number, number, number]),
    minZoom,
    maxZoom,
    revision: Object.freeze({
      styleSha256: revision.styleSha256,
      tileVersion: revision.tileVersion,
    }),
    tileRanges: Object.freeze(tileRanges),
    estimatedTileCount,
  });
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== 'object' || !left || typeof right !== 'object' || !right) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameJsonValue(a[key], b[key]))
  );
}

/** Rebuild derived values instead of trusting counts, bounds or versions saved in JSON.
 * A revision identifies reviewed metadata; it does not verify style bytes or authorize HTTP.
 */
export function readBackgroundMapPlan(serialized: string): BackgroundMapPlan {
  try {
    if (typeof serialized !== 'string' || serialized.length > 16_384)
      throw new BackgroundMapPlanError('manifest');
    const input = JSON.parse(serialized) as BackgroundMapPlan;
    const plan = planBackgroundMap(input.regionId, input.revision, input.minZoom, input.maxZoom);
    if (!sameJsonValue(input, plan)) throw new BackgroundMapPlanError('manifest');
    return plan;
  } catch {
    throw new BackgroundMapPlanError('manifest');
  }
}
