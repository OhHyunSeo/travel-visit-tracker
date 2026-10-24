import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Repository, type SqlConnection } from '../src/storage/repository';
import type { PhotoAcknowledgement, PhotoFingerprint } from '../src/storage/outbox';

const legacyV2 = readFileSync(new URL('./fixtures/schema-v2.sql', import.meta.url), 'utf8');
const pack = { id: 'synthetic', version: 'old', count: 1 };
const regions = [{ id: 'A', name: 'Synthetic A' }];
const owner = 'account:synthetic:A';
const otherOwner = 'account:synthetic:B';
const epoch = 1700000000000.25;
const visitId = '00000000-0000-4000-8000-000000000001';
const photoId = '00000000-0000-4000-8000-000000000002';
const deletionId = '00000000-0000-4000-8000-000000000003';
const bytes = Buffer.from('synthetic durable attachment, never replaced by a migration');
const fingerprint: PhotoFingerprint = {
  sha256: createHash('sha256').update(bytes).digest('hex'),
  byteLength: bytes.length,
  mimeType: 'image/png',
};
let directory: string, db: DatabaseSync, connection: SqlConnection;
function adapter(database: DatabaseSync): SqlConnection {
  return {
    exec: async (sql) => database.exec(sql),
    run: async (sql, ...params) => ({
      changes: Number(database.prepare(sql).run(...params).changes),
    }),
    first: async <T>(sql: string, ...params: (string | number | null)[]) =>
      (database.prepare(sql).get(...params) as T | undefined) ?? null,
    all: async <T>(sql: string, ...params: (string | number | null)[]) =>
      database.prepare(sql).all(...params) as T[],
  };
}
function rows(table: string) {
  return db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
}
function stored() {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as { name: string }[];
  return Object.fromEntries(tables.map(({ name }) => [name, rows(name)]));
}
function definition() {
  return db
    .prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name")
    .all();
}
function seedLegacy(version: 1 | 2) {
  db.exec(
    version === 2
      ? legacyV2
      : legacyV2.split('CREATE TABLE IF NOT EXISTS photo_backup_metadata')[0] +
          'PRAGMA user_version=1;',
  );
  db.prepare('INSERT INTO region_packs VALUES (?,?,?)').run(pack.id, pack.version, pack.count);
  db.prepare('INSERT INTO regions VALUES (?,?,?)').run('A', pack.id, regions[0].name);
  db.prepare('INSERT INTO settings VALUES (?,?)').run('active_owner', JSON.stringify(owner));
  for (const [index, account] of ['guest', owner, otherOwner].entries()) {
    db.prepare('INSERT INTO settings VALUES (?,?)').run(`${account}:recording`, 'false');
    db.prepare('INSERT INTO settings VALUES (?,?)').run(`${account}:visitBackupEnabled`, 'true');
    db.prepare('INSERT INTO settings VALUES (?,?)').run(
      `${account}:visitBackupNextAttemptAt`,
      `${epoch + index}`,
    );
    db.prepare('INSERT INTO candidates VALUES (?,?,?,?,?,?)').run(
      account,
      `candidate-${index}`,
      'A',
      epoch,
      epoch + 120000,
      null,
    );
    for (const [kind, source, deleted] of [
      ['live', 'gps', null],
      ['deleted', 'gps', epoch + 600000],
      ['dev', 'development', null],
    ] as const) {
      const id = `${index}-${kind}`;
      db.prepare('INSERT INTO visits VALUES (?,?,?,?,?,?,?,?)').run(
        id,
        account,
        kind,
        'A',
        epoch,
        epoch + 300000,
        source,
        deleted,
      );
    }
    const uri = `file://${join(directory, `${index}.png`)}`;
    writeFileSync(join(directory, `${index}.png`), bytes);
    db.prepare('INSERT INTO photos VALUES (?,?,?,?,?)').run(
      `photo-${index}`,
      account,
      `${index}-live`,
      uri,
      epoch + 400000,
    );
    db.prepare('INSERT INTO outbox VALUES (?,?,?,?,?,?,?,?)').run(
      `operation-${index}`,
      account,
      'photo',
      `photo-${index}`,
      'upsert',
      JSON.stringify({
        id: `photo-${index}`,
        visitId: `${index}-live`,
        uri,
        createdAt: epoch + 400000,
      }),
      epoch + 400000,
      index + 2,
    );
    db.prepare('INSERT INTO outbox VALUES (?,?,?,?,?,?,?,?)').run(
      `deletion-${index}`,
      account,
      'visit',
      `${index}-deleted`,
      'delete',
      JSON.stringify({ id: `${index}-deleted`, deletedAt: epoch + 600000 }),
      epoch + 600000,
      7,
    );
    if (version === 2)
      db.prepare('INSERT INTO photo_backup_metadata VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
        `photo-${index}`,
        account,
        `operation-${index}`,
        `frozen-${index}`,
        fingerprint.sha256,
        bytes.length,
        'image/png',
        index === 1 ? null : index + 1,
        index === 1 ? null : `/synthetic/${index}/original`,
        index === 1 ? null : `/synthetic/${index}/thumbnail`,
        index === 1 ? null : epoch + 700000,
      );
  }
}
function reopen() {
  db.close();
  db = new DatabaseSync(join(directory, 'synthetic.sqlite'));
  connection = adapter(db);
}
async function initialize(target = connection) {
  await new Repository(target, owner).initialize(pack, regions);
}
function insertVisit(account: string, id = visitId, sessionId = id) {
  db.prepare(
    'INSERT INTO visits(id,owner_id,session_id,region_id,started_at,confirmed_at,source) VALUES (?,?,?,?,?,?,?)',
  ).run(id, account, sessionId, 'A', epoch, epoch + 300000, 'gps');
}
async function addSameIds(account: string) {
  const repository = new Repository(connection, account);
  await repository.activateOwner();
  insertVisit(account);
  db.prepare(
    'INSERT INTO outbox(id,owner_id,entity_type,entity_id,operation,payload,created_at) VALUES (?,?,?,?,?,?,?)',
  ).run(visitId, account, 'visit', visitId, 'upsert', JSON.stringify({ account }), epoch);
  await repository.addPhoto({
    id: photoId,
    visitId,
    uri: `file:///synthetic/${account}.png`,
    createdAt: epoch + 400000,
  });
  return repository;
}
function ack(): PhotoAcknowledgement {
  return {
    acknowledgedId: photoId,
    photo: {
      ...fingerprint,
      id: photoId,
      visitId,
      createdAt: epoch + 400000,
      revision: 1,
      originalPath: `/api/visit-photos/${photoId}/original`,
      thumbnailPath: `/api/visit-photos/${photoId}/thumbnail`,
    },
  };
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'trip-painting-migration-'));
  db = new DatabaseSync(join(directory, 'synthetic.sqlite'));
  connection = adapter(db);
});
afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('atomic owner and UUID migration', () => {
  it.each([1, 2] as const)(
    'preserves every v%i row, URI, fractional time, attempt and setting through migration and reopen',
    async (version) => {
      seedLegacy(version);
      const before = stored();
      const files = [0, 1, 2].map((i) => readFileSync(join(directory, `${i}.png`)));
      await initialize();
      expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 5 });
      for (const [table, records] of Object.entries(before)) expect(rows(table)).toEqual(records);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      reopen();
      await initialize();
      for (const [table, records] of Object.entries(before)) expect(rows(table)).toEqual(records);
      expect([0, 1, 2].map((i) => readFileSync(join(directory, `${i}.png`)))).toEqual(files);
      expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    },
  );
  it.each([
    'CREATE TABLE IF NOT EXISTS visits_v3',
    'INSERT INTO photos_v3',
    'INSERT INTO photo_backup_metadata_v3',
    'DROP TABLE photos;',
    'ALTER TABLE visits_v3',
    'PRAGMA user_version = 5',
    'COMMIT',
  ])('rolls back all rows and schema when failure follows %s', async (stage) => {
    seedLegacy(2);
    const before = stored(),
      schema = definition();
    let failed = false;
    await expect(
      initialize({
        ...connection,
        exec: async (sql) => {
          if (!failed && sql.includes(stage)) {
            failed = true;
            if (stage !== 'COMMIT') await connection.exec(sql);
            throw new Error('synthetic disk interruption');
          }
          await connection.exec(sql);
        },
      }),
    ).rejects.toThrow('synthetic disk interruption');
    expect(failed).toBe(true);
    expect(stored()).toEqual(before);
    expect(definition()).toEqual(schema);
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 });
    reopen();
    await initialize();
    for (const [table, records] of Object.entries(before)) expect(rows(table)).toEqual(records);
  });
  it('rolls back the schema and version when region initialization fails after the migration', async () => {
    seedLegacy(1);
    const before = stored(),
      schema = definition();
    await expect(
      initialize({
        ...connection,
        run: async (sql, ...params) => {
          if (sql.includes('INSERT INTO regions')) throw new Error('synthetic pack failure');
          return connection.run(sql, ...params);
        },
      }),
    ).rejects.toThrow('synthetic pack failure');
    expect(stored()).toEqual(before);
    expect(definition()).toEqual(schema);
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 });
  });
  it.each(['photos', 'photo_backup_metadata'])(
    'preserves legacy records with a mismatched %s owner rather than guessing ownership',
    async (table) => {
      seedLegacy(2);
      db.prepare(`UPDATE ${table} SET owner_id=? WHERE owner_id='guest'`).run('unexpected-owner');
      const before = stored(),
        schema = definition();
      await expect(initialize()).rejects.toThrow();
      expect(stored()).toEqual(before);
      expect(definition()).toEqual(schema);
      expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 });
    },
  );
  it('serializes simultaneous migration attempts and the following write on one connection', async () => {
    seedLegacy(2);
    const a = new Repository(connection, owner),
      b = new Repository(connection, otherOwner);
    await Promise.all([
      a.initialize(pack, regions),
      b.initialize(pack, regions),
      a.developmentVisit('A', 'after-migration', epoch),
    ]);
    expect(
      db.prepare("SELECT count(*) AS count FROM visits WHERE id='after-migration'").get(),
    ).toEqual({ count: 1 });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
  it('does not relabel an unversioned populated database or a future schema', async () => {
    seedLegacy(2);
    const before = stored(),
      schema = definition();
    for (const version of [-1, 0, 99]) {
      db.exec(`PRAGMA user_version=${version}`);
      await expect(initialize()).rejects.toThrow();
      expect(stored()).toEqual(before);
      expect(definition()).toEqual(schema);
      expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: version });
    }
  });
  it('preserves unexpected intermediate tables instead of reusing or deleting them', async () => {
    seedLegacy(2);
    db.exec("CREATE TABLE visits_v3(note TEXT); INSERT INTO visits_v3 VALUES ('preserve me');");
    const before = stored(),
      schema = definition();
    await expect(initialize()).rejects.toThrow('기존 기록을 보존');
    expect(stored()).toEqual(before);
    expect(definition()).toEqual(schema);
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 });
  });
});

