import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  backgroundMapStatusMessage,
  checkBackgroundMapStatus,
} from '../src/ui/BackgroundMapStatus.native';

const recover = vi.hoisted(() => vi.fn());
vi.mock('expo-router', () => ({ useFocusEffect: vi.fn() }));
vi.mock('react-native', () => ({
  Pressable: 'button',
  Text: 'span',
  View: 'section',
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock('../src/services/backgroundMapRecovery.native', () => ({
  recoverInstalledBackgroundMapOperation: recover,
}));

const progress = {
  packId: 'test-pack',
  completedResourceCount: 2,
  completedTileCount: 1,
  requiredResourceCount: 2,
};
const complete = { ...progress, kind: 'complete' as const };

afterEach(() => {
  vi.useRealTimers();
  recover.mockReset();
});

describe('background map settings status', () => {
  it('does not display a fully counted download as completed while the SDK reports it active', () => {
    expect(backgroundMapStatusMessage({ ...progress, kind: 'incomplete', downloading: true })).toBe(
      '배경 지도를 저장하고 있습니다.',
    );
    expect(backgroundMapStatusMessage(complete)).toBe('배경 지도 저장이 완료됐습니다.');
  });

  it('displays a failure if checking stalls and ignores its late completion', async () => {
    vi.useFakeTimers();
    const answer = Promise.withResolvers<typeof complete>();
    recover.mockReturnValue(answer.promise);
    const update = vi.fn();
    checkBackgroundMapStatus(update);
    await vi.advanceTimersByTimeAsync(10_000);
    answer.resolve(complete);
    await answer.promise;
    expect(update.mock.calls).toEqual([[{ kind: 'checking' }], [{ kind: 'error' }]]);
  });

  it('ignores earlier results after leaving, and displays a fresh result on the next check', async () => {
    const earlier = Promise.withResolvers<typeof complete>();
    recover.mockReturnValueOnce(earlier.promise).mockResolvedValueOnce({ kind: 'idle' });
    const update = vi.fn();
    const blur = checkBackgroundMapStatus(update);
    blur();
    checkBackgroundMapStatus(update);
    earlier.resolve(complete);
    await earlier.promise;
    expect(update.mock.calls).toEqual([
      [{ kind: 'checking' }],
      [{ kind: 'checking' }],
      [{ kind: 'idle' }],
    ]);
  });
});
