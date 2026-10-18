import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../src/services/authClient';
import type { VisitBackupResult } from '../src/services/visitBackup';
import type { VisitBackupState } from '../src/storage/outbox';
import type { AppSnapshot } from '../src/domain/types';

const mocks = vi.hoisted(() => ({
  appState: { currentState: 'active' },
  auth: {
    session: null as Session | null,
    initialize: vi.fn(),
    signIn: vi.fn(),
    logout: vi.fn(),
    check: vi.fn(),
    importGuest: vi.fn(),
  },
  getRepository: vi.fn(),
  repositoryForOwner: vi.fn(),
  run: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('react-native', () => ({ AppState: mocks.appState }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'synthetic-id' }));
vi.mock('../src/storage/database', () => ({
  getRepository: mocks.getRepository,
  repositoryForOwner: mocks.repositoryForOwner,
}));
vi.mock('../src/services/tracking', () => ({
  startTracking: vi.fn(),
  stopTracking: vi.fn(),
  reconcileTracking: vi.fn(),
}));
vi.mock('../src/services/photos', () => ({
  attachPhoto: vi.fn(),
  removePhotoFiles: vi.fn(),
  resolvePhotoUri: (uri: string) => uri,
}));
vi.mock('../src/store/useAuthStore', () => ({
  useAuthStore: { getState: () => mocks.auth },
}));
vi.mock('../src/services/visitBackup', () => ({
  VisitBackupCoordinator: class {
    run = mocks.run;
  },
}));

const accountA: Session = {
  apiUrl: 'https://backup.example.test',
  user: { id: 1, email: 'a@example.test', username: '검증 A' },
  token: 'synthetic-a-token',
};
const accountB: Session = {
  ...accountA,
  user: { id: 2, email: 'b@example.test', username: '검증 B' },
  token: 'synthetic-b-token',
};
const owner = (session: Session) => `account:${session.apiUrl}:${session.user.id}`;
const expectation = (session: Session) => ({ ownerId: owner(session), token: session.token });
const backupState = (overrides: Partial<VisitBackupState> = {}): VisitBackupState => ({
  autoEnabled: false,
  pendingVisits: 3,
  pendingPhotos: 2,
  lastSuccessAt: null,
  nextAttemptAt: null,
  connectionCheckAt: null,
  pauseReason: null,
  ...overrides,
});
function snapshot(id: string, pending: number): AppSnapshot {
  return {
    visits: [
      {
        id: `${id}-visit`,
        sessionId: `${id}-session`,
        regionId: 'synthetic-region',
        startedAt: 1000,
        confirmedAt: 301000,
        source: 'gps',
        deletedAt: null,
      },
    ],
    photos: [],
    candidate: null,
    recording: false,
    recordingMode: 'foreground',
    status: 'off',
    message: '',
    pending,
    diagnostics: {
      lastSampleAt: null,
      accuracyM: null,
      gapMs: null,
      delayMs: null,
      lastResetAt: null,
      lastResetReason: null,
      collectorMode: 'off',
    },
  };
}
function repository(ownerId: string, state = backupState()) {
  return {
    ownerId,
    state,
    snapshot: vi.fn(async () => snapshot(ownerId, state.pendingVisits + state.pendingPhotos)),
    visitBackupState: vi.fn(async () => ({ ...state })),
    setVisitBackupEnabled: vi.fn(async (enabled: boolean, stillCurrent: () => boolean) => {
      if (!stillCurrent()) throw new Error('changed session');
      state.autoEnabled = enabled;
    }),
  };
}
type TestRepository = ReturnType<typeof repository>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
const completed = (session = accountA): VisitBackupResult => ({
  ownerId: owner(session),
  acknowledged: 3,
  paused: false,
  skipped: false,
  message: '방문 전송을 마쳤습니다.',
});

let app: typeof import('../src/store/useAppStore').useAppStore;
let currentRepository: TestRepository;
let repositories: Map<string, TestRepository>;
async function show(session: Session | null, state = backupState()) {
  mocks.auth.session = session;
  currentRepository = repository(session ? owner(session) : 'guest', state);
  repositories.set(currentRepository.ownerId, currentRepository);
  await app.getState().refresh();
  return currentRepository;
}

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubGlobal('__DEV__', true);
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.appState.currentState = 'active';
  mocks.auth.session = null;
  repositories = new Map();
  mocks.getRepository.mockImplementation(async () => currentRepository);
  mocks.repositoryForOwner.mockImplementation(async (ownerId: string) => {
    const value = repositories.get(ownerId);
    if (!value) throw new Error('unknown synthetic account');
    return value;
  });
  mocks.run.mockResolvedValue(completed());
  app = (await import('../src/store/useAppStore')).useAppStore;
  app.setState({ ready: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('visit backup app integration', () => {
  it('keeps guest and default account opt-out from starting automatic backup', async () => {
    await show(null);
    await app.getState().backupVisits(false);
    await app.getState().backupVisits(true);
    await show(accountA);
    await app.getState().backupVisits(false);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(app.getState().backupBusy).toBe(false);
  });

  it.each(['background', 'delay', 'authentication', 'conflict', 'empty'])(
    'keeps an opted-in automatic trigger paused for %s',
    async (reason) => {
      const state = backupState({ autoEnabled: true });
      if (reason === 'background') mocks.appState.currentState = 'background';
      if (reason === 'delay') state.nextAttemptAt = Date.now() + 60000;
      if (reason === 'authentication' || reason === 'conflict') state.pauseReason = reason;
      if (reason === 'empty') state.pendingVisits = 0;
      await show(accountA, state);
      await app.getState().backupVisits(false);
      expect(mocks.run).not.toHaveBeenCalled();
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );

  it.each([true, false])(
    'only forwards a due connection recovery check while normal retry is delayed (due=%s)',
    async (due) => {
      await show(
        accountA,
        backupState({
          autoEnabled: true,
          nextAttemptAt: Date.now() + 300000,
          connectionCheckAt: Date.now() + (due ? -1000 : 30000),
        }),
      );
      await app.getState().backupVisits(false);
      expect(mocks.run).toHaveBeenCalledTimes(due ? 1 : 0);
    },
  );

  it.each(['owner', 'token'])(
    'rejects stale enable consent after an account %s change without starting another account',
    async (change) => {
      const original = await show(accountA);
      const latest = change === 'owner' ? accountB : { ...accountA, token: 'replacement-token' };
      const active = await show(latest, backupState({ autoEnabled: true }));
      await app.getState().setBackupEnabled(true, expectation(accountA));
      expect(original.setVisitBackupEnabled).not.toHaveBeenCalled();
      expect(active.setVisitBackupEnabled).not.toHaveBeenCalled();
      expect(mocks.repositoryForOwner).not.toHaveBeenCalled();
      expect(mocks.run).not.toHaveBeenCalled();
      expect(app.getState().error).toContain('로그인 정보가 바뀌었습니다');
      expect(app.getState().busy).toBe(false);
    },
  );

  it.each(['owner', 'token'])(
    'does not apply a delayed manual button callback to a different account %s',
    async (change) => {
      await show(accountA);
      const latest = change === 'owner' ? accountB : { ...accountA, token: 'replacement-token' };
      await show(latest);
      await app.getState().backupVisits(true, expectation(accountA));
      expect(mocks.run).not.toHaveBeenCalled();
      expect(app.getState().backupBusy).toBe(false);
    },
  );

  it('waits for the current account summary before accepting a manual backup request', async () => {
    await show(accountA);
    mocks.auth.session = accountB;
    await app.getState().backupVisits(true, expectation(accountB));
    expect(mocks.run).not.toHaveBeenCalled();
    expect(app.getState().backupOwnerId).toBe(owner(accountA));
    expect(app.getState().backupBusy).toBe(false);
  });

  it('ignores an old backup result after switching the displayed account', async () => {
    await show(accountA);
    const pending = deferred<VisitBackupResult>();
    mocks.run.mockReturnValueOnce(pending.promise);
    const running = app.getState().backupVisits(true);
    expect(app.getState().backupBusy).toBe(true);
    const bState = backupState({ pendingVisits: 7, pendingPhotos: 4, lastSuccessAt: 25000 });
    await show(accountB, bState);
    app.setState({ backupMessage: 'B 계정의 대기 기록입니다.' });
    pending.resolve(completed(accountA));
    await running;
    expect(app.getState()).toMatchObject({
      backupOwnerId: owner(accountB),
      backup: bState,
      backupMessage: 'B 계정의 대기 기록입니다.',
      pending: 11,
      backupBusy: false,
    });
    expect(app.getState().visits[0].id).toBe(`${owner(accountB)}-visit`);
  });

  it('permits automatic opt-out while an existing backup is still waiting for its response', async () => {
    const active = await show(accountA, backupState({ autoEnabled: true }));
    const pending = deferred<VisitBackupResult>();
    mocks.run.mockReturnValueOnce(pending.promise);
    const running = app.getState().backupVisits(false);
    expect(app.getState()).toMatchObject({ backupBusy: true, busy: false });
    await app.getState().setBackupEnabled(false, expectation(accountA));
    expect(active.setVisitBackupEnabled).toHaveBeenCalledWith(false, expect.any(Function));
    expect(app.getState()).toMatchObject({
      backup: { autoEnabled: false, pendingVisits: 3 },
      backupBusy: true,
      busy: false,
    });
    pending.resolve({ ...completed(), acknowledged: 0, message: null });
    await running;
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(app.getState().backupBusy).toBe(false);
  });

  it('permits logout during backup and keeps the restored guest view after a late response', async () => {
    await show(accountA);
    const guest = repository('guest', backupState({ pendingVisits: 8, pendingPhotos: 0 }));
    repositories.set('guest', guest);
    mocks.auth.logout.mockImplementation(async () => {
      mocks.auth.session = null;
      currentRepository = guest;
    });
    const pending = deferred<VisitBackupResult>();
    mocks.run.mockReturnValueOnce(pending.promise);
    const running = app.getState().backupVisits(true);
    await app.getState().logout();
    expect(mocks.auth.logout).toHaveBeenCalledOnce();
    expect(app.getState()).toMatchObject({ backupOwnerId: 'guest', pending: 8, busy: false });
    pending.resolve(completed());
    await running;
    expect(app.getState()).toMatchObject({
      backupOwnerId: 'guest',
      backupMessage: null,
      pending: 8,
      backupBusy: false,
    });
    expect(app.getState().visits[0].id).toBe('guest-visit');
  });

  it('does not publish completion when the following status refresh fails and always clears backupBusy', async () => {
    const active = await show(accountA);
    active.visitBackupState.mockRejectedValueOnce(new Error('synthetic summary failure'));
    const messages: (string | null)[] = [];
    const unsubscribe = app.subscribe((state) => {
      messages.push(state.backupMessage);
    });
    try {
      await app.getState().backupVisits(true);
    } finally {
      unsubscribe();
    }
    expect(messages).not.toContain(completed().message);
    expect(app.getState()).toMatchObject({
      backupBusy: false,
      backup: { lastSuccessAt: null, pendingVisits: 3, pendingPhotos: 2 },
      backupMessage: expect.stringContaining('다시 읽지 못했습니다'),
    });
  });
});
