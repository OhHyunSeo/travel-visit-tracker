import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthClient, AuthError, sessionOwner, type Session } from '../src/services/authClient';
import { SessionManager, type SessionState } from '../src/services/sessionManager';

const session: Session = {
  apiUrl: 'https://backup.example.test',
  token: 'synthetic-only',
  user: { id: 1, email: 'a@example.test', username: 'Synthetic A' },
};
afterEach(() => vi.useRealTimers());

function managerFor(send: typeof fetch) {
  let saved: string | null = JSON.stringify(session),
    owner = sessionOwner(session);
  let state: SessionState = { session: null, status: 'guest' };
  const storage = {
    read: vi.fn(async () => saved),
    write: vi.fn(async (value: string) => {
      saved = value;
    }),
    clear: vi.fn(async () => {
      saved = null;
    }),
  };
  const identity = {
    activeOwner: vi.fn(async () => owner),
    activate: vi.fn(async (value: string) => {
      owner = value;
    }),
    importGuest: vi.fn(async () => ({ visits: 0, photos: 0 })),
  };
  const pause = vi.fn(async () => {});
  const manager = new SessionManager(
    storage,
    identity,
    pause,
    false,
    (value) => {
      state = value;
    },
    new AuthClient(send),
  );
  return {
    manager,
    storage,
    identity,
    pause,
    saved: () => saved,
    owner: () => owner,
    state: () => state,
  };
}

function nativeResponse(status = 200) {
  const reader = {
    read: vi.fn<ReadableStreamDefaultReader<Uint8Array>['read']>(),
    cancel: vi.fn(() => new Promise<void>(() => {})),
    releaseLock: vi.fn(),
  };
  const body = { getReader: vi.fn(() => reader), cancel: vi.fn(() => new Promise<void>(() => {})) };
  return {
    reader,
    body,
    response: { ok: status >= 200 && status < 300, status, body } as unknown as Response,
  };
}
const replacement: Session = {
  ...session,
  token: 'synthetic-replacement',
  user: { id: 2, email: 'b@example.test', username: 'Synthetic B' },
};

