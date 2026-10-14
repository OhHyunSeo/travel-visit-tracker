import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Repository, type SqlConnection } from '../src/storage/repository';
import { advanceDwell } from '../src/domain/dwell';
import { collectionStats } from '../src/domain/collection';
import type { Candidate } from '../src/domain/types';

let db: DatabaseSync, directory: string, repository: Repository, connection: SqlConnection;
function adapter(database: DatabaseSync): SqlConnection {
  return {
    exec: async (sql) => {
      database.exec(sql);
    },
    run: async (sql, ...params) => {
      const r = database.prepare(sql).run(...params);
      return { changes: Number(r.changes) };
    },
    first: async <T>(sql: string, ...params: (string | number | null)[]) =>
      (database.prepare(sql).get(...params) as T | undefined) ?? null,
    all: async <T>(sql: string, ...params: (string | number | null)[]) =>
      database.prepare(sql).all(...params) as T[],
  };
}
const pack = { id: 'pack', version: 'v1', count: 2 },
  regions = [
    { id: 'A', name: '지역 A' },
    { id: 'B', name: '지역 B' },
  ];
const initial = 1000000;
async function record(target = repository, id = 'session-A', regionId = 'A') {
  await target.setRecording(true);
  for (let t = 0; t <= 300000; t += 60000)
    await target.processObservation(
      (c) =>
        advanceDwell(
          c,
          {
            longitude: 127,
            latitude: 37,
            accuracy: 10,
            timestamp: initial + t,
            regionId,
            boundaryDistanceM: 100,
          },
          initial + t,
          () => id,
        ),
      () => `${id}-visit`,
    );
}
async function observe(
  delta: number,
  { accuracy = 10, regionId = 'A', receivedAt = initial + delta } = {},
  target = repository,
) {
  const timestamp = initial + delta;
  await target.processObservation(
    (previous) =>
      advanceDwell(
        previous,
        {
          longitude: 127,
          latitude: 37,
          accuracy,
          timestamp,
          regionId,
          boundaryDistanceM: 100,
        },
        receivedAt,
        () => `session-${delta}`,
      ),
    () => `visit-${delta}`,
    { timestamp, accuracy, receivedAt },
  );
}
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'trip-painting-test-'));
  db = new DatabaseSync(join(directory, 'data.sqlite'));
  connection = adapter(db);
  repository = new Repository(connection);
  await repository.initialize(pack, regions);
});
afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
describe('persistent visits, candidate, photos and outbox', () => {
  it('restores confirmed visits and pending work after closing the database', async () => {
    await record();
    db.close();
    db = new DatabaseSync(join(directory, 'data.sqlite'));
    const restored = await new Repository(adapter(db)).snapshot(false);
    expect(restored.visits).toHaveLength(1);
    expect(restored.pending).toBe(1);
    expect(restored.candidate?.confirmedAt).toBe(initial + 300000);
  });
  it('persists an unfinished candidate through repository recreation', async () => {
    await repository.setRecording(true);
    const c: Candidate = {
      id: 'candidate',
      regionId: 'A',
      startedAt: initial,
      lastObservedAt: initial + 60000,
      confirmedAt: null,
    };
    await repository.processObservation(
      () => ({ candidate: c, confirmed: null, status: 'candidate', message: '확인 중' }),
      () => 'unused',
    );
    expect((await new Repository(connection).snapshot(false)).candidate).toEqual(c);
  });
  it('does not create duplicate visits or queued work for a repeated confirmation', async () => {
    await record();
    const c = (await repository.snapshot(false)).candidate!;
    await repository.processObservation(
      () => ({ candidate: c, confirmed: c, status: 'confirmed', message: '확정' }),
      () => 'duplicate',
    );
    const result = await repository.snapshot(false);
    expect(result.visits).toHaveLength(1);
    expect(result.pending).toBe(1);
  });
  it('rolls back both visit and candidate if queue insertion fails', async () => {
    await repository.setRecording(true);
    const failing = new Repository({
      ...connection,
      run: async (sql, ...params) => {
        if (sql.includes('INSERT INTO outbox')) throw new Error('disk failure');
        return connection.run(sql, ...params);
      },
    });
    const c: Candidate = {
      id: 'session',
      regionId: 'A',
      startedAt: initial,
      lastObservedAt: initial + 300000,
      confirmedAt: initial + 300000,
    };
    await expect(
      failing.processObservation(
        () => ({ candidate: c, confirmed: c, status: 'confirmed', message: '' }),
        () => 'visit',
      ),
    ).rejects.toThrow('disk failure');
    const result = await repository.snapshot(false);
    expect(result.visits).toHaveLength(0);
    expect(result.candidate).toBeNull();
  });
  it('serializes concurrent writes without corrupting transactions', async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => repository.developmentVisit('A', `debug-${i}`, initial)),
    );
    expect((await repository.snapshot(true)).visits).toHaveLength(12);
  });
  it('isolates guest and account records, photos and work', async () => {
    await record();
    const account = new Repository(connection, 'account-B');
    expect((await account.snapshot(true)).visits).toHaveLength(0);
    expect((await account.snapshot(true)).pending).toBe(0);
    await expect(
      account.addPhoto({
        id: 'p',
        visitId: 'session-A-visit',
        uri: 'file:///p.jpg',
        createdAt: initial,
      }),
    ).rejects.toThrow();
    expect(await account.deleteVisit('session-A-visit', 'delete-B', initial)).toEqual([]);
    expect((await repository.snapshot(false)).visits).toHaveLength(1);
  });
  it('stores photos durably and queues GPS photos', async () => {
    await record();
    await repository.addPhoto({
      id: 'photo',
      visitId: 'session-A-visit',
      uri: 'file:///documents/photo.jpg',
      createdAt: initial + 400000,
    });
    const result = await new Repository(connection).snapshot(false);
    expect(result.photos[0].uri).toBe('file:///documents/photo.jpg');
    expect(result.pending).toBe(2);
  });
  it('removes local photo references and queues a tombstone on deletion', async () => {
    await record();
    await repository.addPhoto({
      id: 'photo',
      visitId: 'session-A-visit',
      uri: 'file:///p.jpg',
      createdAt: initial,
    });
    expect(await repository.deleteVisit('session-A-visit', 'deletion', initial + 400000)).toEqual([
      'file:///p.jpg',
    ]);
    const result = await repository.snapshot(false);
    expect(result.visits).toHaveLength(0);
    expect(result.photos).toHaveLength(0);
    const deletion = await connection.first<{ operation: string }>(
      'SELECT operation FROM outbox WHERE id=?',
      'deletion',
    );
    expect(deletion?.operation).toBe('delete');
  });
  it('ignores late location callbacks after recording is disabled', async () => {
    await repository.setRecording(false);
    await repository.processObservation(
      () => {
        throw new Error('must not run');
      },
      () => 'unused',
    );
    expect((await repository.snapshot(false)).candidate).toBeNull();
  });
  it('checks the collector guard after a queued transaction begins', async () => {
    await record();
    const before = await repository.snapshot(false);
    let active = true;
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delayed = new Repository({
      ...connection,
      exec: async (sql) => {
        if (sql === 'BEGIN IMMEDIATE') {
          entered();
          await waiting;
        }
        await connection.exec(sql);
      },
    });
    const saving = delayed.processObservation(
      () => {
        throw new Error('removed collector must not advance dwell');
      },
      () => 'late-visit',
      undefined,
      () => active,
    );
    await started;
    active = false;
    release();
    await saving;
    expect(await repository.snapshot(false)).toEqual(before);
  });
  it('rechecks the collector guard after an asynchronous recording-state read', async () => {
    await repository.setRecording(true);
    let active = true;
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delayed = new Repository({
      ...connection,
      first: async <T>(sql: string, ...params: (string | number | null)[]) => {
        const result = await connection.first<T>(sql, ...params);
        if (sql === 'SELECT value FROM settings WHERE key=?' && params[0] === 'guest:recording') {
          entered();
          await waiting;
        }
        return result;
      },
    });
    const saving = delayed.processObservation(
      () => {
        throw new Error('removed collector must not advance dwell');
      },
      () => 'late-visit',
      undefined,
      () => active,
    );
    await started;
    active = false;
    release();
    await saving;
    expect((await repository.snapshot(false)).candidate).toBeNull();
  });
  it('does not let a guarded stale failure clear a current candidate', async () => {
    await repository.setRecording(true);
    await observe(0);
    const before = await repository.snapshot(false);
    await repository.interruptCandidate('removed collector failure', initial + 1000, () => false);
    expect(await repository.snapshot(false)).toEqual(before);
  });
  it('excludes development visits from production snapshots and sync', async () => {
    await repository.developmentVisit('A', 'debug', initial);
    expect((await repository.snapshot(true)).visits).toHaveLength(1);
    expect((await repository.snapshot(false)).visits).toHaveLength(0);
    expect((await repository.snapshot(true)).pending).toBe(0);
  });
  it('rejects a database produced by a future migration', async () => {
    db.exec('PRAGMA user_version=99');
    await expect(repository.initialize(pack, regions)).rejects.toThrow('새로운 데이터');
  });
});
describe('candidate expiration', () => {
  it('expires only after the allowed observation gap and retains confirmed visits and work', async () => {
    await record();
    expect(await repository.expireCandidate(initial + 420000)).toBe(false);
    expect(await repository.expireCandidate(initial + 420001)).toBe(true);
    const state = await repository.snapshot(false);
    expect(state.candidate).toBeNull();
    expect(state.visits).toHaveLength(1);
    expect(state.pending).toBe(1);
    expect(state.diagnostics.lastResetAt).toBe(initial + 420001);
  });
  it('uses the row saved by a newer observation instead of a stale snapshot', async () => {
    await repository.setRecording(true);
    await observe(0);
    const stale = (await repository.snapshot(false)).candidate!;
    await observe(90000);
    expect(await repository.expireCandidate(stale.lastObservedAt + 130000)).toBe(false);
    expect((await repository.snapshot(false)).candidate?.lastObservedAt).toBe(initial + 90000);
  });
  it('does not expire a different owner candidate', async () => {
    const account = new Repository(connection, 'account');
    await account.setRecording(true);
    await observe(0, {}, account);
    expect(await repository.expireCandidate(initial + 180000)).toBe(false);
    expect((await account.snapshot(false)).candidate).not.toBeNull();
  });
});
describe('collection counts', () => {
  it('counts unique active pack regions and one badge per threshold', async () => {
    await repository.developmentVisit('A', 'v1', initial);
    await repository.developmentVisit('A', 'v2', initial);
    const result = collectionStats((await repository.snapshot(true)).visits, new Set(['A', 'B']));
    expect(result.count).toBe(1);
    expect(result.percentage).toBe(50);
    expect(result.badges.filter((b) => b.earned)).toHaveLength(1);
    await repository.deleteVisit('v1', 'd1', initial);
    expect(
      collectionStats((await repository.snapshot(true)).visits, new Set(['A', 'B'])).count,
    ).toBe(1);
    await repository.deleteVisit('v2', 'd2', initial);
    expect(
      collectionStats((await repository.snapshot(true)).visits, new Set(['A', 'B'])).count,
    ).toBe(0);
  });
  it('handles an empty pack', () => {
    expect(collectionStats([], new Set()).percentage).toBe(0);
  });
});
describe('local tracking diagnostics', () => {
  it('restores reset details and quality after reopening the SQLite file', async () => {
    await repository.setRecording(true);
    await repository.setCollectorMode('foreground');
    await observe(0);
    await observe(60000, { accuracy: 90, receivedAt: initial + 60017 });
    const interrupted = (await repository.snapshot(false)).diagnostics;
    expect(interrupted.lastResetAt).toBe(initial + 60017);
    expect(interrupted.lastResetReason).toContain('위치가 불확실');
    await observe(75000, { accuracy: 12, receivedAt: initial + 75017 });
    db.close();
    db = new DatabaseSync(join(directory, 'data.sqlite'));
    const reopened = new Repository(adapter(db));
    await reopened.initialize(pack, regions);
    const result = await reopened.snapshot(false);
    expect(result.diagnostics).toEqual({
      lastSampleAt: initial + 75000,
      accuracyM: 12,
      gapMs: 15000,
      delayMs: 17,
      lastResetAt: interrupted.lastResetAt,
      lastResetReason: interrupted.lastResetReason,
      collectorMode: 'foreground',
    });
    expect(result.candidate?.startedAt).toBe(initial + 75000);
  });
  it('keeps an explicit interruption after subsequent normal observations', async () => {
    await repository.setRecording(true);
    await observe(0);
    await repository.interruptCandidate(
      '앱이 화면 밖으로 나가 기록이 중단됐습니다.',
      initial + 10000,
    );
    await observe(15000);
    const result = await repository.snapshot(false);
    expect(result.status).toBe('candidate');
    expect(result.diagnostics.lastResetReason).toBe('앱이 화면 밖으로 나가 기록이 중단됐습니다.');
    expect(result.diagnostics.lastResetAt).toBe(initial + 10000);
  });
  it.each([240000, 300000])(
    'keeps the latest quality and reset reason when old events follow %i ms of observations',
    async (duration) => {
      await repository.setRecording(true);
      await repository.interruptCandidate('이전 체류 확인이 중단됐습니다.', initial - 1000);
      for (let delta = 0; delta <= duration; delta += 60000)
        await observe(delta, { accuracy: 12, receivedAt: initial + delta + 19 });
      const before = await repository.snapshot(false);
      for (const delta of [60000, 1000])
        await observe(delta, { accuracy: 3, receivedAt: initial + duration + 15000 });
      const after = await repository.snapshot(false);
      expect(after.diagnostics).toEqual(before.diagnostics);
      expect(after.candidate).toEqual(before.candidate);
      expect(after.visits).toEqual(before.visits);
      expect(after.pending).toBe(before.pending);
    },
  );
  it('records distinct region-change and observation-gap reset reasons', async () => {
    await repository.setRecording(true);
    await observe(0);
    await observe(60000, { regionId: 'B' });
    const moved = (await repository.snapshot(false)).diagnostics;
    expect(moved.lastResetReason).toContain('다른 지역');
    expect(moved.lastResetAt).toBe(initial + 60000);
    await observe(182000, { regionId: 'B' });
    const interrupted = (await repository.snapshot(false)).diagnostics;
    expect(interrupted.lastResetReason).toContain('위치 관측이 끊겨');
    expect(interrupted.lastResetAt).toBe(initial + 182000);
    expect(interrupted.gapMs).toBe(122000);
  });
  it('isolates diagnostics by owner and stores no coordinates or region names', async () => {
    await repository.setRecording(true);
    await repository.setCollectorMode('background');
    await observe(0);
    await repository.interruptCandidate('위치 관측이 중단됐습니다.', initial + 10000);
    const guest = (await repository.snapshot(false)).diagnostics;
    const account = new Repository(connection, 'account-B');
    expect((await account.snapshot(false)).diagnostics).toEqual({
      lastSampleAt: null,
      accuracyM: null,
      gapMs: null,
      delayMs: null,
      lastResetAt: null,
      lastResetReason: null,
      collectorMode: 'off',
    });
    await account.setCollectorMode('foreground');
    await account.interruptCandidate('권한을 확인해 주세요.', initial + 20000);
    expect((await repository.snapshot(false)).diagnostics).toEqual(guest);
    const stored = await connection.first<{ value: string }>(
      'SELECT value FROM settings WHERE key=?',
      'guest:diagnostics',
    );
    expect(Object.keys(JSON.parse(stored!.value)).sort()).toEqual(
      [
        'lastSampleAt',
        'accuracyM',
        'gapMs',
        'delayMs',
        'lastResetAt',
        'lastResetReason',
        'collectorMode',
      ].sort(),
    );
  });
  it('represents an unavailable accuracy without persisting Infinity', async () => {
    await repository.setRecording(true);
    await observe(0);
    await observe(15000, { accuracy: Infinity });
    const result = await repository.snapshot(false);
    expect(result.diagnostics.accuracyM).toBeNull();
    expect(result.diagnostics.lastResetReason).toContain('올바른 위치');
    expect(result.candidate).toBeNull();
  });
  it('allows current quality to replace a rejected future timestamp', async () => {
    await repository.setRecording(true);
    await observe(0);
    await observe(100000, { receivedAt: initial + 60000 });
    await observe(75000);
    const result = await repository.snapshot(false);
    expect(result.diagnostics.lastSampleAt).toBe(initial + 75000);
    expect(result.diagnostics.delayMs).toBe(0);
    expect(result.candidate?.startedAt).toBe(initial + 75000);
  });
});

