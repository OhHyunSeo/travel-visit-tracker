import { TurboModuleRegistry, type TurboModule } from 'react-native';
import { getBackgroundMapOperationRepository } from '../storage/database';
import { recoverBackgroundMapOperation } from './backgroundMapOperation';

interface NativeOfflineMaps extends TurboModule {
  getPacks(): Promise<unknown>;
  getPackStatus(id: string): Promise<unknown>;
}

function nativeOfflineMaps() {
  // The public JS OfflineManager caches its first list. Recovery needs a fresh native listing.
  const module = TurboModuleRegistry.get<NativeOfflineMaps>('MLRNOfflineModule');
  if (!module) throw new Error('Native background map listing is unavailable');
  return module;
}

async function listNativePacks() {
  const packs = await nativeOfflineMaps().getPacks();
  if (!Array.isArray(packs)) throw new Error('Invalid native background map listing');
  return packs.map((pack: unknown) => {
    if (!pack || typeof pack !== 'object') throw new Error('Invalid native background map pack');
    const { id, bounds, metadata } = pack as Record<string, unknown>;
    if (typeof id !== 'string' || typeof metadata !== 'string' || metadata.length > 64 * 1024)
      throw new Error('Invalid native background map pack');
    return { id, bounds, metadata: JSON.parse(metadata) as unknown };
  });
}

/** Read the current SDK list only when a saved operation needs to be reconciled. */
export async function recoverInstalledBackgroundMapOperation() {
  const repository = await getBackgroundMapOperationRepository();
  const result = await recoverBackgroundMapOperation(repository, listNativePacks);
  if (result.kind !== 'found') return result;

  const packId = result.packId;
  const status = await nativeOfflineMaps().getPackStatus(packId);
  if (status === null) return { kind: 'missing-pack' as const, packId };
  if (!status || typeof status !== 'object')
    throw new Error('Invalid native background map status');
  const { id, state, completedResourceCount, requiredResourceCount, completedTileCount } =
    status as Record<string, unknown>;
  // iOS reports UINT64_MAX while the expected size is unknown; Android may report -1.
  const required =
    requiredResourceCount === 2 ** 64 || requiredResourceCount === -1
      ? null
      : requiredResourceCount;
  if (
    id !== packId ||
    !isResourceCount(completedResourceCount) ||
    (required !== null && !isResourceCount(required)) ||
    !isResourceCount(completedTileCount) ||
    completedTileCount > completedResourceCount
  )
    throw new Error('Invalid native background map status');
  const progress = { completedResourceCount, requiredResourceCount: required, completedTileCount };
  if (state === 'inactive' || state === 'active')
    return { kind: 'incomplete' as const, packId, downloading: state === 'active', ...progress };
  if (
    state !== 'complete' ||
    required === null ||
    required === 0 ||
    completedTileCount === 0 ||
    completedResourceCount < required
  )
    throw new Error('Invalid native background map completion');
  return { kind: 'complete' as const, packId, ...progress };
}

function isResourceCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
