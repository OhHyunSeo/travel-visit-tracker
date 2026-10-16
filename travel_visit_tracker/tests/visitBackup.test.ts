import { describe, expect, it, vi } from 'vitest';
import { sessionOwner, type Session } from '../src/services/authClient';
import { VisitBackupCoordinator, type VisitBackupRepository } from '../src/services/visitBackup';
import { VisitSyncClient } from '../src/services/visitSync';
import type { QueuedVisitOperation, VisitBackupState } from '../src/storage/outbox';

const session: Session = {
  apiUrl: 'https://backup.example.test',
  user: { id: 1, email: 'synthetic@example.test', username: '검증 계정' },
  token: 'synthetic-token',
};
const owner = sessionOwner(session);
const operation = (index: number): QueuedVisitOperation => ({
  id: `operation-${index}`,
  entityId: `visit-${index}`,
  entityType: 'visit',
  operation: 'upsert',
  serializedPayload: JSON.stringify({ id: `visit-${index}` }),
  createdAt: index,
  attempts: 0,
});
function harness(count = 1, enabled = true) {
  let current: Session | null = session;
  let now = 100000;
  let active = true;
  let rows = Array.from({ length: count }, (_, index) => operation(index));
  const state: Omit<VisitBackupState, 'pendingVisits'> = {
    autoEnabled: enabled,
    pendingPhotos: 2,
    lastSuccessAt: null,
    nextAttemptAt: null,
    pauseReason: null,
  };
  const repository: VisitBackupRepository = {
    ownerId: owner,
    visitBackupState: vi.fn(async () => ({ ...state, pendingVisits: rows.length })),
    setVisitBackupEnabled: vi.fn(async (enabled) => {
      state.autoEnabled = enabled;
    }),
    recordVisitBackupResult: vi.fn(async (result, guard) => {
      if (guard && !guard()) throw new Error('changed session');
      if (result.successAt !== undefined) state.lastSuccessAt = result.successAt;
      state.nextAttemptAt = result.nextAttemptAt;
      if (result.pauseReason !== undefined) state.pauseReason = result.pauseReason;
    }),
    pendingVisitOperations: vi.fn(async () => rows.slice(0, 100)),
    noteVisitAttempt: vi.fn(async (sent: readonly QueuedVisitOperation[]) => {
      rows = rows.map((row) =>
        sent.some((item) => item.id === row.id) ? { ...row, attempts: row.attempts + 1 } : row,
      );
    }),
    acknowledgeVisitOperations: vi.fn(async (_sent, ids) => {
      const before = rows.length;
      rows = rows.filter((row) => !ids.includes(row.id));
      return before - rows.length;
    }),
  };
  const send = vi.fn<typeof fetch>(async (_url, request) => {
    const body = JSON.parse(request!.body as string) as { operations: { id: string }[] };
    return Response.json({ acknowledgedIds: body.operations.map((operation) => operation.id) });
  });
  const factory = vi.fn(async () => repository);
  const coordinator = () =>
    new VisitBackupCoordinator(
      () => current,
      factory,
      new VisitSyncClient(send),
      () => now,
      () => active,
    );
  return {
    backup: coordinator(),
    coordinator,
    repository,
    factory,
    send,
    state,
    rows: () => rows,
    switchSession: (value: Session | null) => {
      current = value;
    },
    advance: (delta: number) => {
      now += delta;
    },
    background: () => {
      active = false;
    },
  };
}

