import {
  AuthClient,
  AuthError,
  normalizeApiUrl,
  sessionFromJson,
  sessionOwner,
  type Session,
} from './authClient';
export interface CredentialStore {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  clear(): Promise<void>;
}
export type SessionState = {
  session: Session | null;
  status: 'guest' | 'signed-in' | 'offline' | 'expired';
};
export type IdentityStore = {
  activeOwner(): Promise<string>;
  activate(owner: string): Promise<void>;
  importGuest(owner: string): Promise<{ visits: number; photos: number }>;
};
export class SessionManager {
  private tail: Promise<unknown> = Promise.resolve();
  private state: SessionState = { session: null, status: 'guest' };
  constructor(
    private readonly storage: CredentialStore,
    private readonly identity: IdentityStore,
    private readonly pauseTracking: () => Promise<void>,
    private readonly development: boolean,
    private readonly notify: (state: SessionState) => void,
    private readonly client = new AuthClient(),
  ) {}
  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.then(action);
    this.tail = next.catch(() => undefined);
    return next;
  }
  private update(state: SessionState) {
    this.state = state;
    this.notify(state);
  }
  restore(): Promise<void> {
    return this.exclusive(async () => {
      const saved = await this.storage.read();
      const session = saved === null ? null : sessionFromJson(saved, this.development);
      const owner = session ? sessionOwner(session) : 'guest';
      if ((await this.identity.activeOwner()) !== owner) {
        await this.pauseTracking();
        await this.identity.activate(owner);
      }
      this.update({ session, status: session ? (session.token ? 'offline' : 'expired') : 'guest' });
    });
  }
  private async replace(session: Session | null) {
    const previous = this.state.session;
    await this.pauseTracking();
    if (session) await this.storage.write(JSON.stringify(session));
    else await this.storage.clear();
    try {
      await this.identity.activate(session ? sessionOwner(session) : 'guest');
    } catch (error) {
      try {
        if (previous) await this.storage.write(JSON.stringify(previous));
        else await this.storage.clear();
      } catch {
        throw new AuthError(
          '로그인 저장 상태를 복구하지 못했습니다. 앱을 다시 열어 확인해 주세요.',
        );
      }
      throw error;
    }
    this.update({ session, status: session ? 'signed-in' : 'guest' });
  }
  signIn(apiUrl: string, email: string, password: string, username?: string): Promise<void> {
    return this.exclusive(async () => {
      const session = await this.client.signIn(
        normalizeApiUrl(apiUrl, this.development),
        email.trim(),
        password,
        username?.trim(),
      );
      await this.replace(session);
    });
  }
  logout(): Promise<void> {
    return this.exclusive(() => this.replace(null));
  }
  private async verify(): Promise<boolean> {
    const session = this.state.session;
    if (!session) return false;
    if (!session.token) {
      this.update({ session, status: 'expired' });
      return false;
    }
    try {
      const user = await this.client.me(session);
      const verified = { ...session, user };
      await this.storage.write(JSON.stringify(verified));
      this.update({ session: verified, status: 'signed-in' });
      return true;
    } catch (error) {
      if (error instanceof AuthError && error.status === 401) {
        const expired = { ...session, token: null };
        await this.storage.write(JSON.stringify(expired));
        this.update({ session: expired, status: 'expired' });
      } else {
        this.update({ session, status: 'offline' });
      }
      return false;
    }
  }
  check(): Promise<void> {
    return this.exclusive(async () => {
      await this.verify();
    });
  }
  importGuest(expectedOwner: string): Promise<{ visits: number; photos: number }> {
    return this.exclusive(async () => {
      if (
        !this.state.session ||
        sessionOwner(this.state.session) !== expectedOwner ||
        (await this.identity.activeOwner()) !== expectedOwner
      )
        throw new AuthError('계정이 바뀌었습니다. 가져올 계정을 다시 확인해 주세요.');
      if (!(await this.verify()) || !this.state.session)
        throw new AuthError(
          '계정을 확인한 뒤 기록을 가져올 수 있습니다. 다시 로그인하거나 연결을 확인해 주세요.',
        );
      await this.pauseTracking();
      return this.identity.importGuest(sessionOwner(this.state.session));
    });
  }
}
