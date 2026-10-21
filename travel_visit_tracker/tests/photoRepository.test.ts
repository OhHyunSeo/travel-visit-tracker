import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Repository, type SqlConnection } from '../src/storage/repository';
import type {
  PhotoAcknowledgement,
  PhotoFingerprint,
  QueuedPhotoOperation,
} from '../src/storage/outbox';

let directory: string, db: DatabaseSync, connection: SqlConnection, account: Repository;
const owner = 'account:synthetic-photo:1';
const pack = { id: 'synthetic', version: 'v1', count: 1 };
const regions = [{ id: 'A', name: 'Synthetic A' }];
const epoch = 1700000000000.25;
const bytes = Buffer.from('synthetic attachment bytes preserved by storage');
const fingerprint: PhotoFingerprint = {
  sha256: createHash('sha256').update(bytes).digest('hex'),
  byteLength: bytes.length,
  mimeType: 'image/png',
};
function adapter(native: DatabaseSync): SqlConnection {
  return {
    exec: async (sql) => {
      native.exec(sql);
    },
    run: async (sql, ...params) => ({
      changes: Number(native.prepare(sql).run(...params).changes),
    }),
    first: async <T>(sql: string, ...params: (string | number | null)[]) =>
      (native.prepare(sql).get(...params) as T | undefined) ?? null,
    all: async <T>(sql: string, ...params: (string | number | null)[]) =>
      native.prepare(sql).all(...params) as T[],
  };
}
function addVisit(target = account, source = 'gps') {
  const id = randomUUID();
  db.prepare(
    'INSERT INTO visits(id,owner_id,session_id,region_id,started_at,confirmed_at,source) VALUES (?,?,?,?,?,?,?)',
  ).run(id, target.ownerId, randomUUID(), 'A', epoch, epoch + 300000, source);
  return id;
}
async function photo(target = account, createdAt = epoch + 400000) {
  const id = randomUUID(),
    visitId = addVisit(target);
  const file = join(directory, `${id}.png`);
  writeFileSync(file, bytes);
  await target.addPhoto({ id, visitId, uri: `file://${file}`, createdAt });
  return (await target.pendingPhotoOperations()).find((row) => row.entityId === id)!;
}
function acknowledgement(operation: QueuedPhotoOperation): PhotoAcknowledgement {
  const value = JSON.parse(operation.serializedPayload);
  return {
    acknowledgedId: operation.id,
    photo: {
      ...fingerprint,
      id: value.id,
      visitId: value.visitId,
      createdAt: value.createdAt,
      revision: 7,
      originalPath: `/api/visit-photos/${value.id}/original`,
      thumbnailPath: `/api/visit-photos/${value.id}/thumbnail`,
    },
  };
}
function rows(table: string) {
  return db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
}
function state() {
  return Object.fromEntries(
    ['settings', 'visits', 'photos', 'outbox', 'photo_backup_metadata'].map((table) => [
      table,
      rows(table),
    ]),
  );
}
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'trip-painting-photo-storage-'));
  db = new DatabaseSync(join(directory, 'mobile.sqlite'));
  connection = adapter(db);
  account = new Repository(connection, owner);
  await account.initialize(pack, regions);
  await account.activateOwner();
});
afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('account-scoped photo preparation and acknowledgements', () => {
  it('preserves rows, settings, URIs and outbox through repeated initialization and reopen', async () => {
    const operation = await photo();
    const previous = Object.fromEntries(
      ['settings', 'region_packs', 'regions', 'candidates', 'visits', 'photos', 'outbox'].map(
        (table) => [table, rows(table)],
      ),
    );
    await account.initialize(pack, regions);
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 5 });
    for (const [table, records] of Object.entries(previous)) expect(rows(table)).toEqual(records);
    expect(await account.photoBackupState()).toEqual({ pendingPhotos: 1, backedUpPhotos: 0 });
    db.close();
    db = new DatabaseSync(join(directory, 'mobile.sqlite'));
    connection = adapter(db);
    account = new Repository(connection, owner);
    await account.initialize(pack, regions);
    expect(await account.pendingPhotoOperations()).toEqual([operation]);
    for (const [table, records] of Object.entries(previous)) expect(rows(table)).toEqual(records);
    expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
  });
  it('reads photo-only keyset pages without repeating equal-time entries or mixing owners', async () => {
    const first = await photo(),
      second = await photo(),
      third = await photo(account, epoch + 500000);
    const other = new Repository(connection, 'account:synthetic-photo:2');
    const guest = new Repository(connection);
    for (const target of [other, guest]) {
      await target.activateOwner();
      await target.addPhoto({
        id: randomUUID(),
        visitId: addVisit(target),
        uri: 'file:///synthetic-other.png',
        createdAt: epoch,
      });
    }
    await account.activateOwner();
    const expected = [first, second].sort((a, b) => a.id.localeCompare(b.id)).concat(third);
    const found: QueuedPhotoOperation[] = [];
    let after: { createdAt: number; id: string } | undefined;
    for (;;) {
      const page = await account.pendingPhotoOperations(1, after);
      if (!page.length) break;
      found.push(page[0]);
      after = { createdAt: page[0].createdAt, id: page[0].id };
    }
    expect(found).toEqual(expected);
    expect(await account.photoBackupState()).toEqual({ pendingPhotos: 3, backedUpPhotos: 0 });
    await expect(guest.pendingPhotoOperations()).rejects.toThrow('현재 로그인한 계정');
    await expect(other.pendingPhotoOperations()).rejects.toThrow('현재 로그인한 계정');
  });
  it.each([0, 101, 1.5, NaN, Infinity])('rejects invalid page limit %s', async (limit) => {
    await expect(account.pendingPhotoOperations(limit)).rejects.toThrow('1~100');
  });
  it.each([-1, NaN, Infinity, Number.MAX_VALUE])(
    'rejects invalid page cursor time %s',
    async (time) => {
      await expect(
        account.pendingPhotoOperations(10, { createdAt: time, id: 'cursor' }),
      ).rejects.toThrow();
    },
  );
  it('persists one immutable fingerprint across response loss/reopen and atomically saves the ACK', async () => {
    const operation = await photo(),
      unrelated = await photo(account, epoch + 500000);
    const originalPhotos = rows('photos'),
      originalVisits = rows('visits'),
      originalSettings = rows('settings');
    expect(await account.preparePhotoOperation(operation, fingerprint)).toBe(true);
    const prepared = rows('photo_backup_metadata');
    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toMatchObject({
      photo_id: operation.entityId,
      owner_id: owner,
      operation_id: operation.id,
      serialized_payload: operation.serializedPayload,
      sha256: fingerprint.sha256,
      byte_length: fingerprint.byteLength,
      mime_type: fingerprint.mimeType,
      revision: null,
      uploaded_at: null,
    });
    db.close();
    db = new DatabaseSync(join(directory, 'mobile.sqlite'));
    connection = adapter(db);
    account = new Repository(connection, owner);
    await account.initialize(pack, regions);
    expect(await account.preparePhotoOperation(operation, fingerprint)).toBe(true);
    expect(rows('photo_backup_metadata')).toEqual(prepared);
    const pending = await account.pendingPhotoOperations();
    expect(pending.find((row) => row.id === operation.id)?.attempts).toBe(2);
    expect(
      await account.acknowledgePhotoOperation(
        operation,
        fingerprint,
        acknowledgement(operation),
        epoch + 900000,
      ),
    ).toBe(true);
    expect(await account.photoBackupState()).toEqual({ pendingPhotos: 1, backedUpPhotos: 1 });
    expect((await account.pendingPhotoOperations()).map((row) => row.id)).toEqual([unrelated.id]);
    expect(rows('photo_backup_metadata')[0]).toMatchObject({
      revision: 7,
      uploaded_at: epoch + 900000,
      original_path: acknowledgement(operation).photo.originalPath,
      thumbnail_path: acknowledgement(operation).photo.thumbnailPath,
    });
    const after = state();
    expect(
      await account.acknowledgePhotoOperation(
        operation,
        fingerprint,
        acknowledgement(operation),
        epoch + 999999,
      ),
    ).toBe(false);
    expect(state()).toEqual(after);
    expect(rows('photos')).toEqual(originalPhotos);
    expect(rows('visits')).toEqual(originalVisits);
    expect(rows('settings')).toEqual(originalSettings);
    expect(readFileSync(new URL(JSON.parse(operation.serializedPayload).uri))).toEqual(bytes);
  });
  it('accepts canonical server UUIDs while preserving uppercase local keys and the original queued payload', async () => {
    const id = 'ABCDEF01-0000-4000-8000-000000000001';
    const parent = addVisit();
    const visitId = parent.toUpperCase();
    db.prepare('UPDATE visits SET id=? WHERE id=?').run(visitId, parent);
    await account.addPhoto({
      id,
      visitId,
      uri: 'file:///synthetic-uppercase.png',
      createdAt: epoch,
    });
    const [operation] = await account.pendingPhotoOperations();
    const originalPhotos = rows('photos');
    const originalVisits = rows('visits');
    await account.preparePhotoOperation(operation, fingerprint);
    const ack = acknowledgement(operation);
    ack.acknowledgedId = operation.id.toLowerCase();
    ack.photo.id = id.toLowerCase();
    ack.photo.visitId = visitId.toLowerCase();
    ack.photo.originalPath = `/api/visit-photos/${id.toLowerCase()}/original`;
    ack.photo.thumbnailPath = `/api/visit-photos/${id.toLowerCase()}/thumbnail`;
    expect(await account.acknowledgePhotoOperation(operation, fingerprint, ack, epoch + 1)).toBe(
      true,
    );
    expect(await account.photoBackupState()).toEqual({ pendingPhotos: 0, backedUpPhotos: 1 });
    expect(rows('photos')).toEqual(originalPhotos);
    expect(rows('visits')).toEqual(originalVisits);
    expect(rows('photo_backup_metadata')).toMatchObject([
      {
        photo_id: id,
        operation_id: operation.id,
        serialized_payload: operation.serializedPayload,
        revision: ack.photo.revision,
        original_path: ack.photo.originalPath,
        thumbnail_path: ack.photo.thumbnailPath,
        uploaded_at: epoch + 1,
      },
    ]);
    expect(
      db
        .prepare('SELECT photo_id FROM photo_backup_metadata WHERE photo_id=?')
        .get(id.toLowerCase()),
    ).toBeUndefined();
  });
  it.each([false, true])(
    'waits for the parent visit ACK with already-prepared=%s',
    async (prepared) => {
      const operation = await photo();
      if (prepared) await account.preparePhotoOperation(operation, fingerprint);
      const parent = JSON.parse(operation.serializedPayload).visitId;
      db.prepare(
        "INSERT INTO outbox(id,owner_id,entity_type,entity_id,operation,payload,created_at) VALUES (?,?,'visit',?,'upsert','{}',?)",
      ).run(randomUUID(), owner, parent, epoch);
      const before = state();
      expect(await account.preparePhotoOperation(operation, fingerprint)).toBe(false);
      expect(
        await account.acknowledgePhotoOperation(
          operation,
          fingerprint,
          acknowledgement(operation),
          epoch,
        ),
      ).toBe(false);
      expect(state()).toEqual(before);
    },
  );
  it('cannot upload or ACK an incorrectly queued development photo', async () => {
    const id = randomUUID();
    const value = {
      id,
      visitId: addVisit(account, 'development'),
      uri: 'file:///development.png',
      createdAt: epoch,
    };
    await account.addPhoto(value);
    db.prepare(
      "INSERT INTO outbox(id,owner_id,entity_type,entity_id,operation,payload,created_at) VALUES (?,?,'photo',?,'upsert',?,?)",
    ).run(id, owner, id, JSON.stringify(value), epoch);
    const [operation] = await account.pendingPhotoOperations();
    const before = state();
    expect(await account.preparePhotoOperation(operation, fingerprint)).toBe(false);
    expect(
      await account.acknowledgePhotoOperation(
        operation,
        fingerprint,
        acknowledgement(operation),
        epoch,
      ),
    ).toBe(false);
    expect(state()).toEqual(before);
  });
  it('keeps malformed current queue payload and refuses ACK before preparation', async () => {
    const operation = await photo();
    const before = state();
    await expect(
      account.acknowledgePhotoOperation(operation, fingerprint, acknowledgement(operation), epoch),
    ).rejects.toThrow('확인한 전송 기록이 없습니다');
    expect(state()).toEqual(before);
    db.prepare('UPDATE outbox SET payload=? WHERE id=?').run('{"id":', operation.id);
    const [malformed] = await account.pendingPhotoOperations();
    const malformedState = state();
    await expect(account.preparePhotoOperation(malformed, fingerprint)).rejects.toThrow(
      '기존 대기 작업을 보존했습니다',
    );
    expect(state()).toEqual(malformedState);
  });
  it.each(['queue payload', 'photo URI', 'photo time', 'parent tombstone', 'parent owner'])(
    'preserves stale queue/data after %s changes',
    async (change) => {
      const operation = await photo();
      await account.preparePhotoOperation(operation, fingerprint);
      const parent = JSON.parse(operation.serializedPayload).visitId;
      if (change === 'queue payload')
        db.prepare('UPDATE outbox SET payload=? WHERE id=?').run('{}', operation.id);
      if (change === 'photo URI')
        db.prepare('UPDATE photos SET uri=? WHERE id=?').run(
          'file:///new-synthetic.png',
          operation.entityId,
        );
      if (change === 'photo time')
        db.prepare('UPDATE photos SET created_at=created_at+1 WHERE id=?').run(operation.entityId);
      if (change === 'parent tombstone')
        db.prepare('UPDATE visits SET deleted_at=? WHERE id=?').run(epoch + 900000, parent);
      if (change === 'parent owner')
        db.prepare('UPDATE visits SET owner_id=? WHERE id=?').run(
          'account:synthetic-photo:2',
          parent,
        );
      const before = state();
      expect(await account.preparePhotoOperation(operation, fingerprint)).toBe(false);
      expect(
        await account.acknowledgePhotoOperation(
          operation,
          fingerprint,
          acknowledgement(operation),
          epoch,
        ),
      ).toBe(false);
      expect(state()).toEqual(before);
    },
  );
  it('rejects changed file bytes on retry and ACK while retaining the first fingerprint', async () => {
    const operation = await photo();
    await account.preparePhotoOperation(operation, fingerprint);
    const before = state();
    const changed = { ...fingerprint, sha256: 'b'.repeat(64) };
    await expect(account.preparePhotoOperation(operation, changed)).rejects.toThrow(
      '첨부본이나 전송 작업이 바뀌었습니다',
    );
    await expect(
      account.acknowledgePhotoOperation(operation, changed, acknowledgement(operation), epoch),
    ).rejects.toThrow('첨부본이나 전송 작업이 바뀌었습니다');
    expect(state()).toEqual(before);
  });
  it('cascades prepared and uploaded metadata on parent deletion without letting a late ACK recreate it', async () => {
    const operation = await photo();
    await account.preparePhotoOperation(operation, fingerprint);
    const other = await photo();
    await account.preparePhotoOperation(other, fingerprint);
    await account.acknowledgePhotoOperation(other, fingerprint, acknowledgement(other), epoch);
    const parent = JSON.parse(operation.serializedPayload).visitId;
    await account.deleteVisit(parent, randomUUID(), epoch + 900000);
    expect(rows('photo_backup_metadata')).toHaveLength(1);
    expect(
      await account.acknowledgePhotoOperation(
        operation,
        fingerprint,
        acknowledgement(operation),
        epoch,
      ),
    ).toBe(false);
    const otherParent = JSON.parse(other.serializedPayload).visitId;
    await account.deleteVisit(otherParent, randomUUID(), epoch + 900000);
    expect(rows('photo_backup_metadata')).toEqual([]);
    expect(await account.photoBackupState()).toEqual({ pendingPhotos: 0, backedUpPhotos: 0 });
    expect(readFileSync(new URL(JSON.parse(operation.serializedPayload).uri))).toEqual(bytes);
    expect(readFileSync(new URL(JSON.parse(other.serializedPayload).uri))).toEqual(bytes);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
  it('rejects old-account and guest responses after an owner change', async () => {
    const operation = await photo();
    await account.preparePhotoOperation(operation, fingerprint);
    const other = new Repository(connection, 'account:synthetic-photo:2');
    const changing = other.activateOwner();
    const stale = account.acknowledgePhotoOperation(
      operation,
      fingerprint,
      acknowledgement(operation),
      epoch,
    );
    await changing;
    const before = state();
    await expect(stale).rejects.toThrow('현재 로그인한 계정');
    await expect(account.preparePhotoOperation(operation, fingerprint)).rejects.toThrow(
      '현재 로그인한 계정',
    );
    await expect(
      new Repository(connection).preparePhotoOperation(operation, fingerprint),
    ).rejects.toThrow('현재 로그인한 계정');
    expect(state()).toEqual(before);
    expect(await other.photoBackupState()).toEqual({ pendingPhotos: 0, backedUpPhotos: 0 });
  });
  it.each([
    'acknowledgedId',
    'id',
    'visitId',
    'createdAt',
    'sha256',
    'byteLength',
    'mimeType',
    'revision',
    'originalPath',
    'thumbnailPath',
  ])('rejects a mismatched server %s without removing the photo operation', async (field) => {
    const operation = await photo();
    await account.preparePhotoOperation(operation, fingerprint);
    const ack = acknowledgement(operation);
    if (field === 'acknowledgedId') ack.acknowledgedId = randomUUID();
    else
      Object.assign(ack.photo, {
        [field]: typeof ack.photo[field as keyof typeof ack.photo] === 'number' ? -1 : 'mismatched',
      });
    const before = state();
    await expect(
      account.acknowledgePhotoOperation(operation, fingerprint, ack, epoch),
    ).rejects.toThrow('서버가 확인한 사진');
    expect(state()).toEqual(before);
  });
  for (const action of ['prepare', 'acknowledge'] as const)
    it.each(['begin', 'photo read', 'metadata write', 'outbox write'])(
      `${action} rolls back when the captured token/foreground changes during %s`,
      async (stage) => {
        const operation = await photo();
        if (action === 'acknowledge') await account.preparePhotoOperation(operation, fingerprint);
        const before = state();
        let current = true;
        const guarded = new Repository(
          {
            ...connection,
            exec: async (sql) => {
              await connection.exec(sql);
              if (stage === 'begin' && sql === 'BEGIN IMMEDIATE') current = false;
            },
            first: async <T>(sql: string, ...params: (string | number | null)[]) => {
              const result = await connection.first<T>(sql, ...params);
              if (stage === 'photo read' && sql.startsWith('SELECT p.id')) current = false;
              return result;
            },
            run: async (sql, ...params) => {
              const result = await connection.run(sql, ...params);
              if (
                (stage === 'metadata write' &&
                  /^(INSERT INTO|UPDATE) photo_backup_metadata/.test(sql)) ||
                (stage === 'outbox write' && /^(UPDATE|DELETE FROM) outbox/.test(sql))
              )
                current = false;
              return result;
            },
          },
          owner,
        );
        const request =
          action === 'prepare'
            ? guarded.preparePhotoOperation(operation, fingerprint, () => current)
            : guarded.acknowledgePhotoOperation(
                operation,
                fingerprint,
                acknowledgement(operation),
                epoch,
                () => current,
              );
        await expect(request).rejects.toThrow('로그인 정보나 화면 상태가 바뀌어');
        expect(state()).toEqual(before);
        expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      },
    );
  it('rolls back saved remote metadata when the exact queue row cannot be deleted', async () => {
    const operation = await photo();
    await account.preparePhotoOperation(operation, fingerprint);
    db.exec(
      "CREATE TRIGGER preserve_photo_queue BEFORE DELETE ON outbox WHEN OLD.entity_type='photo' BEGIN SELECT RAISE(IGNORE); END;",
    );
    const before = state();
    expect(
      await account.acknowledgePhotoOperation(
        operation,
        fingerprint,
        acknowledgement(operation),
        epoch,
      ),
    ).toBe(false);
    expect(state()).toEqual(before);
  });
  it('rolls back a new fingerprint when attempt storage fails after its SQL update', async () => {
    const operation = await photo();
    const before = state();
    const failing = new Repository(
      {
        ...connection,
        run: async (sql, ...params) => {
          const result = await connection.run(sql, ...params);
          if (sql.startsWith('UPDATE outbox')) throw new Error('synthetic attempt failure');
          return result;
        },
      },
      owner,
    );
    await expect(failing.preparePhotoOperation(operation, fingerprint)).rejects.toThrow(
      'synthetic attempt failure',
    );
    expect(state()).toEqual(before);
  });
  it('rolls back a new fingerprint when the exact attempt row cannot be updated', async () => {
    const operation = await photo();
    db.exec(
      "CREATE TRIGGER preserve_photo_attempt BEFORE UPDATE ON outbox WHEN OLD.entity_type='photo' BEGIN SELECT RAISE(IGNORE); END;",
    );
    const before = state();
    expect(await account.preparePhotoOperation(operation, fingerprint)).toBe(false);
    expect(state()).toEqual(before);
  });
  it.each([
    { ...fingerprint, sha256: 'invalid' },
    { ...fingerprint, byteLength: 0 },
    { ...fingerprint, byteLength: 10485761 },
    { ...fingerprint, mimeType: 'image/heic' },
  ])('rejects invalid attachment metadata %j without touching records', async (value) => {
    const operation = await photo();
    const before = state();
    await expect(
      account.preparePhotoOperation(operation, value as PhotoFingerprint),
    ).rejects.toThrow('형식·크기·해시');
    expect(state()).toEqual(before);
  });
});