describe('account request deadlines independent of native abort', () => {
  it('ends login after ten seconds even if transport ignores abort', async () => {
    vi.useFakeTimers();
    const send = vi.fn<typeof fetch>(() => new Promise(() => {}));
    const h = managerFor(send);
    await h.manager.restore();
    let outcome: unknown = 'pending';
    void h.manager
      .signIn(session.apiUrl, 'b@example.test', 'synthetic-password')
      .catch((error: unknown) => {
        outcome = error;
      });
    await vi.advanceTimersByTimeAsync(10000);
    expect(outcome).toBeInstanceOf(AuthError);
    expect(send.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(h.saved()).toBe(JSON.stringify(session));
    expect(h.owner()).toBe(sessionOwner(session));
    expect(h.storage.write).not.toHaveBeenCalled();
    expect(h.pause).not.toHaveBeenCalled();
  });

  it('releases logout queued behind a partial account check without importing records', async () => {
    vi.useFakeTimers();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"user":'));
        },
        cancel: () => new Promise(() => {}),
      }),
    );
    const h = managerFor(async () => response);
    await h.manager.restore();
    let outcome = 'pending';
    void h.manager.check().then(() => {
      outcome = 'checked';
    });
    const logout = h.manager.logout();
    await vi.advanceTimersByTimeAsync(10000);
    expect(outcome).toBe('checked');
    await logout;
    expect(h.state()).toEqual({ session: null, status: 'guest' });
    expect(h.owner()).toBe('guest');
    expect(h.saved()).toBeNull();
    expect(h.storage.write).not.toHaveBeenCalled();
    expect(h.identity.importGuest).not.toHaveBeenCalled();
  });

  it('rejects a late login response without reading it or replacing a newer account', async () => {
    vi.useFakeTimers();
    let finish!: (response: Response) => void;
    const send = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(Response.json(replacement));
    const h = managerFor(send);
    await h.manager.restore();
    const first = h.manager
      .signIn(session.apiUrl, session.user.email, 'synthetic-password')
      .catch((error) => error);
    await vi.advanceTimersByTimeAsync(10000);
    expect(await first).toBeInstanceOf(AuthError);
    await h.manager.signIn(replacement.apiUrl, replacement.user.email, 'synthetic-password');
    const { response, body } = nativeResponse();
    finish(response);
    await vi.advanceTimersByTimeAsync(0);
    expect(body.getReader).not.toHaveBeenCalled();
    expect(body.cancel).toHaveBeenCalledOnce();
    expect(h.state().session).toEqual(replacement);
    expect(h.saved()).toBe(JSON.stringify(replacement));
    expect(h.storage.write).toHaveBeenCalledOnce();
  });

  it('keeps saved credentials offline and rejects a late account-check tail after account change', async () => {
    vi.useFakeTimers();
    const json = JSON.stringify({ user: session.user });
    const { response, reader } = nativeResponse();
    let finish!: (chunk: ReadableStreamReadResult<Uint8Array>) => void;
    reader.read
      .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(json.slice(0, 8)) })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(Response.json(replacement));
    const h = managerFor(send);
    await h.manager.restore();
    const check = h.manager.check();
    await vi.advanceTimersByTimeAsync(10000);
    await check;
    expect(h.state()).toEqual({ session, status: 'offline' });
    expect(h.saved()).toBe(JSON.stringify(session));
    expect(h.storage.write).not.toHaveBeenCalled();
    await h.manager.signIn(replacement.apiUrl, replacement.user.email, 'synthetic-password');
    finish({ done: false, value: new TextEncoder().encode(json.slice(8)) });
    await vi.advanceTimersByTimeAsync(0);
    expect(reader.read).toHaveBeenCalledTimes(2);
    expect(h.state().session).toEqual(replacement);
    expect(h.owner()).toBe(sessionOwner(replacement));
    expect(h.saved()).toBe(JSON.stringify(replacement));
    expect(h.storage.write).toHaveBeenCalledOnce();
  });

  it('does not import guest records after account verification exceeds its deadline', async () => {
    vi.useFakeTimers();
    const h = managerFor(() => new Promise(() => {}));
    await h.manager.restore();
    const imported = h.manager.importGuest(sessionOwner(session)).catch((error) => error);
    await vi.advanceTimersByTimeAsync(10000);
    expect(await imported).toBeInstanceOf(AuthError);
    expect(h.identity.importGuest).not.toHaveBeenCalled();
    expect(h.pause).not.toHaveBeenCalled();
    expect(h.saved()).toBe(JSON.stringify(session));
    expect(h.owner()).toBe(sessionOwner(session));
  });

  it('ends signup after its independent deadline without switching the existing owner', async () => {
    vi.useFakeTimers();
    const send = vi.fn<typeof fetch>(() => new Promise(() => {}));
    const h = managerFor(send);
    await h.manager.restore();
    const result = h.manager
      .signIn(
        session.apiUrl,
        replacement.user.email,
        'synthetic-password',
        replacement.user.username,
      )
      .catch((error) => error);
    await vi.advanceTimersByTimeAsync(10000);
    expect(await result).toBeInstanceOf(AuthError);
    expect(String(send.mock.calls[0][0])).toMatch(/\/signup$/);
    expect(h.saved()).toBe(JSON.stringify(session));
    expect(h.identity.activate).not.toHaveBeenCalled();
  });

  it.each([16 * 1024, 16 * 1024 + 1])(
    'bounds the account response at %i bytes without Content-Length',
    async (size) => {
      const json = JSON.stringify(replacement),
        text = json + ' '.repeat(size - new TextEncoder().encode(json).length);
      const client = new AuthClient(async () => new Response(text));
      const result = client.signIn(session.apiUrl, replacement.user.email, 'synthetic-password');
      if (size === 16 * 1024) await expect(result).resolves.toEqual(replacement);
      else await expect(result).rejects.toBeInstanceOf(AuthError);
    },
  );

  it.each([401, 409, 500])(
    'keeps HTTP %i classification without reading a hanging error body',
    async (status) => {
      vi.useFakeTimers();
      const { response, body } = nativeResponse(status);
      const client = new AuthClient(async () => response);
      await expect(
        client.signIn(session.apiUrl, session.user.email, 'synthetic-password'),
      ).rejects.toMatchObject({ status });
      expect(body.getReader).not.toHaveBeenCalled();
      expect(body.cancel).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('accepts complete account data without awaiting native cleanup or lock release', async () => {
    vi.useFakeTimers();
    const { response, reader } = nativeResponse();
    reader.read
      .mockResolvedValueOnce({
        done: false,
        value: new TextEncoder().encode(JSON.stringify(replacement)),
      })
      .mockResolvedValueOnce({ done: true, value: undefined });
    reader.cancel.mockImplementation(() => {
      throw Error('native cancellation failed');
    });
    reader.releaseLock.mockImplementation(() => {
      throw Error('native lock release failed');
    });
    await expect(
      new AuthClient(async () => response).signIn(
        session.apiUrl,
        replacement.user.email,
        'synthetic-password',
      ),
    ).resolves.toEqual(replacement);
    expect(reader.cancel).toHaveBeenCalledOnce();
    expect(reader.releaseLock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