describe('account scope and explicit guest transfer', () => {
  it('keeps current guest recording when the active owner has never been changed', async () => {
    await record();
    expect(await repository.activeOwner()).toBe('guest');
    expect((await repository.snapshot(false)).recording).toBe(true);
  });
  it('changes only the active view, preserving account and guest visits', async () => {
    await record();
    const account = new Repository(connection, 'account:test:1');
    await repository.setRecording(false);
    await account.activateOwner();
    expect(await repository.activeOwner()).toBe(account.ownerId);
    expect((await account.snapshot(false)).visits).toEqual([]);
    expect((await repository.snapshot(false)).visits).toHaveLength(1);
    await record(account, 'account-session', 'B');
    await account.setRecording(false);
    await repository.activateOwner();
    expect((await repository.snapshot(false)).visits).toHaveLength(1);
    expect((await account.snapshot(false)).visits).toHaveLength(1);
  });
  it('moves GPS visits, photo associations and pending work together without altering IDs or file paths', async () => {
    await record();
    await repository.addPhoto({
      id: 'guest-photo',
      visitId: 'session-A-visit',
      uri: 'persistent://saved-photo',
      createdAt: initial + 400000,
    });
    await repository.developmentVisit('B', 'development-visit', initial + 500000);
    await repository.addPhoto({
      id: 'development-photo',
      visitId: 'development-visit',
      uri: 'persistent://development-photo',
      createdAt: initial + 600000,
    });
    const before = await repository.snapshot(true);
    await repository.setRecording(false);
    const account = new Repository(connection, 'account:test:1');
    await account.activateOwner();
    expect(await repository.guestRecordCounts()).toEqual({ visits: 1, photos: 1 });
    expect(await account.importGuestRecords()).toEqual({ visits: 1, photos: 1 });
    const imported = await account.snapshot(false);
    expect(imported.visits[0]).toEqual(before.visits.find((v) => v.source === 'gps'));
    expect(imported.photos).toEqual([before.photos.find((p) => p.id === 'guest-photo')]);
    expect(imported.pending).toBe(2);
    const guest = await repository.snapshot(true);
    expect(guest.visits.map((v) => v.id)).toEqual(['development-visit']);
    expect(guest.photos.map((p) => p.id)).toEqual(['development-photo']);
    expect(guest.pending).toBe(0);
    expect(await account.importGuestRecords()).toEqual({ visits: 0, photos: 0 });
    expect((await account.snapshot(false)).pending).toBe(2);
  });
  it('preserves deletion markers and their pending operations during transfer', async () => {
    await record();
    await repository.deleteVisit('session-A-visit', 'delete-operation', initial + 500000);
    await repository.setRecording(false);
    const account = new Repository(connection, 'account:test:1');
    await account.activateOwner();
    await account.importGuestRecords();
    expect((await account.snapshot(false)).visits).toEqual([]);
    expect((await account.snapshot(false)).pending).toBe(2);
    expect(
      db.prepare('SELECT owner_id,deleted_at FROM visits WHERE id=?').get('session-A-visit'),
    ).toEqual({ owner_id: account.ownerId, deleted_at: initial + 500000 });
  });
  it('rolls back photo and outbox transfer when the destination already has the same session', async () => {
    await record();
    await repository.addPhoto({
      id: 'guest-photo',
      visitId: 'session-A-visit',
      uri: 'persistent://saved-photo',
      createdAt: initial + 400000,
    });
    const account = new Repository(connection, 'account:test:1');
    await account.developmentVisit('A', 'different-visit', initial + 500000);
    db.prepare('UPDATE visits SET session_id=? WHERE id=?').run('session-A', 'different-visit');
    await repository.setRecording(false);
    await account.activateOwner();
    await expect(account.importGuestRecords()).rejects.toThrow();
    const guest = await repository.snapshot(false);
    expect(guest.visits).toHaveLength(1);
    expect(guest.photos[0].uri).toBe('persistent://saved-photo');
    expect(guest.pending).toBe(2);
    expect((await account.snapshot(false)).visits).toEqual([]);
    expect((await account.snapshot(true)).photos).toEqual([]);
  });
  it('cannot import into an inactive account or into guest', async () => {
    await record();
    const account = new Repository(connection, 'account:test:1');
    await expect(account.importGuestRecords()).rejects.toThrow('현재 계정이 바뀌었습니다');
    await expect(repository.importGuestRecords()).rejects.toThrow('먼저 로그인');
    expect((await repository.snapshot(false)).visits).toHaveLength(1);
  });
  it('serializes transactions across different owners on the same connection', async () => {
    const a = new Repository(connection, 'account:test:1'),
      b = new Repository(connection, 'account:test:2');
    await Promise.all([
      a.developmentVisit('A', 'a-visit', initial),
      b.developmentVisit('B', 'b-visit', initial),
    ]);
    expect((await a.snapshot(true)).visits.map((v) => v.id)).toEqual(['a-visit']);
    expect((await b.snapshot(true)).visits.map((v) => v.id)).toEqual(['b-visit']);
    expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
  });
});
describe('account-scoped visit outbox acknowledgements', () => {
  async function accountWithVisits() {
    const account = new Repository(connection, 'account:test:1');
    await account.activateOwner();
    await record(account, 'first');
    await record(account, 'second');
    return account;
  }
  it('reads bounded visit batches without including photos, guest or another account', async () => {
    await record(repository, 'guest');
    const account = await accountWithVisits();
    await account.addPhoto({
      id: 'photo',
      visitId: 'first-visit',
      uri: 'file:///synthetic.jpg',
      createdAt: initial,
    });
    expect((await account.pendingVisitOperations(1)).map((op) => op.id)).toEqual(['first-visit']);
    expect(await account.pendingVisitOperations()).toHaveLength(2);
    await expect(repository.pendingVisitOperations()).rejects.toThrow('현재 로그인한 계정');
    await expect(
      new Repository(connection, 'account:test:2').pendingVisitOperations(),
    ).rejects.toThrow();
    await expect(account.pendingVisitOperations(101)).rejects.toThrow();
  });
  it('retains operation IDs and payloads after an interrupted attempt and database reopening', async () => {
    const account = await accountWithVisits();
    const sent = await account.pendingVisitOperations();
    await account.noteVisitAttempt(sent);
    db.close();
    db = new DatabaseSync(join(directory, 'data.sqlite'));
    connection = adapter(db);
    const reopened = new Repository(connection, account.ownerId);
    const retry = await reopened.pendingVisitOperations();
    expect(retry).toEqual(sent.map((op) => ({ ...op, attempts: 1 })));
    expect((await reopened.snapshot(false)).visits).toHaveLength(2);
  });
  it('removes only acknowledged visit operations and preserves photo work and saved visits', async () => {
    const account = await accountWithVisits();
    await account.addPhoto({
      id: 'photo',
      visitId: 'first-visit',
      uri: 'file:///synthetic.jpg',
      createdAt: initial,
    });
    const sent = await account.pendingVisitOperations();
    expect(await account.acknowledgeVisitOperations(sent, [sent[0].id])).toBe(1);
    const state = await account.snapshot(false);
    expect(state.pending).toBe(2);
    expect(state.visits).toHaveLength(2);
    expect(state.photos).toHaveLength(1);
    expect(await account.acknowledgeVisitOperations(sent, [sent[0].id])).toBe(0);
  });
  it('does not acknowledge a row whose immutable payload differs from the sent snapshot', async () => {
    const account = await accountWithVisits();
    const sent = await account.pendingVisitOperations();
    await connection.run(
      'UPDATE outbox SET payload=? WHERE id=?',
      '{"synthetic":"changed"}',
      sent[1].id,
    );
    expect(await account.acknowledgeVisitOperations(sent, [sent[1].id])).toBe(0);
    await expect(account.noteVisitAttempt(sent)).rejects.toThrow('전송할 기록이 바뀌었습니다');
    expect((await account.pendingVisitOperations()).every((op) => op.attempts === 0)).toBe(true);
    expect((await account.snapshot(false)).pending).toBe(2);
  });
  it('rejects unrequested or duplicate acknowledgements before modifying any row', async () => {
    const account = await accountWithVisits();
    const sent = await account.pendingVisitOperations();
    await expect(
      account.acknowledgeVisitOperations(sent, [sent[0].id, 'foreign']),
    ).rejects.toThrow();
    await expect(
      account.acknowledgeVisitOperations(sent, [sent[0].id, sent[0].id]),
    ).rejects.toThrow();
    expect((await account.snapshot(false)).pending).toBe(2);
  });
  it('rolls back the entire acknowledgement batch when a later SQL operation fails', async () => {
    const account = await accountWithVisits();
    const sent = await account.pendingVisitOperations();
    let deletes = 0;
    const broken = new Repository(
      {
        ...connection,
        run: async (sql, ...params) => {
          if (sql.startsWith('DELETE FROM outbox') && ++deletes === 2)
            throw new Error('disk failure');
          return connection.run(sql, ...params);
        },
      },
      account.ownerId,
    );
    await expect(
      broken.acknowledgeVisitOperations(
        sent,
        sent.map((op) => op.id),
      ),
    ).rejects.toThrow('disk failure');
    expect((await account.snapshot(false)).pending).toBe(2);
  });
  it('keeps old-account work when a response arrives after switching accounts', async () => {
    const account = await accountWithVisits();
    const sent = await account.pendingVisitOperations();
    const second = new Repository(connection, 'account:test:2');
    await second.activateOwner();
    await record(second, 'second-account');
    await expect(
      account.acknowledgeVisitOperations(
        sent,
        sent.map((op) => op.id),
      ),
    ).rejects.toThrow();
    await expect(account.noteVisitAttempt(sent)).rejects.toThrow();
    expect((await account.snapshot(false)).pending).toBe(2);
    expect((await second.snapshot(false)).pending).toBe(1);
  });
});
