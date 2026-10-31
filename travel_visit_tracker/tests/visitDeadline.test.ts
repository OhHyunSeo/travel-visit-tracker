import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessionOwner, type Session } from '../src/services/authClient';
import { VisitConnectionError, VisitSyncClient, VisitSyncRunner } from '../src/services/visitSync';
import type { QueuedVisitOperation } from '../src/storage/outbox';

const session: Session = {
  apiUrl: 'https://backup.example.test',
  token: 'synthetic-only',
  user: { id: 1, email: 'a@example.test', username: 'Synthetic A' },
};
const operation: QueuedVisitOperation = {
  id: '00000000-0000-4000-8000-000000000001',
  entityType: 'visit',
  entityId: '00000000-0000-4000-8000-000000000002',
  operation: 'delete',
  serializedPayload: JSON.stringify({
    id: '00000000-0000-4000-8000-000000000002',
    deletedAt: 1700000400000,
  }),
  createdAt: 1700000400000,
  attempts: 2,
};
const ack = JSON.stringify({ acknowledgedIds: [operation.id] });
afterEach(() => vi.useRealTimers());

function nativeResponse(status = 200) {
  const reader = {
    read: vi.fn<ReadableStreamDefaultReader<Uint8Array>['read']>(),
    cancel: vi.fn(() => new Promise<void>(() => {})),
    releaseLock: vi.fn(),
  };
  const body = { getReader: vi.fn(() => reader), cancel: vi.fn(() => new Promise<void>(() => {})) };
  const response = { ok: status >= 200 && status < 300, status, body } as unknown as Response;
  return { response, body, reader };
}

