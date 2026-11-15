import { TurboModuleRegistry, type TurboModule } from 'react-native';
import { getBackgroundMapOperationRepository } from '../storage/database';
import { recoverBackgroundMapOperation } from './backgroundMapOperation';

interface NativeOfflineMaps extends TurboModule {
  getPacks(): Promise<unknown>;
}

async function listNativePacks() {
  // The public JS OfflineManager caches its first list. Recovery needs a fresh native listing.
  const module = TurboModuleRegistry.get<NativeOfflineMaps>('MLRNOfflineModule');
  if (!module) throw new Error('Native background map listing is unavailable');
  const packs = await module.getPacks();
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
  return recoverBackgroundMapOperation(repository, listNativePacks);
}
