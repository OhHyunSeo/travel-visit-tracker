import { findBackgroundMapPack } from '../domain/backgroundMapPack';
import type { BackgroundMapOperationRepository } from '../storage/backgroundMapOperationRepository';

type Pack = { id: string; bounds: unknown; metadata: unknown };
type OperationStore = Pick<BackgroundMapOperationRepository, 'current' | 'bindPack'>;

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