describe('visit request deadlines independent of native abort', () => {
  it('finishes a health probe after three seconds even when transport ignores abort', async () => {
    vi.useFakeTimers();
    const send = vi.fn<typeof fetch>(() => new Promise(() => {}));
    let outcome: unknown = 'pending';
    void new VisitSyncClient(send).connectionAvailable(session).then((value) => {
      outcome = value;
    });
    await vi.advanceTimersByTimeAsync(2999);
    expect(outcome).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(send.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(outcome).toBe(false);
  });

  it('releases a partial ACK wait, preserves work and retries the identical operation', async () => {
    vi.useFakeTimers();
    const stalled = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(ack.slice(0, 16)));
        },
        cancel: () => new Promise(() => {}),
      }),
    );
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(stalled)
      .mockResolvedValueOnce(new Response(ack));
    let pending = [operation];
    const outbox = {
      ownerId: sessionOwner(session),
      pendingVisitOperations: async () => pending.map((item) => ({ ...item })),
      noteVisitAttempt: vi.fn(async () => {}),
      acknowledgeVisitOperations: vi.fn(async () => {
        pending = [];
        return 1;
      }),
    };
    const runner = new VisitSyncRunner(
      () => session,
      async () => outbox,
      new VisitSyncClient(send),
    );
    let outcome: unknown = 'pending';
    void runner.run().then(
      (value) => {
        outcome = value;
      },
      (error: unknown) => {
        outcome = error;
      },
    );
    await vi.advanceTimersByTimeAsync(10000);
    expect(outcome).toBeInstanceOf(VisitConnectionError);
    expect(pending).toEqual([operation]);
    expect(outbox.acknowledgeVisitOperations).not.toHaveBeenCalled();
    await expect(runner.run()).resolves.toEqual({ sent: 1, acknowledged: 1, paused: false });
    expect(send.mock.calls[0][1]?.body).toBe(send.mock.calls[1][1]?.body);
    expect(outbox.acknowledgeVisitOperations).toHaveBeenCalledOnce();
  });

  it('ends a visit request when transport never settles or honours abort', async () => {
    vi.useFakeTimers();
    const send = vi.fn<typeof fetch>(() => new Promise(() => {}));
    const result = new VisitSyncClient(send)
      .sendBatch(session, [operation])
      .catch((error) => error);
    await vi.advanceTimersByTimeAsync(10000);
    expect(await result).toBeInstanceOf(VisitConnectionError);
    expect(send.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ends a partial health body without waiting for native read or cancellation', async () => {
    vi.useFakeTimers();
    const { response, reader } = nativeResponse();
    reader.read
      .mockResolvedValueOnce({ done: false, value: new Uint8Array([123]) })
      .mockImplementation(() => new Promise(() => {}));
    const result = new VisitSyncClient(async () => response).connectionAvailable(session);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toBe(false);
    expect(reader.read).toHaveBeenCalledTimes(2);
    expect(reader.cancel).toHaveBeenCalledOnce();
  });

  it('discards a late transport ACK without reading it or blocking a new request', async () => {
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
      .mockResolvedValueOnce(new Response(ack));
    const client = new VisitSyncClient(send);
    const first = client.sendBatch(session, [operation]).catch((error) => error);
    await vi.advanceTimersByTimeAsync(10000);
    expect(await first).toBeInstanceOf(VisitConnectionError);
    await expect(client.sendBatch(session, [operation])).resolves.toEqual([operation.id]);
    const { response, body } = nativeResponse();
    finish(response);
    await vi.advanceTimersByTimeAsync(0);
    expect(body.getReader).not.toHaveBeenCalled();
    expect(body.cancel).toHaveBeenCalledOnce();
  });

  it('rejects a late body chunk and never continues reading its ACK', async () => {
    vi.useFakeTimers();
    let finish!: (result: ReadableStreamReadResult<Uint8Array>) => void;
    const { response, reader } = nativeResponse();
    reader.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const acknowledged = vi.fn();
    const result = new VisitSyncClient(async () => response)
      .sendBatch(session, [operation])
      .then(acknowledged, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10000);
    expect(await result).toBeInstanceOf(VisitConnectionError);
    finish({ done: false, value: new TextEncoder().encode(ack) });
    await vi.advanceTimersByTimeAsync(0);
    expect(reader.read).toHaveBeenCalledOnce();
    expect(acknowledged).not.toHaveBeenCalled();
  });

  it.each(['health', 'visit'] as const)(
    'bounds %s response bytes even without Content-Length',
    async (kind) => {
      const limit = (kind === 'health' ? 4 : 64) * 1024;
      const { response, reader } = nativeResponse();
      reader.read.mockResolvedValueOnce({ done: false, value: new Uint8Array(limit + 1) });
      const client = new VisitSyncClient(async () => response);
      if (kind === 'health') await expect(client.connectionAvailable(session)).resolves.toBe(false);
      else await expect(client.sendBatch(session, [operation])).rejects.toThrow('대기 기록을 보존');
      expect(reader.read).toHaveBeenCalledOnce();
      expect(reader.cancel).toHaveBeenCalledOnce();
    },
  );

  it('accepts a complete fragmented ACK despite native cleanup errors', async () => {
    vi.useFakeTimers();
    const { response, reader } = nativeResponse();
    reader.read
      .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(ack.slice(0, 16)) })
      .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(ack.slice(16)) })
      .mockResolvedValueOnce({ done: true, value: undefined });
    reader.cancel.mockImplementation(() => {
      throw Error('native cancel failure');
    });
    reader.releaseLock.mockImplementation(() => {
      throw Error('native release failure');
    });
    await expect(
      new VisitSyncClient(async () => response).sendBatch(session, [operation]),
    ).resolves.toEqual([operation.id]);
    expect(reader.cancel).toHaveBeenCalledOnce();
    expect(reader.releaseLock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([401, 409, 500])(
    'keeps HTTP %s classification without reading a hanging error body',
    async (status) => {
      const { response, body } = nativeResponse(status);
      await expect(
        new VisitSyncClient(async () => response).sendBatch(session, [operation]),
      ).rejects.toMatchObject({ status });
      expect(body.getReader).not.toHaveBeenCalled();
      expect(body.cancel).toHaveBeenCalledOnce();
    },
  );
});
