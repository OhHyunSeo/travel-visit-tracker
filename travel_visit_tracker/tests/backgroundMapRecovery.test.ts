import { beforeEach, describe, expect, it, vi } from 'vitest';
import { regions } from '../src/data/regions';
import { createBackgroundMapPackMetadata } from '../src/domain/backgroundMapPack';
import { planBackgroundMap } from '../src/domain/backgroundMapPlan';
import { recoverInstalledBackgroundMapOperation } from '../src/services/backgroundMapRecovery.native';

const native = vi.hoisted(() => ({
  get: vi.fn(),
  getPacks: vi.fn(),
  current: vi.fn(),
  bindPack: vi.fn(),
}));
vi.mock('react-native', () => ({ TurboModuleRegistry: { get: native.get } }));
vi.mock('../src/storage/database', () => ({
  getBackgroundMapOperationRepository: async () => ({
    current: native.current,
    bindPack: native.bindPack,
  }),
}));

const id = '6800ff32-85b5-479a-a4bb-64929a6d5a80';
const plan = planBackgroundMap(regions[0].id, {
  tileVersion: '20261028_120000_pt',
  styleSha256: 'a'.repeat(64),
});
const metadata = createBackgroundMapPackMetadata(plan, {
  operationId: '9729af8d-20ac-42db-ae59-3773944d5530',
  tileJsonSha256: 'b'.repeat(64),
  localStyleSha256: 'c'.repeat(64),
});

beforeEach(() => {
  vi.resetAllMocks();
  native.current.mockResolvedValue({ metadata, packId: null });
  native.bindPack.mockResolvedValue(true);
  native.get.mockReturnValue({ getPacks: native.getPacks });
});

describe('installed background map recovery', () => {
  it('reads a fresh SDK list on each recovery and can find a newly created pack', async () => {
    native.getPacks
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id, bounds: plan.bounds, metadata: JSON.stringify(metadata) }]);
    await expect(recoverInstalledBackgroundMapOperation()).resolves.toEqual({
      kind: 'awaiting-pack',
    });
    await expect(recoverInstalledBackgroundMapOperation()).resolves.toEqual({
      kind: 'found',
      packId: id,
    });
    expect(native.getPacks).toHaveBeenCalledTimes(2);
    expect(native.get).toHaveBeenCalledWith('MLRNOfflineModule');
    expect(native.bindPack).toHaveBeenCalledExactlyOnceWith(metadata, id);
  });

  it('leaves the native pack store closed when there is no saved operation', async () => {
    native.current.mockResolvedValue(null);
    await expect(recoverInstalledBackgroundMapOperation()).resolves.toEqual({ kind: 'idle' });
    expect(native.get).not.toHaveBeenCalled();
  });

  it('preserves the pending operation if the native list is unreadable', async () => {
    native.getPacks.mockResolvedValue([{ id, bounds: plan.bounds, metadata: '{truncated' }]);
    await expect(recoverInstalledBackgroundMapOperation()).rejects.toThrow();
    expect(native.bindPack).not.toHaveBeenCalled();
  });
});
