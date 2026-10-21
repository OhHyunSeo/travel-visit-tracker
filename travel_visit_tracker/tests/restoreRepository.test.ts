import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Repository } from '../src/storage/repository';
import { remotePhoto, remoteVisit, visitPage, photoPage } from '../src/storage/restore';
import {
  adapter,
  epoch,
  fixture,
  owner,
  pack,
  regions,
  visit,
  photo,
  page,
} from './restoreFixture';
let f: Awaited<ReturnType<typeof fixture>>;
const current = () => true;
beforeEach(async () => {
  f = await fixture();
});
afterEach(() => f.close());
async function queue(v = visit(), p = photo(v)) {
  await f.repo.restoration.saveVisits(0, page([v]), current);
  await f.repo.restoration.applyVisits(current);
  await f.repo.restoration.savePhotos(0, page([p]), current);
  return { v, p };
}
const uri = () => `visit-photos/restored-${randomUUID()}.png`;
describe('restoration data preservation and queues', () => {
  it('adds v4 tables to a frozen v3 database without changing any existing rows', async () => {
    const old = new DatabaseSync(':memory:');
    old.exec(readFileSync(new URL('./fixtures/schema-v3.sql', import.meta.url), 'utf8'));
    old.prepare('INSERT INTO region_packs VALUES (?,?,?)').run(pack.id, pack.version, pack.count);
    old.prepare('INSERT INTO regions VALUES (?,?,?)').run('A', pack.id, 'Synthetic A');
    const v = visit(),
      p = photo(v);
    for (const who of ['guest', owner, 'account:synthetic:other']) {
      old.prepare('INSERT INTO settings VALUES (?,?)').run(`${who}:synthetic`, 'preserved');
      old
        .prepare('INSERT INTO visits VALUES (?,?,?,?,?,?,?,?)')
        .run(v.id, who, v.sessionId, 'A', v.startedAt, v.confirmedAt, 'gps', null);
      old
        .prepare('INSERT INTO photos VALUES (?,?,?,?,?)')
        .run(p.id, who, v.id, 'visit-photos/existing.png', p.createdAt);
      old
        .prepare('INSERT INTO outbox VALUES (?,?,?,?,?,?,?,?)')
        .run('same-operation', who, 'photo', p.id, 'upsert', 'exact payload', epoch, 3);
    }
    const tables = [
      'settings',
      'visits',
      'photos',
      'outbox',
      'photo_backup_metadata',
      'region_packs',
      'regions',
      'candidates',
    ];
    const before = tables.map((t) => old.prepare(`SELECT * FROM ${t}`).all());
    await new Repository(adapter(old), owner).initialize(pack, regions);
    expect(tables.map((t) => old.prepare(`SELECT * FROM ${t}`).all())).toEqual(before);
    expect(old.prepare('PRAGMA user_version').get()).toEqual({ user_version: 4 });
    expect(old.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    old.close();
  });
  it('rolls back v3 migration on failure and leaves original tables and version intact', async () => {
    const old = new DatabaseSync(':memory:');
    old.exec(readFileSync(new URL('./fixtures/schema-v3.sql', import.meta.url), 'utf8'));
    const connection = adapter(old),
      exec = connection.exec;
    connection.exec = async (sql) => {
      await exec(sql);
      if (sql.includes('CREATE TABLE IF NOT EXISTS restore_photos')) throw Error('disk full');
    };
    const before = old.prepare('SELECT * FROM sqlite_master ORDER BY name').all();
    await expect(new Repository(connection, owner).initialize(pack, regions)).rejects.toThrow(
      'disk full',
    );
    expect(old.prepare('SELECT * FROM sqlite_master ORDER BY name').all()).toEqual(before);
    expect(old.prepare('PRAGMA user_version').get()).toEqual({ user_version: 3 });
    old.close();
  });
  it('commits a validated page with its cursor and preserves both after reopen', async () => {
    const v = visit();
    await f.repo.restoration.saveVisits(0, page([v]), current);
    const reopened = new DatabaseSync(f.path);
    const r = new Repository(adapter(reopened), owner);
    expect(await r.restoration.state()).toMatchObject({ visitCursor: 1, pendingVisits: 1 });
    await r.restoration.applyVisits(current);
    expect((await r.snapshot(false)).visits.map((x) => x.id)).toEqual([v.id]);
    expect(f.db.prepare('SELECT * FROM outbox').all()).toEqual([]);
    reopened.close();
  });
  it('rolls back the entire page and cursor when account guard changes inside SQL', async () => {
    let active = true;
    const run = f.connection.run;
    vi.spyOn(f.connection, 'run').mockImplementation(async (sql, ...p) => {
      const r = await run(sql, ...p);
      if (sql.includes('INSERT INTO restore_visits')) active = false;
      return r;
    });
    await expect(f.repo.restoration.saveVisits(0, page([visit()]), () => active)).rejects.toThrow();
    expect(await f.repo.restoration.state()).toMatchObject({ visitCursor: 0, pendingVisits: 0 });
  });
  it('rejects stale cursors, malformed pages and a changed immutable server record atomically', async () => {
    const v = visit();
    await f.repo.restoration.saveVisits(0, page([v]), current);
    await expect(f.repo.restoration.saveVisits(0, page([visit()]), current)).rejects.toThrow();
    await expect(
      f.repo.restoration.saveVisits(1, page([{ ...v, regionId: 'B', revision: 2 }]), current),
    ).rejects.toThrow();
    expect(await f.repo.restoration.state()).toMatchObject({ visitCursor: 1, pendingVisits: 1 });
  });
  it('never resurrects a server tombstone', async () => {
    const v = visit({ deletedAt: epoch + 500000 });
    await f.repo.restoration.saveVisits(0, page([v]), current);
    await expect(
      f.repo.restoration.saveVisits(1, page([{ ...v, revision: 2, deletedAt: null }]), current),
    ).rejects.toThrow();
  });
  it('restores same UUIDs independently for two accounts and rejects inactive writes', async () => {
    const { v, p } = await queue();
    const first = uri();
    expect(await f.repo.restoration.completePhoto(p, first, current)).toBe(true);
    const other = new Repository(f.connection, 'account:synthetic:other');
    await other.activateOwner();
    await expect(f.repo.restoration.saveVisits(1, page([]), current)).rejects.toThrow();
    await other.restoration.saveVisits(0, page([v]), current);
    await other.restoration.applyVisits(current);
    await other.restoration.savePhotos(0, page([p]), current);
    expect(await other.restoration.completePhoto(p, uri(), current)).toBe(true);
    expect(f.db.prepare('SELECT * FROM photos').all()).toHaveLength(2);
    expect(await other.restoration.fileReferenced(first)).toBe(true);
  });
  it('keeps unknown region visits pending without inventing a boundary', async () => {
    await f.repo.restoration.saveVisits(0, page([visit({ regionId: 'not-bundled' })]), current);
    await f.repo.restoration.applyVisits(current);
    expect(await f.repo.restoration.state()).toMatchObject({ blocked: 1, pendingVisits: 1 });
    expect((await f.repo.snapshot(false)).visits).toHaveLength(0);
  });
  it('protects unsent visits, child photos, local deletion, and development rows', async () => {
    const variants = ['outbox', 'child', 'deleted', 'development'];
    const records = variants.map((_, i) => visit({ revision: i + 1 }));
    for (const [i, v] of records.entries()) {
      f.db
        .prepare('INSERT INTO visits VALUES (?,?,?,?,?,?,?,?)')
        .run(
          v.id,
          owner,
          v.sessionId,
          'A',
          v.startedAt,
          v.confirmedAt,
          i === 3 ? 'development' : 'gps',
          i === 2 ? epoch + 500000 : null,
        );
      if (i === 0)
        f.db
          .prepare('INSERT INTO outbox VALUES (?,?,?,?,?,?,?,?)')
          .run('pending', owner, 'visit', v.id, 'upsert', 'unchanged', epoch, 2);
      if (i === 1)
        await f.repo.addPhoto({
          id: randomUUID(),
          visitId: v.id,
          uri: 'visit-photos/unsent.png',
          createdAt: epoch,
        });
    }
    const before = f.db.prepare('SELECT * FROM visits').all();
    const outbox = f.db.prepare('SELECT * FROM outbox').all();
    await f.repo.restoration.saveVisits(0, page(records), current);
    await f.repo.restoration.applyVisits(current);
    expect(await f.repo.restoration.state()).toMatchObject({ blocked: 4 });
    expect(f.db.prepare('SELECT * FROM visits').all()).toEqual(before);
    expect(f.db.prepare('SELECT * FROM outbox').all()).toEqual(outbox);
  });
  it('reflects deletion by hiding the visit while retaining attachment paths and queue history', async () => {
    const { v, p } = await queue();
    const file = uri();
    await f.repo.restoration.completePhoto(p, file, current);
    await f.repo.restoration.saveVisits(
      1,
      page([{ ...v, deletedAt: epoch + 500000, revision: 2 }]),
      current,
    );
    await f.repo.restoration.applyVisits(current);
    expect((await f.repo.snapshot(false)).visits).toHaveLength(0);
    expect(f.db.prepare('SELECT uri FROM photos').all()).toEqual([{ uri: file }]);
    expect(await f.repo.photoBackupState()).toEqual({ pendingPhotos: 0, backedUpPhotos: 0 });
  });
  it('waits for the owned parent, and deleted parents never download', async () => {
    const v = visit(),
      p = photo(v);
    await f.repo.restoration.savePhotos(0, page([p]), current);
    expect(await f.repo.restoration.photoDisposition(p, current)).toMatchObject({
      kind: 'blocked',
    });
    await f.repo.restoration.saveVisits(
      0,
      page([
        {
          ...v,
          sessionId: null,
          regionId: null,
          startedAt: null,
          confirmedAt: null,
          source: null,
          deletedAt: epoch,
        },
      ]),
      current,
    );
    expect(await f.repo.restoration.photoDisposition(p, current)).toMatchObject({
      kind: 'deleted',
    });
    expect(await f.repo.restoration.nextPhotos()).toEqual([]);
  });
  it('keeps an existing local photo and never labels unverified bytes as a download', async () => {
    const { v, p } = await queue();
    f.db
      .prepare('INSERT INTO photos VALUES (?,?,?,?,?)')
      .run(p.id, owner, v.id, 'visit-photos/preserve.png', p.createdAt);
    expect(await f.repo.restoration.photoDisposition(p, current)).toMatchObject({
      kind: 'existing',
    });
    expect(await f.repo.restoration.completePhoto(p, uri(), current)).toBe(false);
    expect(f.db.prepare('SELECT uri FROM photos').get()).toEqual({
      uri: 'visit-photos/preserve.png',
    });
    expect(await f.repo.photoBackupState()).toEqual({ pendingPhotos: 0, backedUpPhotos: 0 });
  });
  it('registers the photo and cursor atomically, without upload operations or fake ACKs', async () => {
    const { p } = await queue();
    const file = uri();
    expect(await f.repo.restoration.completePhoto(p, file, current)).toBe(true);
    expect(await f.repo.photoBackupState()).toEqual({ pendingPhotos: 0, backedUpPhotos: 1 });
    expect(f.db.prepare('SELECT * FROM outbox').all()).toEqual([]);
    expect(f.db.prepare('SELECT * FROM photo_backup_metadata').all()).toEqual([]);
    expect(await f.repo.restoration.state()).toMatchObject({
      photoScan: p.revision,
      pendingPhotos: 0,
    });
  });
  it('rolls back photo registration on a changed guard then permits a later retry', async () => {
    const { p } = await queue();
    const run = f.connection.run;
    let active = true;
    const spy = vi.spyOn(f.connection, 'run').mockImplementation(async (sql, ...params) => {
      const r = await run(sql, ...params);
      if (sql.startsWith('INSERT INTO photos')) active = false;
      return r;
    });
    await expect(f.repo.restoration.completePhoto(p, uri(), () => active)).rejects.toThrow();
    spy.mockRestore();
    expect(f.db.prepare('SELECT * FROM photos').all()).toHaveLength(0);
    expect(await f.repo.restoration.state()).toMatchObject({ photoScan: 0, pendingPhotos: 1 });
    expect(await f.repo.restoration.completePhoto(p, uri(), current)).toBe(true);
  });
  it('rechecks parent/local changes at file registration time', async () => {
    const { v, p } = await queue();
    expect(await f.repo.restoration.photoDisposition(p, current)).toMatchObject({
      kind: 'download',
    });
    await f.repo.addPhoto({
      id: randomUUID(),
      visitId: v.id,
      uri: 'visit-photos/new-local.png',
      createdAt: epoch,
    });
    expect(await f.repo.restoration.completePhoto(p, uri(), current)).toBe(false);
    expect(f.db.prepare('SELECT uri FROM photos').all()).toEqual([
      { uri: 'visit-photos/new-local.png' },
    ]);
  });
});
describe('remote response validation', () => {
  it.each(['../../private', 'https://other.test/private', '/api/visit-photos/other/original'])(
    'rejects unsafe download paths %s',
    (path) => {
      expect(() => remotePhoto({ ...photo(visit()), originalPath: path })).toThrow();
    },
  );
  it('rejects invalid active/tombstone records, revisions, oversized files and nonmonotonic pages', () => {
    const v = visit(),
      p = photo(v);
    for (const invalid of [
      { ...v, confirmedAt: epoch + 1 },
      { ...v, id: v.id.toUpperCase() },
      { ...v, revision: 0 },
      { ...v, sessionId: null },
    ])
      expect(() => remoteVisit(invalid)).toThrow();
    for (const invalid of [
      { ...p, byteLength: 10485761 },
      { ...p, mimeType: 'image/heic' },
      { ...p, sha256: 'a' },
      { ...p, revision: Infinity },
    ])
      expect(() => remotePhoto(invalid)).toThrow();
    expect(() => visitPage({ visits: [v], cursor: 2, hasMore: false }, 0)).toThrow();
    expect(() => visitPage({ visits: [v], cursor: 1, hasMore: true }, 0)).toThrow();
    expect(() => photoPage({ photos: [p, p], cursor: 1, hasMore: false }, 0)).toThrow();
  });
});
