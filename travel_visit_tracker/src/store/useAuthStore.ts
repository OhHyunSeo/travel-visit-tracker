import { create } from 'zustand';
import { SessionManager, type SessionState } from '../services/sessionManager';
import { credentials } from '../services/credentials';
import { stopTracking } from '../services/tracking';
import { getRepository, repositoryForOwner } from '../storage/database';
type AuthState = SessionState & {
  notice: string | null;
  initialize(): Promise<void>;
  signIn(apiUrl: string, email: string, password: string, username?: string): Promise<void>;
  logout(): Promise<void>;
  check(): Promise<void>;
  importGuest(expectedOwner: string): Promise<void>;
};
let manager: SessionManager;
let initialized: Promise<void> | null = null;
export const useAuthStore = create<AuthState>((set) => {
  manager = new SessionManager(
    credentials,
    {
      activeOwner: async () => (await getRepository()).activeOwner(),
      activate: async (owner) => (await repositoryForOwner(owner)).activateOwner(),
      importGuest: async (owner) => (await repositoryForOwner(owner)).importGuestRecords(),
    },
    stopTracking,
    __DEV__,
    (state) => set({ ...state, notice: null }),
  );
  return {
    session: null,
    status: 'guest',
    notice: null,
    initialize: () =>
      initialized ??
      (initialized = manager.restore().catch((error) => {
        initialized = null;
        throw error;
      })),
    signIn: async (...args) => {
      await manager.signIn(...args);
      set({
        notice: '로그인했습니다. 게스트 기록은 별도로 남아 있습니다. 자동 기록은 다시 켜 주세요.',
      });
    },
    logout: async () => {
      await manager.logout();
      set({ notice: '로그아웃했습니다. 계정 기록은 기기에 보관하고 게스트 기록을 엽니다.' });
    },
    check: () => manager.check(),
    importGuest: async (expectedOwner) => {
      const result = await manager.importGuest(expectedOwner);
      set({
        notice: `방문 ${result.visits}개와 사진 ${result.photos}개를 이 계정으로 옮겼습니다. 방문 백업 설정을 확인해 주세요. 사진 전송과 서버 기록 복원은 각각 별도 확인 후 수동으로 실행합니다.`,
      });
    },
  };
});
