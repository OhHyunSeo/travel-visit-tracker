import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import type { AppSnapshot } from '../domain/types';
import { getRepository } from '../storage/database';
import { attachPhoto, removePhotoFiles, resolvePhotoUri } from '../services/photos';
import { startTracking, stopTracking, reconcileTracking } from '../services/tracking';

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
type State = AppSnapshot & {
  ready: boolean;
  busy: boolean;
  error: string | null;
  initialize(): Promise<void>;
  refresh(): Promise<void>;
  clearError(): void;
  tracking(enabled: boolean, background?: boolean): Promise<void>;
  developmentVisit(regionId: string): Promise<void>;
  addPhoto(visitId: string): Promise<void>;
  deleteVisit(id: string): Promise<void>;
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
    clearError: () => set({ error: null }),
    refresh: async () => {
      const snapshot = await (await getRepository()).snapshot(__DEV__);
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
      set(snapshot);
    },
    initialize: async () => {
      try {
        await get().refresh();
        await reconcileTracking();
        await get().refresh();
        set({ ready: true, error: null });
      } catch (error) {
        set({ error: error instanceof Error ? error.message : '저장소를 열 수 없습니다.' });
      }
    },
    tracking: (enabled, background = false) =>
      action(() => (enabled ? startTracking(background) : stopTracking())),
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
