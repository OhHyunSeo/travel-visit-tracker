import {
  createBackgroundMapPackMetadata,
  findBackgroundMapPack,
} from '../domain/backgroundMapPack';
import {
  planBackgroundMapFromMetadata,
  type BackgroundMapMetadataBytes,
  type BackgroundMapSha256,
  type ReviewedBackgroundMapMetadata,
} from '../domain/backgroundMapMetadata';
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

/** Verify the source data and save the exact generated style identity before any SDK call. */
export async function prepareBackgroundMapOperation(
  store: Pick<BackgroundMapOperationRepository, 'prepare'>,
  input: BackgroundMapPreparation,
  digestSha256: BackgroundMapSha256,
) {
  const { operationId, regionId, bytes, reference, minZoom, maxZoom } = input;
  const reviewed = await planBackgroundMapFromMetadata(
    regionId,
    bytes,
    reference,
    digestSha256,
    minZoom,
    maxZoom,
  );
  const localStyleSha256 = await digestSha256(new TextEncoder().encode(reviewed.offlineStyleJson));
  const metadata = createBackgroundMapPackMetadata(reviewed.plan, {
    operationId,
    tileJsonSha256: reviewed.tileJsonSha256,
    localStyleSha256,
  });
  return (await store.prepare(metadata))
    ? { kind: 'prepared' as const, metadata, styleJson: reviewed.offlineStyleJson }
    : { kind: 'busy' as const };
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
