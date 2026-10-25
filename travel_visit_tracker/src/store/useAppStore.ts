import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import { AppState } from 'react-native';
import type { AppSnapshot } from '../domain/types';
import { getRepository, repositoryForOwner } from '../storage/database';
import type { PhotoBackupState, VisitBackupState } from '../storage/outbox';
import { emptyRestoreState, type RestoreState } from '../storage/restore';
import { RestoreCoordinator } from '../services/restore';
import { RestoreClient } from '../services/restoreSync';
import { stageRestoredFile, inspectRestoredFile } from '../services/restoreFile';
import { restoreFetch } from '../services/restoreTransport';
import { sessionOwner } from '../services/authClient';
import { VisitBackupCoordinator } from '../services/visitBackup';
import { VisitSyncClient } from '../services/visitSync';
import { PhotoBackupCoordinator } from '../services/photoBackup';
import { PhotoSyncClient } from '../services/photoSync';
import { preparePhotoFile, cleanupPreparedPhotoFiles } from '../services/photoFile';
import { photoFetch } from '../services/photoTransport';
import { attachPhoto, removePhotoFiles, resolvePhotoUri } from '../services/photos';
import { startTracking, stopTracking, reconcileTracking } from '../services/tracking';
import { useAuthStore } from './useAuthStore';

