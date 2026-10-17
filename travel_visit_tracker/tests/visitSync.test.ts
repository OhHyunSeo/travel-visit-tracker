import { describe, expect, it, vi } from 'vitest';
import { sessionOwner, type Session } from '../src/services/authClient';
import { VisitSyncClient, VisitSyncRunner } from '../src/services/visitSync';
import type { QueuedVisitOperation } from '../src/storage/outbox';

const session: Session = {
  apiUrl: 'https://backup.example.test',
  token: 'synthetic-only',
  user: { id: 1, email: 'a@example.test', username: 'Account A' },
};
const operation: QueuedVisitOperation = {
  id: '00000000-0000-4000-8000-000000000001',
  entityType: 'visit',
  entityId: '00000000-0000-4000-8000-000000000001',
  operation: 'delete',
  serializedPayload: JSON.stringify({
    id: '00000000-0000-4000-8000-000000000001',
    deletedAt: 1700000400000,
  }),
  createdAt: 1700000400000,
  attempts: 2,
};
function harness() {
  let current: Session | null = session;
  let pending = [operation];
  const outbox = {
    ownerId: sessionOwner(session),
    pendingVisitOperations: vi.fn(async () => pending.map((op) => ({ ...op }))),
    noteVisitAttempt: vi.fn(async () => undefined),
    acknowledgeVisitOperations: vi.fn(
      async (
        _sent: readonly QueuedVisitOperation[],
        ids: readonly string[],
        stillCurrent?: () => boolean,
      ) => {
        if (stillCurrent && !stillCurrent()) throw new Error('session changed before commit');
        const before = pending.length;
        pending = pending.filter((op) => !ids.includes(op.id));
        return before - pending.length;
      },
    ),
  };
  const send = vi.fn<typeof fetch>(async () => Response.json({ acknowledgedIds: [operation.id] }));
  const runner = new VisitSyncRunner(
    () => current,
    async () => outbox,
    new VisitSyncClient(send),
  );
  return {
    runner,
    outbox,
    send,
    switchSession: (next: Session | null) => {
      current = next;
    },
  };
}
describe('visit batch transport and safe local acknowledgement', () => {
  it('sends captured account credentials and stable operation content, excluding local metadata', async () => {
    const h = harness();
    expect(await h.runner.run()).toEqual({ sent: 1, acknowledged: 1, paused: false });
    const [url, request] = h.send.mock.calls[0];
    expect(url).toBe(`${session.apiUrl}/api/visits/sync`);
    expect(request?.headers).toMatchObject({ Authorization: 'Bearer synthetic-only' });
    expect(JSON.parse(request?.body as string)).toEqual({
      operations: [
        {
          id: operation.id,
          entityType: 'visit',
          entityId: operation.entityId,
          operation: 'delete',
          payload: JSON.parse(operation.serializedPayload),
        },
      ],
    });
    expect(h.outbox.noteVisitAttempt).toHaveBeenCalledBefore(h.send);
    expect(h.send).toHaveBeenCalledBefore(h.outbox.acknowledgeVisitOperations);
  });
  it.each([401, 409, 500])(
    'retains pending work after HTTP %s instead of acknowledging it',
    async (status) => {
      const h = harness();
      h.send.mockResolvedValueOnce(Response.json({}, { status }));
      await expect(h.runner.run()).rejects.toMatchObject({ status });
      expect(h.outbox.acknowledgeVisitOperations).not.toHaveBeenCalled();
      expect(await h.outbox.pendingVisitOperations()).toEqual([operation]);
    },
  );
  it('retries the same operation after a lost response without deleting pending work early', async () => {
    const h = harness();
    h.send.mockRejectedValueOnce(new Error('response lost after server commit'));
    await expect(h.runner.run()).rejects.toThrow('response lost');
    expect(h.outbox.acknowledgeVisitOperations).not.toHaveBeenCalled();
    await h.runner.run();
    expect(h.send.mock.calls[0][1]?.body).toBe(h.send.mock.calls[1][1]?.body);
    expect(h.outbox.acknowledgeVisitOperations).toHaveBeenCalledTimes(1);
  });
  it.each([
    null,
    {},
    { acknowledgedIds: ['unrequested'] },
    { acknowledgedIds: [operation.id, operation.id] },
  ])('retains work for malformed or unrelated acknowledgement %j', async (response) => {
    const h = harness();
    h.send.mockResolvedValueOnce(Response.json(response));
    await expect(h.runner.run()).rejects.toThrow('대기 기록을 보존');
    expect(h.outbox.acknowledgeVisitOperations).not.toHaveBeenCalled();
  });
  it('accepts an empty acknowledgement without pretending pending work was saved', async () => {
    const h = harness();
    h.send.mockResolvedValueOnce(Response.json({ acknowledgedIds: [] }));
    expect(await h.runner.run()).toEqual({ sent: 1, acknowledged: 0, paused: false });
    expect(await h.outbox.pendingVisitOperations()).toEqual([operation]);
  });
  it('leaves old-account work pending after logout or account change during the request', async () => {
    const h = harness();
    h.send.mockImplementationOnce(async () => {
      h.switchSession({ ...session, user: { ...session.user, id: 2 }, token: 'synthetic-b' });
      return Response.json({ acknowledgedIds: [operation.id] });
    });
    expect(await h.runner.run()).toEqual({ sent: 1, acknowledged: 0, paused: true });
    expect(h.outbox.acknowledgeVisitOperations).not.toHaveBeenCalled();
  });
  it('does not send if login changes while the pending list is loading', async () => {
    const h = harness();
    h.outbox.pendingVisitOperations.mockImplementationOnce(async () => {
      h.switchSession(null);
      return [operation];
    });
    expect(await h.runner.run()).toEqual({ sent: 0, acknowledged: 0, paused: true });
    expect(h.send).not.toHaveBeenCalled();
  });
  it.each([null, 'replacement-token'])(
    'preserves the queue if the same account token changes to %s while acknowledgement waits',
    async (token) => {
      const h = harness();
      const acknowledge = h.outbox.acknowledgeVisitOperations.getMockImplementation()!;
      h.outbox.acknowledgeVisitOperations.mockImplementationOnce(
        async (sent, ids, stillCurrent) => {
          // The native transaction can yield after the runner checks its captured session.
          await Promise.resolve();
          h.switchSession({ ...session, token });
          return acknowledge(sent, ids, stillCurrent);
        },
      );
      expect(await h.runner.run()).toEqual({ sent: 1, acknowledged: 0, paused: true });
      expect(h.send).toHaveBeenCalledOnce();
      expect(await h.outbox.pendingVisitOperations()).toEqual([operation]);
    },
  );
  it('reports a pause if the session changes after the acknowledgement has already committed', async () => {
    const h = harness();
    const acknowledge = h.outbox.acknowledgeVisitOperations.getMockImplementation()!;
    h.outbox.acknowledgeVisitOperations.mockImplementationOnce(async (sent, ids, stillCurrent) => {
      const saved = await acknowledge(sent, ids, stillCurrent);
      h.switchSession({ ...session, token: 'replacement-token' });
      return saved;
    });
    expect(await h.runner.run()).toEqual({ sent: 1, acknowledged: 1, paused: true });
    expect(await h.outbox.pendingVisitOperations()).toEqual([]);
  });
  it('propagates an acknowledgement storage failure when the captured session is still current', async () => {
    const h = harness();
    const failure = new Error('synthetic acknowledgement storage failure');
    h.outbox.acknowledgeVisitOperations.mockRejectedValueOnce(failure);
    await expect(h.runner.run()).rejects.toBe(failure);
    expect(await h.outbox.pendingVisitOperations()).toEqual([operation]);
  });
  it('serializes overlapping runs and reads the queue again after the first acknowledgement', async () => {
    const h = harness();
    expect(await Promise.all([h.runner.run(), h.runner.run()])).toEqual([
      { sent: 1, acknowledged: 1, paused: false },
      { sent: 0, acknowledged: 0, paused: false },
    ]);
    expect(h.send).toHaveBeenCalledTimes(1);
  });
  it('rejects an expired session before touching the queue or network', async () => {
    const h = harness();
    h.switchSession({ ...session, token: null });
    await expect(h.runner.run()).rejects.toMatchObject({ status: 401 });
    expect(h.outbox.pendingVisitOperations).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });
  it('aborts a stalled request and retains the queue for a later run', async () => {
    const h = harness();
    vi.useFakeTimers();
    try {
      h.send.mockImplementationOnce(
        (_url, request) =>
          new Promise((_resolve, reject) => {
            request?.signal?.addEventListener('abort', () =>
              reject(new Error('request timed out')),
            );
          }),
      );
      const result = expect(h.runner.run()).rejects.toThrow('request timed out');
      await vi.advanceTimersByTimeAsync(10000);
      await result;
      expect(h.outbox.acknowledgeVisitOperations).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
