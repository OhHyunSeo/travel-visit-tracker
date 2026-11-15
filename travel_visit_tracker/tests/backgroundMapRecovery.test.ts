import { beforeEach, describe, expect, it, vi } from 'vitest';
import { regions } from '../src/data/regions';
import { createBackgroundMapPackMetadata } from '../src/domain/backgroundMapPack';
import { planBackgroundMap } from '../src/domain/backgroundMapPlan';
import { recoverInstalledBackgroundMapOperation } from '../src/services/backgroundMapRecovery.native';

const native = vi.hoisted(() => ({
  get: vi.fn(),
  getPacks: vi.fn(),
  getPackStatus: vi.fn(),
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
const pack = { id, bounds: plan.bounds, metadata: JSON.stringify(metadata) };
const complete = {
  id,
  state: 'complete',
  completedResourceCount: 2,
  requiredResourceCount: 2,
  completedTileCount: 1,
};

beforeEach(() => {
  vi.resetAllMocks();
  native.current.mockResolvedValue({ metadata, packId: null });
  native.bindPack.mockResolvedValue(true);
  native.get.mockReturnValue({ getPacks: native.getPacks, getPackStatus: native.getPackStatus });
  native.getPackStatus.mockResolvedValue(complete);
});

describe('installed background map recovery', () => {
  it('reads a fresh SDK list on each recovery and can find a newly created pack', async () => {
    native.getPacks.mockResolvedValueOnce([]).mockResolvedValueOnce([pack]);
    await expect(recoverInstalledBackgroundMapOperation()).resolves.toEqual({
      kind: 'awaiting-pack',
    });
    await expect(recoverInstalledBackgroundMapOperation()).resolves.toEqual({
      kind: 'complete',
      packId: id,
      completedResourceCount: 2,
      requiredResourceCount: 2,
      completedTileCount: 1,
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

  it('reports an incomplete pack even when the SDK estimates zero remaining work', async () => {
    native.getPacks.mockResolvedValue([pack]);
    native.getPackStatus.mockResolvedValue({ ...complete, state: 'active', percentage: 100 });
    await expect(recoverInstalledBackgroundMapOperation()).resolves.toMatchObject({
      kind: 'incomplete',
      downloading: true,
    });
  });

  it('reports disappearance during recovery without changing to an unbound operation', async () => {
    native.getPacks.mockResolvedValue([pack]);
    native.getPackStatus.mockResolvedValue(null);
    await expect(recoverInstalledBackgroundMapOperation()).resolves.toEqual({
      kind: 'missing-pack',
      packId: id,
    });
    expect(native.bindPack).toHaveBeenCalledExactlyOnceWith(metadata, id);
  });

  it.each([-1, 2 ** 64])(
    'leaves the total unknown until the SDK knows it',
    async (requiredResourceCount) => {
      native.getPacks.mockResolvedValue([pack]);
      native.getPackStatus.mockResolvedValue({
        ...complete,
        state: 'active',
        requiredResourceCount,
      });
      await expect(recoverInstalledBackgroundMapOperation()).resolves.toMatchObject({
        kind: 'incomplete',
        requiredResourceCount: null,
      });
    },
  );

  it.each([
    { id: 'another-pack' },
    { requiredResourceCount: 0 },
    { completedResourceCount: 1 },
    { completedTileCount: 0 },
  ])(
    'refuses a native completion report with inconsistent identity or resources',
    async (change) => {
      native.getPacks.mockResolvedValue([pack]);
      native.getPackStatus.mockResolvedValue({ ...complete, ...change });
      await expect(recoverInstalledBackgroundMapOperation()).rejects.toThrow();
    },
  );
});
