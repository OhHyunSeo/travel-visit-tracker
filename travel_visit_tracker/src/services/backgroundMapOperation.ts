import {
  createBackgroundMapPackMetadata,
  findBackgroundMapPack,
  readBackgroundMapPackMetadata,
  type BackgroundMapPackMetadata,
} from '../domain/backgroundMapPack';
import {
  backgroundMapOrigin,
  planBackgroundMapFromMetadata,
  type BackgroundMapMetadataBytes,
  type BackgroundMapResources,
  type BackgroundMapSha256,
  type ReviewedBackgroundMapMetadata,
} from '../domain/backgroundMapMetadata';
import {
  backgroundMapPolicy,
  readBackgroundMapPlan,
  type BackgroundMapPlan,
} from '../domain/backgroundMapPlan';
import type { BackgroundMapOperationRepository } from '../storage/backgroundMapOperationRepository';

type Pack = { id: string; bounds: unknown; metadata: unknown };
type OperationStore = Pick<BackgroundMapOperationRepository, 'current' | 'bindPack'>;

type BackgroundMapPreparation = {
  operationId: string;
  regionId: string;
  bytes: BackgroundMapMetadataBytes;
  reference: ReviewedBackgroundMapMetadata;
  minZoom?: number;
  maxZoom?: number;
};

const downloadLimits = Object.freeze({
  maxTileAttempts: backgroundMapPolicy.maxTileAttempts,
  maxBodyBytes: backgroundMapPolicy.maxBodyBytes,
  maxConcurrentRequests: backgroundMapPolicy.maxConcurrentRequests,
});

export type BackgroundMapRequestScope = Readonly<{
  schemaVersion: 1;
  origin: typeof backgroundMapOrigin;
  operationId: string;
  localStyleSha256: string;
  tileJsonSha256: string;
  plan: BackgroundMapPlan;
  resources: BackgroundMapResources;
  limits: typeof downloadLimits;
}>;

type PreparedBackgroundMapDownload = Readonly<{
  metadata: BackgroundMapPackMetadata;
  requestScope: BackgroundMapRequestScope;
}>;

type PreparedDownloadStore = Pick<BackgroundMapOperationRepository, 'preparedDownloadRecord'>;

async function verifyBackgroundMapStyle(
  input: Omit<BackgroundMapPreparation, 'operationId'>,
  digestSha256: BackgroundMapSha256,
) {
  const { regionId, bytes, reference, minZoom, maxZoom } = input;
  const reviewed = await planBackgroundMapFromMetadata(
    regionId,
    bytes,
    reference,
    digestSha256,
    minZoom,
    maxZoom,
  );
  const styleJson = reviewed.offlineStyleJson;
  const localStyleSha256 = await digestSha256(new TextEncoder().encode(styleJson));
  return {
    plan: reviewed.plan,
    resources: reviewed.resources,
    tileJsonSha256: reviewed.tileJsonSha256,
    styleJson,
    localStyleSha256,
  };
}

/** Verify the source data and save the exact generated style identity before any SDK call. */
export async function prepareBackgroundMapOperation(
  store: Pick<BackgroundMapOperationRepository, 'prepare'>,
  input: BackgroundMapPreparation,
  digestSha256: BackgroundMapSha256,
) {
  const { operationId } = input;
  const reviewed = await verifyBackgroundMapStyle(input, digestSha256);
  const metadata = createBackgroundMapPackMetadata(reviewed.plan, {
    operationId,
    tileJsonSha256: reviewed.tileJsonSha256,
    localStyleSha256: reviewed.localStyleSha256,
  });
  if (!(await store.prepare(metadata, reviewed.styleJson))) return { kind: 'busy' as const };

  // Describe the stored operation. Native transport must validate and enforce this scope.
  const requestScope: BackgroundMapRequestScope = Object.freeze({
    schemaVersion: 1,
    origin: backgroundMapOrigin,
    operationId: metadata.operationId,
    localStyleSha256: metadata.localStyleSha256,
    tileJsonSha256: metadata.tileJsonSha256,
    plan: reviewed.plan,
    resources: reviewed.resources,
    limits: downloadLimits,
  });
  return { kind: 'prepared' as const, metadata, styleJson: reviewed.styleJson, requestScope };
}

/** Check the unbound record using the style bytes on disk. This does not reserve or start a pack. */
export async function validatePreparedBackgroundMapDownload(
  store: PreparedDownloadStore,
  prepared: PreparedBackgroundMapDownload,
  validateScope: (scope: string, style: string, metadata: string) => Promise<boolean>,
): Promise<boolean> {
  return (await readPreparedBackgroundMapDownload(store, prepared, validateScope)) === true;
}

/** Register the verified style for iOS MapLibre without turning on provider traffic. */
export async function registerPreparedBackgroundMapStyle(
  store: PreparedDownloadStore,
  prepared: PreparedBackgroundMapDownload,
  registerStyle: (scope: string, style: string, metadata: string) => Promise<string | null>,
): Promise<string | null> {
  const { operationId, localStyleSha256 } = prepared.metadata;
  const address = `https://offline-style.trip-painting.invalid/v1/${operationId}/${localStyleSha256}.json`;
  const registered = await readPreparedBackgroundMapDownload(store, prepared, registerStyle);
  return registered === address ? address : null;
}

async function readPreparedBackgroundMapDownload<T>(
  store: PreparedDownloadStore,
  prepared: PreparedBackgroundMapDownload,
  read: (scope: string, style: string, metadata: string) => Promise<T>,
): Promise<T | null> {
  const scope = JSON.stringify(prepared.requestScope);
  const record = await store.preparedDownloadRecord(prepared.metadata);
  return record ? read(scope, record.styleJson, record.metadata) : null;
}

/** Regenerate only the bytes recorded for this operation, without updating its identity. */
export async function recoverBackgroundMapStyle(
  stored: BackgroundMapPackMetadata,
  bytes: BackgroundMapMetadataBytes,
  digestSha256: BackgroundMapSha256,
): Promise<string> {
  const metadata = readBackgroundMapPackMetadata(stored);
  const plan = readBackgroundMapPlan(metadata.plan);
  const reviewed = await verifyBackgroundMapStyle(
    {
      regionId: plan.regionId,
      bytes,
      reference: { ...plan.revision, tileJsonSha256: metadata.tileJsonSha256 },
      minZoom: plan.minZoom,
      maxZoom: plan.maxZoom,
    },
    digestSha256,
  );
  if (reviewed.localStyleSha256 !== metadata.localStyleSha256)
    throw new Error('Saved background map style hash differs');
  return reviewed.styleJson;
}

export type BackgroundMapOperationStatus =
  | { kind: 'idle' }
  | { kind: 'awaiting-pack' }
  | { kind: 'missing-pack'; packId: string }
  | { kind: 'conflict' }
  | { kind: 'found'; packId: string };

/** Recover a matching pack from an authoritative SDK listing without creating or starting it. */
export async function recoverBackgroundMapOperation(
  store: OperationStore,
  listPacks: () => Promise<readonly Pack[]>,
): Promise<BackgroundMapOperationStatus> {
  const current = await store.current();
  if (!current) return { kind: 'idle' };

  const { metadata, packId } = current;
  const match = findBackgroundMapPack(await listPacks(), metadata, packId ?? undefined);
  if (match.kind === 'conflict') return { kind: 'conflict' };
  if (match.kind === 'missing')
    return packId ? { kind: 'missing-pack', packId } : { kind: 'awaiting-pack' };

  const saved = await store.bindPack(metadata, match.packId);
  return saved ? { kind: 'found', packId: match.packId } : { kind: 'conflict' };
}
