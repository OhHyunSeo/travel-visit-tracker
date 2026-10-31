import { afterEach, describe, expect, it, vi } from 'vitest';
import { RestoreClient } from '../src/services/restoreSync';
import { bytes, photo, session, visit } from './restoreFixture';

afterEach(() => vi.useRealTimers());

const listBytes = new TextEncoder().encode(
  JSON.stringify({ visits: [], cursor: 0, hasMore: false }),
);
function nativeReader() {
  return {
    read: vi.fn<ReadableStreamDefaultReader<Uint8Array>['read']>(),
    cancel: vi.fn(async () => {}),
    releaseLock: vi.fn(),
  };
}
function nativeResponse(reader: ReturnType<typeof nativeReader>, status = 200) {
  const body = { getReader: vi.fn(() => reader), cancel: vi.fn(async () => {}) };
  const response = {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'image/png' }),
    body,
  } as unknown as Response;
  return { response, body };
}

describe('restore response deadlines', () => {
  it('ends a metadata request when the transport ignores abort', async () => {
    vi.useFakeTimers();
    const transport = vi.fn<typeof fetch>(() => new Promise(() => {}));
    let outcome = 'pending';
    void new RestoreClient(transport).visits(session, 0).then(
      () => {
        outcome = 'success';
      },
      () => {
        outcome = 'failed';
      },
    );
    await vi.advanceTimersByTimeAsync(10000);
    expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(outcome).toBe('failed');
  });

  it('ends a partial download when native reading and cancellation ignore abort', async () => {
    vi.useFakeTimers();
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: bytes.slice(0, 3) })
        .mockImplementation(() => new Promise(() => {})),
      cancel: vi.fn(() => new Promise<void>(() => {})),
      releaseLock: vi.fn(),
    };
    const transport = vi.fn<typeof fetch>(
      async () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'image/png' }),
          body: { getReader: () => reader },
        }) as unknown as Response,
    );
    let outcome = 'pending';
    void new RestoreClient(transport).download(session, photo(visit())).then(
      () => {
        outcome = 'success';
      },
      () => {
        outcome = 'failed';
      },
    );
    await vi.advanceTimersByTimeAsync(30000);
    expect(reader.read).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(outcome).toBe('failed');
  });

  it('does not wait for cancellation or a native release error after a complete list', async () => {
    vi.useFakeTimers();
    const reader = nativeReader();
    reader.read
      .mockResolvedValueOnce({ done: false, value: listBytes })
      .mockResolvedValueOnce({ done: true, value: undefined });
    reader.cancel.mockImplementation(() => new Promise(() => {}));
    reader.releaseLock.mockImplementation(() => {
      throw Error('native lock not released');
    });
    const { response } = nativeResponse(reader);
    let outcome: unknown = 'pending';
    void new RestoreClient(async () => response).visits(session, 0).then(
      (value) => {
        outcome = value;
      },
      () => {
        outcome = 'failed';
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome).toEqual({ items: [], cursor: 0, hasMore: false });
    expect(reader.cancel).toHaveBeenCalledOnce();
    expect(reader.releaseLock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ends a partially read metadata list even if cancellation never settles', async () => {
    vi.useFakeTimers();
    const reader = nativeReader();
    reader.read
      .mockResolvedValueOnce({ done: false, value: listBytes.slice(0, 8) })
      .mockImplementation(() => new Promise(() => {}));
    reader.cancel.mockImplementation(() => new Promise(() => {}));
    const { response } = nativeResponse(reader);
    let outcome = 'pending';
    void new RestoreClient(async () => response).visits(session, 0).then(
      () => {
        outcome = 'success';
      },
      () => {
        outcome = 'failed';
      },
    );
    await vi.advanceTimersByTimeAsync(9999);
    expect(outcome).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBe('failed');
    expect(reader.cancel).toHaveBeenCalledOnce();
  });

  it('can retry after a deadline and cancels a late transport response without reading it', async () => {
    vi.useFakeTimers();
    let finish!: (response: Response) => void;
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(new Response(listBytes));
    const client = new RestoreClient(transport);
    const first = client.visits(session, 0).catch((error) => error);
    await vi.advanceTimersByTimeAsync(10000);
    expect(await first).toMatchObject({ message: expect.stringContaining('복원 대기') });
    await expect(client.visits(session, 0)).resolves.toEqual({
      items: [],
      cursor: 0,
      hasMore: false,
    });
    const { response, body } = nativeResponse(nativeReader());
    body.cancel.mockImplementation(() => new Promise(() => {}));
    finish(response);
    await vi.advanceTimersByTimeAsync(0);
    expect(body.cancel).toHaveBeenCalledOnce();
    expect(body.getReader).not.toHaveBeenCalled();
  });

  it('rejects download bytes arriving after the deadline without continuing the read', async () => {
    vi.useFakeTimers();
    let finish!: (result: ReadableStreamReadResult<Uint8Array>) => void;
    const reader = nativeReader();
    reader.read
      .mockResolvedValueOnce({ done: false, value: bytes.slice(0, 3) })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const { response } = nativeResponse(reader);
    let outcome = 'pending';
    void new RestoreClient(async () => response).download(session, photo(visit())).then(
      () => {
        outcome = 'success';
      },
      () => {
        outcome = 'failed';
      },
    );
    await vi.advanceTimersByTimeAsync(29999);
    expect(outcome).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBe('failed');
    finish({ done: false, value: bytes.slice(3) });
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome).toBe('failed');
    expect(reader.read).toHaveBeenCalledTimes(2);
  });

  it('preserves HTTP authentication failures without waiting for unread-body cancellation', async () => {
    vi.useFakeTimers();
    const { response, body } = nativeResponse(nativeReader(), 401);
    body.cancel.mockImplementation(() => new Promise(() => {}));
    let outcome: unknown = 'pending';
    void new RestoreClient(async () => response).visits(session, 0).catch((error) => {
      outcome = error;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome).toMatchObject({ status: 401 });
    expect(body.getReader).not.toHaveBeenCalled();
    expect(body.cancel).toHaveBeenCalledOnce();
  });
});
