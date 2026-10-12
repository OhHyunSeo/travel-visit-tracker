import { DatabaseSync } from 'node:sqlite';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Repository, type SqlConnection } from '../src/storage/repository';
import type { LocationObject } from 'expo-location';
import { advanceDwell } from '../src/domain/dwell';

const mocks = vi.hoisted(() => ({
  platform: { OS: 'ios', Version: 37 },
  notifications: {
    PERMISSIONS: { POST_NOTIFICATIONS: 'android.permission.POST_NOTIFICATIONS' },
    check: vi.fn(),
    request: vi.fn(),
  },
  saveObservations: vi.fn(),
  location: {
    Accuracy: { High: 4 },
    ActivityType: { Other: 1 },
    hasServicesEnabledAsync: vi.fn(),
    requestForegroundPermissionsAsync: vi.fn(),
    requestBackgroundPermissionsAsync: vi.fn(),
    getForegroundPermissionsAsync: vi.fn(),
    getBackgroundPermissionsAsync: vi.fn(),
    hasStartedLocationUpdatesAsync: vi.fn(),
    startLocationUpdatesAsync: vi.fn(),
    stopLocationUpdatesAsync: vi.fn(),
    watchPositionAsync: vi.fn(),
  },
}));
vi.mock('react-native', () => ({
  Platform: mocks.platform,
  PermissionsAndroid: mocks.notifications,
}));
vi.mock('expo-location', () => mocks.location);
vi.mock('../src/services/locationTask', () => ({ LOCATION_TASK: 'test-location' }));
vi.mock('../src/services/observations', () => ({ saveObservations: mocks.saveObservations }));
let repository: Repository;
vi.mock('../src/storage/database', () => ({ getRepository: async () => repository }));
let db: DatabaseSync;
let tracking: typeof import('../src/services/tracking');
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('__DEV__', true);
  mocks.platform.OS = 'ios';
  mocks.platform.Version = 37;
  mocks.notifications.check.mockResolvedValue(false);
  mocks.notifications.request.mockResolvedValue('granted');
  mocks.saveObservations.mockReset().mockResolvedValue(undefined);
  db = new DatabaseSync(':memory:');
  const connection: SqlConnection = {
    exec: async (sql) => {
      db.exec(sql);
    },
    run: async (sql, ...params) => ({ changes: Number(db.prepare(sql).run(...params).changes) }),
    first: async <T>(sql: string, ...params: (string | number | null)[]) =>
      (db.prepare(sql).get(...params) as T | undefined) ?? null,
    all: async <T>(sql: string, ...params: (string | number | null)[]) =>
      db.prepare(sql).all(...params) as T[],
  };
  repository = new Repository(connection);
  await repository.initialize({ id: 'pack', version: 'v1', count: 1 }, [{ id: 'A', name: 'A' }]);
  mocks.location.hasServicesEnabledAsync.mockResolvedValue(true);
  for (const name of [
    'requestForegroundPermissionsAsync',
    'requestBackgroundPermissionsAsync',
    'getForegroundPermissionsAsync',
    'getBackgroundPermissionsAsync',
  ] as const)
    mocks.location[name].mockResolvedValue({ status: 'granted' });
  mocks.location.hasStartedLocationUpdatesAsync.mockResolvedValue(false);
  mocks.location.startLocationUpdatesAsync.mockResolvedValue(undefined);
  mocks.location.stopLocationUpdatesAsync.mockResolvedValue(undefined);
  mocks.location.watchPositionAsync.mockResolvedValue({ remove: vi.fn() });
  tracking = await import('../src/services/tracking');
});
afterEach(() => {
  db.close();
  vi.unstubAllGlobals();
});
async function seedCandidate(lastObservedAt = Date.now()) {
  const candidate = {
    id: 'health-session',
    regionId: 'A',
    startedAt: lastObservedAt - 60000,
    lastObservedAt,
    confirmedAt: null,
  };
  await repository.processObservation(
    () => ({ candidate, confirmed: null, status: 'candidate', message: '체류 확인 중' }),
    () => 'unused',
  );
  return candidate;
}
describe('recording health while the app stays open', () => {
  it('does not query or request permissions when recording is off', async () => {
    await tracking.checkTrackingHealth();
    expect(mocks.location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(mocks.location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });
  it('preserves a healthy candidate and its progress message without replacing the watcher', async () => {
    await tracking.startTracking(false);
    const candidate = await seedCandidate();
    await tracking.checkTrackingHealth();
    const state = await repository.snapshot(false);
    expect(state.candidate).toEqual(candidate);
    expect(state.status).toBe('candidate');
    expect(state.message).toBe('체류 확인 중');
    expect(mocks.location.watchPositionAsync).toHaveBeenCalledOnce();
  });
  it.each(['service', 'permission'])(
    'stops foreground recording after %s becomes unavailable',
    async (reason) => {
      await tracking.startTracking(false);
      await seedCandidate();
      if (reason === 'service') mocks.location.hasServicesEnabledAsync.mockResolvedValue(false);
      else mocks.location.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
      await tracking.checkTrackingHealth();
      const state = await repository.snapshot(false);
      expect(state.recording).toBe(false);
      expect(state.candidate).toBeNull();
      expect(state.status).toBe('uncertain');
      expect(state.diagnostics.collectorMode).toBe('off');
      expect(mocks.location.requestForegroundPermissionsAsync).toHaveBeenCalledOnce();
    },
  );
  it('clears continuity when background permission is revoked and falls back to foreground', async () => {
    await tracking.startTracking(true);
    await seedCandidate();
    mocks.location.hasStartedLocationUpdatesAsync
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    mocks.location.getBackgroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
    await tracking.checkTrackingHealth();
    const state = await repository.snapshot(false);
    expect(state.recording).toBe(true);
    expect(state.recordingMode).toBe('background');
    expect(state.diagnostics.collectorMode).toBe('foreground');
    expect(state.candidate).toBeNull();
    expect(mocks.location.stopLocationUpdatesAsync).toHaveBeenCalledOnce();
    expect(mocks.location.watchPositionAsync).toHaveBeenCalledOnce();
  });
  it('expires an unobserved candidate even without another location callback', async () => {
    await tracking.startTracking(false);
    await seedCandidate(Date.now() - 121000);
    await tracking.checkTrackingHealth();
    const state = await repository.snapshot(false);
    expect(state.candidate).toBeNull();
    expect(state.recording).toBe(true);
    expect(state.status).toBe('uncertain');
    expect(state.visits).toHaveLength(0);
  });
  it('does not expire a newer sample saved while the health check awaits permissions', async () => {
    await tracking.startTracking(false);
    await seedCandidate(Date.now() - 121000);
    let release!: () => void;
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    mocks.location.getForegroundPermissionsAsync.mockImplementationOnce(async () => {
      enter();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { status: 'granted' };
    });
    const health = tracking.checkTrackingHealth();
    await entered;
    const fresh = await seedCandidate();
    release();
    await health;
    expect((await repository.snapshot(false)).candidate).toEqual(fresh);
  });
  it('preserves the progress message on ordinary foreground reconciliation', async () => {
    await tracking.startTracking(false);
    const candidate = await seedCandidate();
    await tracking.reconcileTracking();
    const state = await repository.snapshot(false);
    expect(state.candidate).toEqual(candidate);
    expect(state.message).toBe('체류 확인 중');
  });
});
describe('location mode and permissions', () => {
  it('keeps Android background recording available when notification permission is denied', async () => {
    mocks.platform.OS = 'android';
    mocks.notifications.request.mockResolvedValue('denied');
    await tracking.startTracking(true);
    expect(mocks.notifications.request).toHaveBeenCalledWith(
      'android.permission.POST_NOTIFICATIONS',
    );
    expect(mocks.location.startLocationUpdatesAsync).toHaveBeenCalledOnce();
    expect((await repository.snapshot(false)).diagnostics.collectorMode).toBe('background');
  });
  it('does not prompt for Android notifications during foreground recording or restoration', async () => {
    mocks.platform.OS = 'android';
    await tracking.startTracking(false);
    await repository.setRecording(true, 'background');
    await tracking.reconcileTracking();
    expect(mocks.notifications.request).not.toHaveBeenCalled();
  });
  it('does not request a runtime notification permission on Android before API 33', async () => {
    mocks.platform.OS = 'android';
    mocks.platform.Version = 32;
    await tracking.startTracking(true);
    expect(mocks.notifications.request).not.toHaveBeenCalled();
    expect(mocks.location.startLocationUpdatesAsync).toHaveBeenCalledOnce();
  });
  it('requests foreground permission only for foreground recording', async () => {
    await tracking.startTracking(false);
    expect(mocks.location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    expect(mocks.location.watchPositionAsync).toHaveBeenCalledOnce();
    expect((await repository.snapshot(false)).recordingMode).toBe('foreground');
  });
  it('keeps the selected foreground mode after restart even with Always permission', async () => {
    await repository.setRecording(true, 'foreground');
    await tracking.reconcileTracking();
    expect(mocks.location.startLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(mocks.location.watchPositionAsync).toHaveBeenCalledOnce();
  });
  it('requests both permissions before starting background recording', async () => {
    await tracking.startTracking(true);
    expect(mocks.location.requestForegroundPermissionsAsync).toHaveBeenCalledOnce();
    expect(mocks.location.requestBackgroundPermissionsAsync).toHaveBeenCalledOnce();
    expect(mocks.location.startLocationUpdatesAsync).toHaveBeenCalledOnce();
    expect((await repository.snapshot(false)).recordingMode).toBe('background');
  });
  it('stops a persisted background service when Always permission is revoked', async () => {
    await repository.setRecording(true, 'background');
    mocks.location.getBackgroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
    mocks.location.hasStartedLocationUpdatesAsync.mockResolvedValue(true);
    await tracking.reconcileTracking();
    expect(mocks.location.stopLocationUpdatesAsync).toHaveBeenCalledOnce();
    expect(mocks.location.watchPositionAsync).toHaveBeenCalledOnce();
    expect(mocks.location.startLocationUpdatesAsync).not.toHaveBeenCalled();
    expect((await repository.snapshot(false)).recording).toBe(true);
  });
  it('does not silently continue after background permission denial', async () => {
    mocks.location.requestBackgroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
    await expect(tracking.startTracking(true)).rejects.toThrow('항상 허용');
    expect(mocks.location.startLocationUpdatesAsync).not.toHaveBeenCalled();
    expect((await repository.snapshot(false)).recording).toBe(false);
  });
  it('allows map access without requesting any permission during startup', async () => {
    await tracking.reconcileTracking();
    expect(mocks.location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(mocks.location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });
  it('does not mark recording active if native service startup fails', async () => {
    mocks.location.startLocationUpdatesAsync.mockRejectedValue(new Error('service failure'));
    await expect(tracking.startTracking(true)).rejects.toThrow('service failure');
    expect((await repository.snapshot(false)).recording).toBe(false);
  });
  it('stops desired recording when foreground permission is revoked', async () => {
    await repository.setRecording(true, 'background');
    mocks.location.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
    await tracking.reconcileTracking();
    const state = await repository.snapshot(false);
    expect(state.recording).toBe(false);
    expect(state.status).toBe('uncertain');
  });
  it('drops a candidate when foreground-only recording leaves the screen', async () => {
    await tracking.startTracking(false);
    const now = Date.now();
    await repository.processObservation(
      () => ({
        candidate: {
          id: 'c',
          regionId: 'A',
          startedAt: now - 1000,
          lastObservedAt: now,
          confirmedAt: null,
        },
        confirmed: null,
        status: 'candidate',
        message: '',
      }),
      () => 'unused',
    );
    await tracking.onAppBackground();
    const state = await repository.snapshot(false);
    expect(state.candidate).toBeNull();
    expect(state.recording).toBe(true);
    expect(state.status).toBe('uncertain');
  });
  it('drops stale candidates on foreground restoration', async () => {
    await repository.setRecording(true);
    const now = Date.now();
    await repository.processObservation(
      () => ({
        candidate: {
          id: 'c',
          regionId: 'A',
          startedAt: now - 600000,
          lastObservedAt: now - 300000,
          confirmedAt: null,
        },
        confirmed: null,
        status: 'candidate',
        message: '',
      }),
      () => 'unused',
    );
    await tracking.reconcileTracking();
    expect((await repository.snapshot(false)).candidate).toBeNull();
  });
  it('does not start native recording in browser previews', async () => {
    mocks.platform.OS = 'web';
    await expect(tracking.startTracking(true)).rejects.toThrow('개발 빌드');
    expect(mocks.location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });
  it('serializes repeated start and stop requests', async () => {
    await Promise.all([tracking.startTracking(false), tracking.stopTracking()]);
    expect((await repository.snapshot(false)).recording).toBe(false);
  });
  it('preserves a foreground candidate through a brief iOS inactive state', async () => {
    await tracking.startTracking(false);
    const now = Date.now();
    const candidate = {
      id: 'short-overlay',
      regionId: 'A',
      startedAt: now - 240000,
      lastObservedAt: now,
      confirmedAt: null,
    };
    await repository.processObservation(
      () => ({ candidate, confirmed: null, status: 'candidate', message: '확인 중' }),
      () => 'unused',
    );
    await tracking.onAppStateChange('inactive');
    await tracking.onAppStateChange('active');
    expect((await repository.snapshot(false)).candidate).toEqual(candidate);
    const subscription = await mocks.location.watchPositionAsync.mock.results[0].value;
    expect(subscription.remove).not.toHaveBeenCalled();
  });
  it('stops foreground collection if the app backgrounds during native startup', async () => {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const remove = vi.fn();
    mocks.location.watchPositionAsync.mockImplementationOnce(() => {
      entered();
      return new Promise((resolve) => {
        release = () => resolve({ remove });
      });
    });
    const starting = tracking.startTracking(false);
    await started;
    const leaving = tracking.onAppStateChange('background');
    release();
    await Promise.all([starting, leaving]);
    expect(remove).toHaveBeenCalledOnce();
    const state = await repository.snapshot(false);
    expect(state.recording).toBe(true);
    expect(state.candidate).toBeNull();
    expect(state.status).toBe('uncertain');
    expect(state.diagnostics.collectorMode).toBe('off');
  });
  it('ignores callbacks from a foreground subscription after leaving the screen', async () => {
    await tracking.startTracking(false);
    const callback = mocks.location.watchPositionAsync.mock.calls[0][1] as (
      location: LocationObject,
    ) => void;
    await tracking.onAppStateChange('background');
    callback({
      coords: { latitude: 37, longitude: 127, accuracy: 10 },
      timestamp: Date.now(),
    } as LocationObject);
    expect(mocks.saveObservations).not.toHaveBeenCalled();
    expect((await repository.snapshot(false)).candidate).toBeNull();
  });
  it('guards a foreground callback already waiting across an asynchronous save boundary', async () => {
    let release!: () => void;
    let entered!: () => void;
    const saving = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let finished!: Promise<void>;
    mocks.saveObservations.mockImplementationOnce((samples, shouldProcess) => {
      finished = (async () => {
        entered();
        await waiting;
        const sample = samples[0];
        await repository.processObservation(
          (previous) =>
            advanceDwell(
              previous,
              { ...sample, regionId: 'A', boundaryDistanceM: 500 },
              sample.timestamp,
              () => 'late-session',
            ),
          () => 'late-visit',
          { ...sample, receivedAt: sample.timestamp },
          shouldProcess,
        );
      })();
      return finished;
    });
    await tracking.startTracking(false);
    const callback = mocks.location.watchPositionAsync.mock.calls[0][1] as (
      location: LocationObject,
    ) => void;
    callback({
      coords: { latitude: 37, longitude: 127, accuracy: 10 },
      timestamp: Date.now(),
    } as LocationObject);
    await saving;
    await tracking.onAppStateChange('background');
    release();
    await finished;
    const state = await repository.snapshot(false);
    expect(state.recording).toBe(true);
    expect(state.diagnostics.collectorMode).toBe('off');
    expect(state.candidate).toBeNull();
    expect(state.visits).toHaveLength(0);
    expect(state.diagnostics.lastResetReason).toContain('화면 밖');
  });
  it('does not interrupt a replacement collector when an old save later fails', async () => {
    let rejectOld!: (error: Error) => void;
    mocks.saveObservations.mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          rejectOld = reject;
        }),
    );
    await tracking.startTracking(false);
    const callback = mocks.location.watchPositionAsync.mock.calls[0][1] as (
      location: LocationObject,
    ) => void;
    callback({
      coords: { latitude: 37, longitude: 127, accuracy: 10 },
      timestamp: Date.now(),
    } as LocationObject);
    await tracking.startTracking(false);
    const interrupt = vi.spyOn(repository, 'interruptCandidate');
    rejectOld(new Error('old collector disk failure'));
    await Promise.resolve();
    await Promise.resolve();
    expect(interrupt).not.toHaveBeenCalled();
    expect((await repository.snapshot(false)).diagnostics.collectorMode).toBe('foreground');
  });
});