describe('same UUID in separate owners', () => {
  beforeEach(async () => initialize());
  it('keeps visits, photos, frozen fingerprints, attempts and ACKs independent', async () => {
    const a = await addSameIds(owner),
      b = await addSameIds(otherOwner);
    expect((await a.snapshot(false)).photos[0].uri).toBe(`file:///synthetic/${owner}.png`);
    expect((await b.snapshot(false)).photos[0].uri).toBe(`file:///synthetic/${otherOwner}.png`);
    const different = { ...fingerprint, sha256: 'b'.repeat(64) };
    for (const [repository, hash] of [
      [a, fingerprint],
      [b, different],
    ] as const) {
      await repository.activateOwner();
      const operations = await repository.pendingVisitOperations();
      await repository.noteVisitAttempt(operations);
      await repository.acknowledgeVisitOperations(operations, [visitId]);
      const operation = (await repository.pendingPhotoOperations())[0];
      expect(await repository.preparePhotoOperation(operation, hash)).toBe(true);
    }
    await a.activateOwner();
    const operation = (await a.pendingPhotoOperations())[0];
    expect(await a.acknowledgePhotoOperation(operation, fingerprint, ack(), epoch + 500000)).toBe(
      true,
    );
    expect(await a.photoBackupState()).toEqual({ pendingPhotos: 0, backedUpPhotos: 1 });
    expect(await b.photoBackupState()).toEqual({ pendingPhotos: 1, backedUpPhotos: 0 });
    expect(
      db.prepare('SELECT attempts FROM outbox WHERE owner_id=? AND id=?').get(otherOwner, photoId),
    ).toEqual({ attempts: 1 });
    expect(
      db
        .prepare(
          'SELECT sha256,uploaded_at FROM photo_backup_metadata WHERE owner_id=? AND photo_id=?',
        )
        .get(otherOwner, photoId),
    ).toEqual({ sha256: different.sha256, uploaded_at: null });
  });
  it('deletes only the selected owner child rows and metadata, including physical FK cascade', async () => {
    const a = await addSameIds(owner),
      b = await addSameIds(otherOwner);
    const beforeB = await b.snapshot(false);
    for (const repository of [a, b]) {
      await repository.activateOwner();
      const visits = await repository.pendingVisitOperations();
      await repository.acknowledgeVisitOperations(visits, [visitId]);
      await repository.preparePhotoOperation(
        (await repository.pendingPhotoOperations())[0],
        fingerprint,
      );
    }
    const bRows = db
      .prepare('SELECT * FROM photo_backup_metadata WHERE owner_id=?')
      .all(otherOwner);
    expect(await a.deleteVisit(visitId, deletionId, epoch + 500000)).toEqual([
      `file:///synthetic/${owner}.png`,
    ]);
    expect((await b.snapshot(false)).visits).toEqual(beforeB.visits);
    expect((await b.snapshot(false)).photos).toEqual(beforeB.photos);
    expect(
      db.prepare('SELECT * FROM photo_backup_metadata WHERE owner_id=?').all(otherOwner),
    ).toEqual(bRows);
    db.prepare('DELETE FROM visits WHERE owner_id=? AND id=?').run(otherOwner, visitId);
    expect(db.prepare('SELECT * FROM photos WHERE owner_id=?').all(otherOwner)).toEqual([]);
    expect(
      db.prepare('SELECT * FROM photo_backup_metadata WHERE owner_id=?').all(otherOwner),
    ).toEqual([]);
    expect(db.prepare('SELECT * FROM outbox WHERE owner_id=?').all(otherOwner)).toHaveLength(1);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
  it('rejects a child or metadata link to another owner at the SQLite constraint', async () => {
    insertVisit(owner);
    expect(() =>
      db
        .prepare('INSERT INTO photos VALUES (?,?,?,?,?)')
        .run(photoId, otherOwner, visitId, 'file:///other.png', epoch),
    ).toThrow();
    db.prepare('INSERT INTO photos VALUES (?,?,?,?,?)').run(
      photoId,
      owner,
      visitId,
      'file:///owner.png',
      epoch,
    );
    expect(() =>
      db
        .prepare(
          'INSERT INTO photo_backup_metadata(photo_id,owner_id,operation_id,serialized_payload,sha256,byte_length,mime_type) VALUES (?,?,?,?,?,?,?)',
        )
        .run(photoId, otherOwner, photoId, '{}', fingerprint.sha256, bytes.length, 'image/png'),
    ).toThrow();
  });
  it('moves guest photo metadata with the parent while keeping other owners and development rows intact', async () => {
    const guest = await addSameIds('guest');
    db.prepare(
      'INSERT INTO photo_backup_metadata(photo_id,owner_id,operation_id,serialized_payload,sha256,byte_length,mime_type) VALUES (?,?,?,?,?,?,?)',
    ).run(photoId, 'guest', photoId, 'frozen bytes', fingerprint.sha256, bytes.length, 'image/png');
    await guest.developmentVisit('A', 'development', epoch);
    await guest.addPhoto({
      id: 'development-photo',
      visitId: 'development',
      uri: 'file:///development.png',
      createdAt: epoch,
    });
    const other = await addSameIds(otherOwner);
    const beforeOther = await other.snapshot(false);
    const a = new Repository(connection, owner);
    await a.activateOwner();
    expect(await a.importGuestRecords()).toEqual({ visits: 1, photos: 1 });
    expect((await a.snapshot(false)).photos[0].uri).toBe('file:///synthetic/guest.png');
    expect(
      db
        .prepare('SELECT owner_id,serialized_payload FROM photo_backup_metadata WHERE owner_id=?')
        .get(owner),
    ).toEqual({ owner_id: owner, serialized_payload: 'frozen bytes' });
    expect(db.prepare("SELECT * FROM photo_backup_metadata WHERE owner_id='guest'").all()).toEqual(
      [],
    );
    expect((await guest.snapshot(true)).photos.map((p) => p.id)).toEqual(['development-photo']);
    expect(await other.snapshot(false)).toEqual(beforeOther);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
  it.each(['visit', 'session', 'photo', 'operation'])(
    'preserves both complete owners when guest import has a conflicting %s',
    async (kind) => {
      await addSameIds('guest');
      const a = new Repository(connection, owner);
      await a.activateOwner();
      const otherVisitId = kind === 'visit' ? visitId : 'other-visit';
      insertVisit(owner, otherVisitId, kind === 'session' ? visitId : 'other-session');
      if (kind === 'photo')
        await a.addPhoto({
          id: photoId,
          visitId: otherVisitId,
          uri: 'file:///different.png',
          createdAt: epoch,
        });
      if (kind === 'operation')
        db.prepare('INSERT INTO outbox VALUES (?,?,?,?,?,?,?,?)').run(
          photoId,
          owner,
          'visit',
          otherVisitId,
          'delete',
          '{}',
          epoch,
          5,
        );
      const before = stored();
      await expect(a.importGuestRecords()).rejects.toThrow('양쪽 기록을 보존');
      expect(stored()).toEqual(before);
    },
  );
  it('rolls back the outbox, parent, child and metadata together when an import write fails', async () => {
    await addSameIds('guest');
    db.prepare(
      'INSERT INTO photo_backup_metadata(photo_id,owner_id,operation_id,serialized_payload,sha256,byte_length,mime_type) VALUES (?,?,?,?,?,?,?)',
    ).run(photoId, 'guest', photoId, 'frozen bytes', fingerprint.sha256, bytes.length, 'image/png');
    const a = new Repository(connection, owner);
    await a.activateOwner();
    db.exec(
      "CREATE TRIGGER fail_import AFTER UPDATE OF owner_id ON visits BEGIN SELECT RAISE(ABORT,'synthetic import failure'); END;",
    );
    const before = stored();
    await expect(a.importGuestRecords()).rejects.toThrow('synthetic import failure');
    expect(stored()).toEqual(before);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
