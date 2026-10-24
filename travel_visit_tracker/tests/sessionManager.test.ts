import { describe, expect, it, vi } from 'vitest';
import {
  AuthClient,
  AuthError,
  normalizeApiUrl,
  sessionFromJson,
  sessionOwner,
  type Session,
} from '../src/services/authClient';
import { SessionManager, type SessionState } from '../src/services/sessionManager';

const a: Session = {
  apiUrl: 'https://backup.example.test',
  user: { id: 1, email: 'a@example.test', username: 'Account A' },
  token: 'synthetic-a',
};
const b: Session = {
  ...a,
  user: { id: 2, email: 'b@example.test', username: 'Account B' },
  token: 'synthetic-b',
};
function harness(saved: Session | null = null, initialOwner = 'guest') {
  let value = saved ? JSON.stringify(saved) : null,
    owner = initialOwner;
  let state: SessionState = { session: null, status: 'guest' };
  const calls: string[] = [];
  const storage = {
    read: vi.fn(async () => value),
    write: vi.fn(async (next: string) => {
      calls.push('secure-write');
      value = next;
    }),
    clear: vi.fn(async () => {
      calls.push('secure-clear');
      value = null;
    }),
  };
  const identity = {
    activeOwner: vi.fn(async () => owner),
    activate: vi.fn(async (next: string) => {
      calls.push('activate');
      owner = next;
    }),
    importGuest: vi.fn(async () => {
      calls.push('import');
      return { visits: 2, photos: 1 };
    }),
  };
  const pause = vi.fn(async () => {
    calls.push('pause');
  });
  const send = vi.fn<typeof fetch>(async (input, options) => {
    if (String(input).endsWith('/me')) {
      const token = (options?.headers as Record<string, string>)?.Authorization;
      return Response.json({ user: token === 'Bearer synthetic-b' ? b.user : a.user });
    }
    const body = JSON.parse(options?.body as string);
    if (body.password === 'wrong')
      return Response.json({ code: 'INVALID_CREDENTIALS' }, { status: 401 });
    return Response.json(body.email === b.user.email ? b : a);
  });
  const manager = new SessionManager(
    storage,
    identity,
    pause,
    true,
    (next) => {
      state = next;
    },
    new AuthClient(send),
  );
  return {
    manager,
    storage,
    identity,
    pause,
    send,
    calls,
    value: () => value,
    owner: () => owner,
    state: () => state,
  };
}
describe('secure session and local identity transitions', () => {
  it('keeps guest records untouched until explicit login/import and never stores the password', async () => {
    const h = harness();
    await h.manager.restore();
    expect(h.pause).not.toHaveBeenCalled();
    await h.manager.signIn(a.apiUrl, a.user.email, 'password-123');
    expect(h.owner()).toBe(sessionOwner(a));
    expect(h.state().status).toBe('signed-in');
    expect(h.value()).not.toContain('password-123');
    expect(h.identity.importGuest).not.toHaveBeenCalled();
    expect(h.calls).toEqual(['pause', 'secure-write', 'activate']);
  });
  it('does not pause tracking or change saved identity after rejected credentials', async () => {
    const h = harness();
    await h.manager.restore();
    await expect(h.manager.signIn(a.apiUrl, a.user.email, 'wrong')).rejects.toMatchObject({
      status: 401,
    });
    expect(h.owner()).toBe('guest');
    expect(h.value()).toBeNull();
    expect(h.pause).not.toHaveBeenCalled();
  });
  it('restores the same account without stopping its existing recording', async () => {
    const h = harness(a, sessionOwner(a));
    await h.manager.restore();
    expect(h.state().session).toEqual(a);
    expect(h.state().status).toBe('offline');
    expect(h.pause).not.toHaveBeenCalled();
    await h.manager.check();
    expect(h.state().status).toBe('signed-in');
  });
  it('reconciles a stored identity before a local view is opened', async () => {
    const h = harness(a);
    await h.manager.restore();
    expect(h.calls).toEqual(['pause', 'activate']);
    expect(h.owner()).toBe(sessionOwner(a));
  });
  it('preserves encrypted session and local account data when offline', async () => {
    const h = harness(a, sessionOwner(a));
    await h.manager.restore();
    h.send.mockRejectedValueOnce(new Error('offline'));
    await h.manager.check();
    expect(h.state().status).toBe('offline');
    expect(h.value()).toBe(JSON.stringify(a));
    expect(h.owner()).toBe(sessionOwner(a));
  });
  it('clears an expired token but retains the account identity and local records', async () => {
    const h = harness(a, sessionOwner(a));
    await h.manager.restore();
    h.send.mockResolvedValueOnce(Response.json({}, { status: 401 }));
    await h.manager.check();
    expect(h.state().status).toBe('expired');
    expect(h.state().session?.token).toBeNull();
    expect(h.owner()).toBe(sessionOwner(a));
    const restarted = harness(sessionFromJson(h.value()!, true), sessionOwner(a));
    await restarted.manager.restore();
    expect(restarted.state().status).toBe('expired');
    expect(restarted.send).not.toHaveBeenCalled();
  });
  it('treats a different account returned by me as invalid instead of switching data scope', async () => {
    const h = harness(a, sessionOwner(a));
    await h.manager.restore();
    h.send.mockResolvedValueOnce(Response.json({ user: b.user }));
    await h.manager.check();
    expect(h.state().status).toBe('expired');
    expect(h.owner()).toBe(sessionOwner(a));
  });
  it('logs out to guest after clearing secure credentials and preserves data via ownership', async () => {
    const h = harness(a, sessionOwner(a));
    await h.manager.restore();
    await h.manager.logout();
    expect(h.calls).toEqual(['pause', 'secure-clear', 'activate']);
    expect(h.owner()).toBe('guest');
    expect(h.value()).toBeNull();
    expect(h.state().session).toBeNull();
  });
  it('rolls back credentials if local activation fails', async () => {
    const h = harness(a, sessionOwner(a));
    await h.manager.restore();
    h.identity.activate.mockRejectedValueOnce(new Error('DB failed'));
    await expect(h.manager.signIn(b.apiUrl, b.user.email, 'password-123')).rejects.toThrow(
      'DB failed',
    );
    expect(h.value()).toBe(JSON.stringify(a));
    expect(h.state().session).toEqual(a);
    expect(h.owner()).toBe(sessionOwner(a));
  });
  it('keeps the old identity when secure storage cannot write or clear', async () => {
    const h = harness(a, sessionOwner(a));
    await h.manager.restore();
    h.storage.write.mockRejectedValueOnce(new Error('secure storage unavailable'));
    await expect(h.manager.signIn(b.apiUrl, b.user.email, 'password-123')).rejects.toThrow(
      'secure storage unavailable',
    );
    expect(h.identity.activate).not.toHaveBeenCalled();
    expect(h.owner()).toBe(sessionOwner(a));
    h.storage.clear.mockRejectedValueOnce(new Error('clear unavailable'));
    await expect(h.manager.logout()).rejects.toThrow('clear unavailable');
    expect(h.value()).toBe(JSON.stringify(a));
  });
  it('restores the old secure session if logout cannot activate guest', async () => {
    const h = harness(a, sessionOwner(a));
    await h.manager.restore();
    h.identity.activate.mockRejectedValueOnce(new Error('DB failed'));
    await expect(h.manager.logout()).rejects.toThrow('DB failed');
    expect(h.value()).toBe(JSON.stringify(a));
    expect(h.state().session).toEqual(a);
  });
  it('requires current confirmed account intent and verification before importing guest data', async () => {
    const h = harness();
    await h.manager.restore();
    await h.manager.signIn(a.apiUrl, a.user.email, 'password-123');
    expect(h.identity.importGuest).not.toHaveBeenCalled();
    expect(await h.manager.importGuest(sessionOwner(a))).toEqual({ visits: 2, photos: 1 });
    await h.manager.signIn(b.apiUrl, b.user.email, 'password-123');
    await expect(h.manager.importGuest(sessionOwner(a))).rejects.toThrow('계정이 바뀌었습니다');
    expect(h.identity.importGuest).toHaveBeenCalledTimes(1);
  });
  it('does not import while verification is offline or expired', async () => {
    const h = harness(a, sessionOwner(a));
    await h.manager.restore();
    h.send.mockRejectedValueOnce(new Error('offline'));
    await expect(h.manager.importGuest(sessionOwner(a))).rejects.toThrow('계정을 확인한 뒤');
    expect(h.identity.importGuest).not.toHaveBeenCalled();
    h.send.mockResolvedValueOnce(Response.json({}, { status: 401 }));
    await expect(h.manager.importGuest(sessionOwner(a))).rejects.toThrow('계정을 확인한 뒤');
    expect(h.identity.importGuest).not.toHaveBeenCalled();
  });
  it('serializes account changes and prevents an old confirmation being applied to a new account', async () => {
    const h = harness();
    await h.manager.restore();
    const first = h.manager.signIn(a.apiUrl, a.user.email, 'password-123');
    const second = h.manager.signIn(b.apiUrl, b.user.email, 'password-123');
    const imported = h.manager.importGuest(sessionOwner(a));
    await Promise.all([first, second]);
    await expect(imported).rejects.toThrow('계정이 바뀌었습니다');
    expect(h.owner()).toBe(sessionOwner(b));
  });
  it('blocks malformed stored sessions and unsafe server addresses', async () => {
    for (const saved of [
      'bad json',
      '{}',
      JSON.stringify({ ...a, token: 'token with space' }),
      JSON.stringify({ ...a, user: { ...a.user, id: '1' } }),
    ])
      expect(() => sessionFromJson(saved, true)).toThrow();
    for (const url of [
      'http://public.example.test',
      'https://user:password@backup.example.test',
      'https://backup.example.test/path',
      'https://backup.example.test?key=x',
      'file:///secret',
    ])
      expect(() => normalizeApiUrl(url, true)).toThrow();
    expect(normalizeApiUrl(' HTTPS://BACKUP.EXAMPLE.TEST/ ', false)).toBe(a.apiUrl);
    expect(normalizeApiUrl('http://127.0.0.1:3001', true)).toBe('http://127.0.0.1:3001');
    expect(() => normalizeApiUrl('http://127.0.0.1:3001', false)).toThrow(AuthError);
    expect(sessionOwner({ ...a, apiUrl: 'https://other.example.test' })).not.toBe(sessionOwner(a));
  });
});