describe('foreground visit backup coordinator', () => {
  it.each([null, { ...session, token: null }])(
    'does not touch storage or network without a usable session',
    async (current) => {
      const h = harness();
      h.switchSession(current);
      expect(await h.backup.run()).toMatchObject({ skipped: true, message: null });
      expect(await h.backup.run(true)).toMatchObject({
        skipped: true,
        message: expect.any(String),
      });
      expect(h.factory).not.toHaveBeenCalled();
      expect(h.send).not.toHaveBeenCalled();
    },
  );
  it('requires automatic opt-in but permits manual backup and keeps photo work distinct', async () => {
    const h = harness(1, false);
    expect(await h.backup.run()).toMatchObject({ skipped: true });
    expect(h.send).not.toHaveBeenCalled();
    expect(await h.backup.run(true)).toMatchObject({
      acknowledged: 1,
      message: expect.stringContaining('사진'),
    });
    expect(h.state).toMatchObject({ pendingPhotos: 2, lastSuccessAt: 100000, autoEnabled: false });
  });
  it('honours a saved retry delay after recreating the coordinator, while manual retry bypasses it', async () => {
    const h = harness();
    h.state.nextAttemptAt = 130000;
    expect(await h.coordinator().run()).toMatchObject({ skipped: true });
    expect(h.send).not.toHaveBeenCalled();
    expect(await h.backup.run(true)).toMatchObject({ acknowledged: 1 });
    expect(h.state).toMatchObject({ nextAttemptAt: null, lastSuccessAt: 100000 });
  });
  it('drains multiple batches and records success only after the final visit acknowledgement', async () => {
    const h = harness(201);
    expect(await h.backup.run()).toMatchObject({ acknowledged: 201, skipped: false });
    expect(h.send).toHaveBeenCalledTimes(3);
    expect(
      h.send.mock.calls.map(([, request]) => JSON.parse(request!.body as string).operations.length),
    ).toEqual([100, 100, 1]);
    expect(h.repository.recordVisitBackupResult).toHaveBeenCalledTimes(1);
    expect(h.state).toMatchObject({ pendingPhotos: 2, lastSuccessAt: 100000 });
  });
  it('limits a single run to ten batches and leaves the rest pending without claiming completion', async () => {
    const h = harness(1001);
    expect(await h.backup.run()).toMatchObject({
      acknowledged: 1000,
      message: expect.stringContaining('대기'),
    });
    expect(h.send).toHaveBeenCalledTimes(10);
    expect(h.rows()).toHaveLength(1);
    expect(h.state).toMatchObject({ lastSuccessAt: null, nextAttemptAt: 130000 });
  });
  it('keeps partially acknowledged work and stops retrying when the server makes no progress', async () => {
    const h = harness(3);
    h.send.mockResolvedValueOnce(Response.json({ acknowledgedIds: ['operation-0'] }));
    h.send.mockResolvedValueOnce(Response.json({ acknowledgedIds: [] }));
    expect(await h.backup.run()).toMatchObject({ acknowledged: 1 });
    expect(h.rows().map((row) => row.id)).toEqual(['operation-1', 'operation-2']);
    expect(h.state).toMatchObject({ pendingPhotos: 2, lastSuccessAt: null, nextAttemptAt: 130000 });
  });
  it('replays the same operation IDs after a lost response and bounds exponential backoff', async () => {
    const h = harness();
    h.send.mockRejectedValue(new Error('private network details'));
    const delays = [30000, 60000, 120000, 240000, 300000, 300000];
    let clock = 100000;
    for (const delay of delays) {
      const result = await h.backup.run();
      expect(result.message).not.toContain('private network details');
      expect(h.state.nextAttemptAt).toBe(clock + delay);
      h.advance(delay);
      clock += delay;
    }
    h.send.mockImplementationOnce(async (_url, request) => {
      expect(JSON.parse(request!.body as string).operations[0].id).toBe('operation-0');
      return Response.json({ acknowledgedIds: ['operation-0'] });
    });
    expect(await h.backup.run()).toMatchObject({ acknowledged: 1 });
    expect(h.state.nextAttemptAt).toBeNull();
    expect(h.state.lastSuccessAt).toBe(clock);
  });
  it('coalesces overlapping automatic and manual requests into the same promise', async () => {
    const h = harness();
    let release!: (response: Response) => void;
    h.send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = h.backup.run();
    expect(h.backup.run(true)).toBe(first);
    await vi.waitFor(() => expect(h.send).toHaveBeenCalledTimes(1));
    release(Response.json({ acknowledgedIds: ['operation-0'] }));
    expect(await first).toMatchObject({ acknowledged: 1 });
    expect(h.send).toHaveBeenCalledTimes(1);
  });
  it('upgrades a simultaneous automatic no-op to the requested manual attempt', async () => {
    const h = harness(1, false);
    h.state.nextAttemptAt = 999999;
    const automatic = h.backup.run();
    const manual = h.backup.run(true);
    expect(manual).toBe(automatic);
    expect(await manual).toMatchObject({ acknowledged: 1, skipped: false });
    expect(h.send).toHaveBeenCalledTimes(1);
  });
  it('captures the account when called, before the shared promise begins running', async () => {
    const h = harness();
    const pending = h.backup.run(true);
    h.switchSession({ ...session, user: { ...session.user, id: 2 }, token: 'account-b-token' });
    expect(await pending).toMatchObject({ ownerId: owner, paused: true, acknowledged: 0 });
    expect(h.factory).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });
  it('does not touch storage or network for automatic work while already in the background', async () => {
    const h = harness();
    h.background();
    expect(await h.backup.run()).toMatchObject({ skipped: true });
    expect(h.factory).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });
  it('acknowledges the in-flight batch but sends no additional batch after backgrounding', async () => {
    const h = harness(101);
    h.send.mockImplementationOnce(async () => {
      h.background();
      return Response.json({
        acknowledgedIds: Array.from({ length: 100 }, (_, i) => `operation-${i}`),
      });
    });
    expect(await h.backup.run()).toMatchObject({ acknowledged: 100, paused: true });
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.rows()).toHaveLength(1);
    expect(h.state.lastSuccessAt).toBeNull();
  });
  it('rechecks foreground state immediately before dispatch after an asynchronous queue read', async () => {
    const h = harness();
    vi.mocked(h.repository.pendingVisitOperations).mockImplementationOnce(async () => {
      h.background();
      return h.rows();
    });
    expect(await h.backup.run()).toMatchObject({ acknowledged: 0, paused: true });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.repository.recordVisitBackupResult).not.toHaveBeenCalled();
    expect(h.rows()).toHaveLength(1);
  });
  it.each(['account', 'token'])(
    'keeps pending work and metadata untouched after a late response crosses a %s change',
    async (change) => {
      const h = harness(101);
      h.send.mockImplementationOnce(async () => {
        h.switchSession(
          change === 'account'
            ? { ...session, user: { ...session.user, id: 2 }, token: 'account-b-token' }
            : { ...session, token: 'replacement-token' },
        );
        return Response.json({
          acknowledgedIds: Array.from({ length: 100 }, (_, i) => `operation-${i}`),
        });
      });
      expect(await h.backup.run()).toMatchObject({ acknowledged: 0, paused: true });
      expect(h.send).toHaveBeenCalledTimes(1);
      expect(h.repository.acknowledgeVisitOperations).not.toHaveBeenCalled();
      expect(h.repository.recordVisitBackupResult).not.toHaveBeenCalled();
      expect(h.rows()).toHaveLength(101);
    },
  );
  it('does not change to a new account between batches, even after the first batch was saved', async () => {
    const h = harness(101);
    vi.mocked(h.repository.visitBackupState).mockImplementation(async () => {
      if (h.rows().length === 1) h.switchSession({ ...session, user: { ...session.user, id: 2 } });
      return { ...h.state, pendingVisits: h.rows().length };
    });
    expect(await h.backup.run()).toMatchObject({ acknowledged: 100, paused: true });
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.repository.recordVisitBackupResult).not.toHaveBeenCalled();
  });
  it('honours an automatic opt-out after the in-flight batch is acknowledged', async () => {
    const h = harness(101);
    h.send.mockImplementationOnce(async () => {
      h.state.autoEnabled = false;
      return Response.json({
        acknowledgedIds: Array.from({ length: 100 }, (_, i) => `operation-${i}`),
      });
    });
    expect(await h.backup.run()).toMatchObject({
      acknowledged: 100,
      message: expect.stringContaining('껐습니다'),
    });
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.rows()).toHaveLength(1);
    expect(h.state.lastSuccessAt).toBeNull();
  });
  it('rechecks opt-in at dispatch if automatic backup is disabled while loading the second batch', async () => {
    const h = harness(101);
    let reads = 0;
    vi.mocked(h.repository.pendingVisitOperations).mockImplementation(async () => {
      if (++reads === 2) h.state.autoEnabled = false;
      return h.rows().slice(0, 100);
    });
    expect(await h.backup.run()).toMatchObject({
      acknowledged: 100,
      message: expect.stringContaining('껐습니다'),
    });
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.rows()).toHaveLength(1);
    expect(h.repository.recordVisitBackupResult).not.toHaveBeenCalled();
  });
  it.each([401, 409])(
    'persists a %s pause across restart until manual retry succeeds',
    async (status) => {
      const h = harness();
      h.send.mockResolvedValueOnce(new Response(null, { status }));
      expect(await h.backup.run()).toMatchObject({ acknowledged: 0, message: expect.any(String) });
      expect(h.state.pauseReason).toBe(status === 401 ? 'authentication' : 'conflict');
      h.advance(24 * 60 * 60 * 1000);
      expect(await h.coordinator().run()).toMatchObject({
        skipped: true,
        message: expect.any(String),
      });
      expect(h.send).toHaveBeenCalledTimes(1);
      expect(await h.backup.run(true)).toMatchObject({ acknowledged: 1 });
      expect(h.state.pauseReason).toBeNull();
    },
  );
  it('never invents a successful backup time for an empty queue or photo-only work', async () => {
    const h = harness(0);
    expect(await h.backup.run(true)).toMatchObject({
      skipped: true,
      acknowledged: 0,
      message: expect.stringContaining('사진'),
    });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.repository.recordVisitBackupResult).not.toHaveBeenCalled();
    expect(h.state.lastSuccessAt).toBeNull();
  });
});