const initial: AppSnapshot = {
  visits: [],
  photos: [],
  candidate: null,
  recording: false,
  recordingMode: 'foreground',
  status: 'off',
  message: '',
  pending: 0,
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
const initialBackup: VisitBackupState = {
  autoEnabled: false,
  pendingVisits: 0,
  pendingPhotos: 0,
  lastSuccessAt: null,
  nextAttemptAt: null,
  connectionCheckAt: null,
  pauseReason: null,
};
export type BackupExpectation = { ownerId: string; token: string | null };
const matchesBackupAccount = (expected: BackupExpectation) => {
  const session = useAuthStore.getState().session;
  return (
    session !== null &&
    sessionOwner(session) === expected.ownerId &&
    session.token === expected.token
  );
};
async function maintainPhotoSnapshots(expected: BackupExpectation) {
  const current = () => matchesBackupAccount(expected) && AppState.currentState === 'active';
  if (!current()) return;
  const repository = await repositoryForOwner(expected.ownerId);
  if (!current()) return;
  await cleanupPreparedPhotoFiles({
    ownerId: expected.ownerId,
    isCurrent: current,
    removeAcknowledged: (snapshot, remove) =>
      repository.removeAcknowledgedPhotoSnapshot(snapshot, remove, current),
  });
}
const visitBackup = new VisitBackupCoordinator(
  () => useAuthStore.getState().session,
  repositoryForOwner,
  new VisitSyncClient(fetch, __DEV__),
  Date.now,
  () => AppState.currentState === 'active',
);
const photoBackup = new PhotoBackupCoordinator(
  () => useAuthStore.getState().session,
  repositoryForOwner,
  new PhotoSyncClient(photoFetch, __DEV__),
  preparePhotoFile,
  async (expected) => {
    if (!matchesBackupAccount(expected) || AppState.currentState !== 'active')
      throw new Error('사진 전송을 시작할 수 없습니다.');
    const result = await visitBackup.run(true);
    if (result.ownerId !== expected.ownerId || result.paused)
      throw new Error('방문 전송을 확인한 뒤 사진 백업을 다시 눌러 주세요.');
  },
  () => AppState.currentState === 'active',
);
const restore = new RestoreCoordinator(
  () => useAuthStore.getState().session,
  repositoryForOwner,
  new RestoreClient(restoreFetch, __DEV__),
  stageRestoredFile,
  inspectRestoredFile,
  () => AppState.currentState === 'active',
  (stop) => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') stop();
    });
    const captured = useAuthStore.getState().session;
    const unsubscribe = useAuthStore.subscribe((state) => {
      if (
        state.session?.token !== captured?.token ||
        (state.session ? sessionOwner(state.session) : null) !==
          (captured ? sessionOwner(captured) : null)
      )
        stop();
    });
    return () => {
      subscription.remove();
      unsubscribe();
    };
  },
);
type State = AppSnapshot & {
  ready: boolean;
  busy: boolean;
  error: string | null;
  backup: VisitBackupState;
  backupOwnerId: string;
  backupBusy: boolean;
  backupMessage: string | null;
  photoBackup: PhotoBackupState;
  photoBackupBusy: boolean;
  photoBackupMessage: string | null;
  restore: RestoreState;
  restoreBusy: boolean;
  restoreMessage: string | null;
  restoreRecords(expected: BackupExpectation): Promise<void>;
  initialize(): Promise<void>;
  refresh(): Promise<void>;
  clearError(): void;
  tracking(enabled: boolean, background?: boolean): Promise<void>;
  developmentVisit(regionId: string): Promise<void>;
  addPhoto(visitId: string): Promise<void>;
  deleteVisit(id: string): Promise<void>;
  signIn(apiUrl: string, email: string, password: string, username?: string): Promise<void>;
  logout(): Promise<void>;
  checkAccount(): Promise<void>;
  importGuest(expectedOwner: string): Promise<void>;
  backupVisits(manual?: boolean, expected?: BackupExpectation): Promise<void>;
  setBackupEnabled(enabled: boolean, expected: BackupExpectation): Promise<void>;
  backupPhotos(expected: BackupExpectation): Promise<void>;
};
export const useAppStore = create<State>((set, get) => {
  const action = async (operation: () => Promise<unknown>) => {
    if (get().busy) return;
    set({ busy: true, error: null });
    try {
      await operation();
      await get().refresh();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : '작업에 실패했습니다. 다시 시도해 주세요.',
      });
    } finally {
      set({ busy: false });
    }
  };
  return {
    ...initial,
    ready: false,
    busy: false,
    error: null,
    backup: initialBackup,
    backupOwnerId: 'guest',
    backupBusy: false,
    backupMessage: null,
    photoBackup: { pendingPhotos: 0, backedUpPhotos: 0 },
    photoBackupBusy: false,
    photoBackupMessage: null,
    restore: emptyRestoreState,
    restoreBusy: false,
    restoreMessage: null,
    clearError: () => set({ error: null }),
    refresh: async () => {
      const repository = await getRepository();
      const snapshot = await repository.snapshot(__DEV__);
      const backup = await repository.visitBackupState();
      const photoState = await repository.photoBackupState();
      const restoreState = await repository.restoration.state();
      if ((await getRepository()).ownerId !== repository.ownerId) return get().refresh();
      snapshot.photos = snapshot.photos.map((photo) => ({
        ...photo,
        uri: resolvePhotoUri(photo.uri),
      }));
      const previous = get();
      // Keep geometry inputs stable while only the dwell status changes.
      if (JSON.stringify(snapshot.visits) === JSON.stringify(previous.visits))
        snapshot.visits = previous.visits;
      if (JSON.stringify(snapshot.photos) === JSON.stringify(previous.photos))
        snapshot.photos = previous.photos;
      set({
        ...snapshot,
        backup,
        photoBackup: photoState,
        restore: restoreState,
        backupOwnerId: repository.ownerId,
        ...(previous.backupOwnerId !== repository.ownerId
          ? { backupMessage: null, photoBackupMessage: null, restoreMessage: null }
          : {}),
      });
    },
    initialize: async () => {
      try {
        await useAuthStore.getState().initialize();
        await get().refresh();
        await reconcileTracking();
        await get().refresh();
        set({ ready: true, error: null });
        const restoredSession = useAuthStore.getState().session;
        if (restoredSession?.token)
          void maintainPhotoSnapshots({
            ownerId: sessionOwner(restoredSession),
            token: restoredSession.token,
          }).catch(() => undefined);
        void useAuthStore
          .getState()
          .check()
          .catch(() => undefined);
      } catch (error) {
        set({ error: error instanceof Error ? error.message : '저장소를 열 수 없습니다.' });
      }
    },
    tracking: (enabled, background = false) =>
      action(() => (enabled ? startTracking(background) : stopTracking())),
    signIn: (...args) => action(() => useAuthStore.getState().signIn(...args)),
    logout: () => action(() => useAuthStore.getState().logout()),
    checkAccount: () => action(() => useAuthStore.getState().check()),
    importGuest: (owner) => action(() => useAuthStore.getState().importGuest(owner)),
    setBackupEnabled: async (enabled, expected) => {
      let changed = false;
      await action(async () => {
        if (!matchesBackupAccount(expected))
          throw new Error('로그인 정보가 바뀌었습니다. 현재 계정을 다시 확인해 주세요.');
        const repository = await repositoryForOwner(expected.ownerId);
        await repository.setVisitBackupEnabled(enabled, () => matchesBackupAccount(expected));
        if (matchesBackupAccount(expected)) {
          changed = true;
          set({
            backupMessage: enabled
              ? '자동 방문 백업을 켰습니다. 앱 화면을 열어 둔 동안 전송합니다.'
              : '자동 방문 백업을 껐습니다. 대기 기록은 기기에 보관합니다.',
          });
        }
      });
      if (enabled && changed && matchesBackupAccount(expected)) void get().backupVisits(false);
    },
    backupVisits: async (manual = true, renderedAccount) => {
      if (
        !get().ready ||
        get().busy ||
        get().backupBusy ||
        get().photoBackupBusy ||
        get().restoreBusy
      )
        return;
      const session = useAuthStore.getState().session;
      if (!session?.token) return;
      const expected = { ownerId: sessionOwner(session), token: session.token };
      if (
        get().backupOwnerId !== expected.ownerId ||
        (renderedAccount && !matchesBackupAccount(renderedAccount))
      )
        return;
      const state = get().backup;
      if (
        !manual &&
        (AppState.currentState !== 'active' ||
          !state.autoEnabled ||
          state.pauseReason !== null ||
          state.pendingVisits === 0 ||
          (state.nextAttemptAt !== null &&
            state.nextAttemptAt > Date.now() &&
            (state.connectionCheckAt === null || state.connectionCheckAt > Date.now())))
      )
        return;
      set({ backupBusy: true, backupMessage: null });
      let message: string | null = null;
      try {
        const result = await visitBackup.run(manual);
        if (
          matchesBackupAccount(expected) &&
          result.ownerId === expected.ownerId &&
          !result.paused &&
          result.message
        )
          message = result.message;
      } catch {
        if (matchesBackupAccount(expected))
          message = '방문 백업을 확인하지 못했습니다. 대기 기록은 보관 중입니다.';
      } finally {
        try {
          await get().refresh();
          if (matchesBackupAccount(expected) && message) set({ backupMessage: message });
        } catch {
          if (matchesBackupAccount(expected))
            set({ backupMessage: '전송 상태를 다시 읽지 못했습니다. 기기 기록을 확인해 주세요.' });
        }
        set({ backupBusy: false });
      }
    },
    backupPhotos: async (renderedAccount) => {
      if (
        !get().ready ||
        get().busy ||
        get().backupBusy ||
        get().photoBackupBusy ||
        get().restoreBusy
      )
        return;
      const session = useAuthStore.getState().session;
      if (
        !session?.token ||
        !renderedAccount ||
        AppState.currentState !== 'active' ||
        !matchesBackupAccount(renderedAccount) ||
        get().backupOwnerId !== renderedAccount.ownerId
      )
        return;
      const expected = { ownerId: sessionOwner(session), token: session.token };
      set({ photoBackupBusy: true, photoBackupMessage: null });
      let message: string | null = null;
      try {
        const result = await photoBackup.run(expected);
        if (matchesBackupAccount(expected) && result.ownerId === expected.ownerId)
          message = result.message;
        await maintainPhotoSnapshots(expected).catch(() => undefined);
      } catch {
        if (matchesBackupAccount(expected))
          message = '사진 전송을 확인하지 못했습니다. 사진과 대기 작업은 기기에 보관 중입니다.';
      } finally {
        try {
          await get().refresh();
          if (matchesBackupAccount(expected) && message) set({ photoBackupMessage: message });
        } catch {
          if (matchesBackupAccount(expected))
            set({
              photoBackupMessage:
                '사진 전송 상태를 다시 읽지 못했습니다. 대기 작업을 확인해 주세요.',
            });
        }
        set({ photoBackupBusy: false });
      }
    },
    restoreRecords: async (renderedAccount) => {
      if (
        !get().ready ||
        get().busy ||
        get().backupBusy ||
        get().photoBackupBusy ||
        get().restoreBusy
      )
        return;
      if (
        !renderedAccount?.token ||
        !matchesBackupAccount(renderedAccount) ||
        AppState.currentState !== 'active' ||
        get().backupOwnerId !== renderedAccount.ownerId
      )
        return;
      const expected = { ownerId: renderedAccount.ownerId, token: renderedAccount.token };
      set({ restoreBusy: true, restoreMessage: null });
      let message: string | null = null;
      try {
        const result = await restore.run(expected);
        if (matchesBackupAccount(expected) && result.ownerId === expected.ownerId)
          message = result.message;
      } catch {
        if (matchesBackupAccount(expected))
          message = '복원 상태를 확인하지 못했습니다. 기기의 기록은 보관 중입니다.';
      } finally {
        try {
          await get().refresh();
          if (matchesBackupAccount(expected) && message) set({ restoreMessage: message });
        } catch {
          if (matchesBackupAccount(expected))
            set({
              restoreMessage: '복원 상태를 다시 읽지 못했습니다. 기기의 기록을 확인해 주세요.',
            });
        }
        set({ restoreBusy: false });
      }
    },
    developmentVisit: (regionId) =>
      action(async () => {
        if (!__DEV__) throw new Error('개발 빌드에서만 사용할 수 있습니다.');
        await (await getRepository()).developmentVisit(regionId, Crypto.randomUUID(), Date.now());
      }),
    addPhoto: (visitId) => action(() => attachPhoto(visitId)),
    deleteVisit: (id) =>
      action(async () => {
        const uris = await (await getRepository()).deleteVisit(id, Crypto.randomUUID(), Date.now());
        await get().refresh();
        await removePhotoFiles(uris);
      }),
  };
});
