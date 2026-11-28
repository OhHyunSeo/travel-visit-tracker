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
import type {
  BackgroundMapOperation,
  BackgroundMapOperationRepository,
} from '../storage/backgroundMapOperationRepository';

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
type SavedPreparationStore = PreparedDownloadStore & Pick<BackgroundMapOperationRepository, 'current'>;

function localBackgroundMapStyleAddress(metadata: BackgroundMapPackMetadata): string {
  const { operationId, localStyleSha256 } = metadata;
  return `https://offline-style.trip-painting.invalid/v1/${operationId}/${localStyleSha256}.json`;
}

function backgroundMapRequestScope(
  metadata: BackgroundMapPackMetadata,
  plan: BackgroundMapPlan,
  resources: BackgroundMapResources,
): BackgroundMapRequestScope {
  return Object.freeze({
    schemaVersion: 1,
    origin: backgroundMapOrigin,
    operationId: metadata.operationId,
    localStyleSha256: metadata.localStyleSha256,
    tileJsonSha256: metadata.tileJsonSha256,
    plan,
    resources,
    limits: downloadLimits,
  });
}

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

  const requestScope = backgroundMapRequestScope(metadata, reviewed.plan, reviewed.resources);
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
  const address = localBackgroundMapStyleAddress(prepared.metadata);
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
  return (await verifySavedBackgroundMapStyle(metadata, bytes, digestSha256)).styleJson;
}

/** Rebuild the scope of a saved preparation before any native registration or SDK call. */
export async function recoverPreparedBackgroundMapDownload(
  store: SavedPreparationStore,
  bytes: BackgroundMapMetadataBytes,
  digestSha256: BackgroundMapSha256,
): Promise<PreparedBackgroundMapDownload | null> {
  const current = await store.current();
  if (!current || current.packId !== null) return null;

  const metadata = readBackgroundMapPackMetadata(current.metadata);
  const snapshot = await verifyPreparedBackgroundMapRecord(store, metadata, bytes, digestSha256);
  if (!snapshot) return null;
  return Object.freeze({ metadata, requestScope: snapshot.requestScope });
}

async function verifyPreparedBackgroundMapRecord(
  store: PreparedDownloadStore,
  metadata: BackgroundMapPackMetadata,
  bytes: BackgroundMapMetadataBytes,
  digestSha256: BackgroundMapSha256,
) {
  const reviewed = await verifySavedBackgroundMapStyle(metadata, bytes, digestSha256);
  // Recheck after hashing. Another caller can attach an existing SDK pack in the meantime.
  const record = await store.preparedDownloadRecord(metadata);
  if (!record) return null;
  if (record.styleJson !== reviewed.styleJson) throw new Error('Saved background map style bytes differ');
  return {
    record,
    requestScope: backgroundMapRequestScope(metadata, reviewed.plan, reviewed.resources),
  };
}

async function verifySavedBackgroundMapStyle(
  metadata: BackgroundMapPackMetadata,
  bytes: BackgroundMapMetadataBytes,
  digestSha256: BackgroundMapSha256,
) {
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
  if (JSON.stringify(reviewed.plan) !== metadata.plan)
    throw new Error('Saved background map plan differs');
  if (reviewed.localStyleSha256 !== metadata.localStyleSha256)
    throw new Error('Saved background map style hash differs');
  return reviewed;
}

export type BackgroundMapOperationStatus =
  | { kind: 'idle' }
  | { kind: 'awaiting-pack' }
  | { kind: 'missing-pack'; packId: string }
  | { kind: 'conflict' }
  | { kind: 'found'; packId: string };

export type BackgroundMapStartDecision =
  | Exclude<BackgroundMapOperationStatus, { kind: 'awaiting-pack' }>
  | { kind: 'changed' }
  | { kind: 'unavailable' }
  | Readonly<{
      kind: 'eligible';
      requestScope: BackgroundMapRequestScope;
      scopeJSON: string;
      styleJSON: string;
      metadataJSON: string;
      styleAddress: string;
    }>;

/** Inspect a future start without registering a style, binding a pack or starting the SDK. */
export async function decideBackgroundMapStart(
  store: SavedPreparationStore,
  bytes: BackgroundMapMetadataBytes,
  digestSha256: BackgroundMapSha256,
  listPacks: () => Promise<readonly Pack[]>,
): Promise<BackgroundMapStartDecision> {
  const current = await store.current();
  if (!current) return { kind: 'idle' };

  const { metadata, packId } = current;
  const initialMatch = findBackgroundMapPack(await listPacks(), metadata, packId ?? undefined);
  const existing = initialMatch.kind === 'missing'
    ? (packId === null ? null : { kind: 'missing-pack' as const, packId })
    : initialMatch;
  if (existing) {
    if (!sameBackgroundMapOperation(current, await store.current())) return { kind: 'changed' };
    return existing;
  }

  const snapshot = await verifyPreparedBackgroundMapRecord(store, metadata, bytes, digestSha256);
  if (!snapshot) {
    return sameBackgroundMapOperation(current, await store.current()) ? { kind: 'unavailable' } : { kind: 'changed' };
  }

  // Hashing can overlap a recovery that discovers an SDK pack left by an earlier start.
  const match = findBackgroundMapPack(await listPacks(), metadata);
  const latest = await store.preparedDownloadRecord(metadata);
  if (!latest || latest.metadata !== snapshot.record.metadata || latest.styleJson !== snapshot.record.styleJson)
    return { kind: 'changed' };
  if (match.kind !== 'missing') return match;

  // Eligibility is a snapshot. The native gate must still check before creating or activating a pack.
  return Object.freeze({
    kind: 'eligible',
    requestScope: snapshot.requestScope,
    scopeJSON: JSON.stringify(snapshot.requestScope),
    styleJSON: latest.styleJson,
    metadataJSON: latest.metadata,
    styleAddress: localBackgroundMapStyleAddress(metadata),
  });
}

function sameBackgroundMapOperation(expected: BackgroundMapOperation, latest: BackgroundMapOperation | null) {
  return latest !== null && latest.packId === expected.packId &&
    JSON.stringify(latest.metadata) === JSON.stringify(expected.metadata);
}

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
