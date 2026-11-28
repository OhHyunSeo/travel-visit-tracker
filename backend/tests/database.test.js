const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const sqlite3 = require('sqlite3').verbose();
const { openDatabase } = require('../src/database');
const openRaw = (filename) =>
  new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filename, (error) => (error ? reject(error) : resolve(db)));
  });
const execRaw = (db, sql) =>
  new Promise((resolve, reject) => db.exec(sql, (error) => (error ? reject(error) : resolve())));
const getRaw = (db, sql) =>
  new Promise((resolve, reject) =>
    db.get(sql, (error, row) => (error ? reject(error) : resolve(row))),
  );
const allRaw = (db, sql) =>
  new Promise((resolve, reject) =>
    db.all(sql, (error, rows) => (error ? reject(error) : resolve(rows))),
  );
const closeRaw = (db) =>
  new Promise((resolve, reject) => db.close((error) => (error ? reject(error) : resolve())));
it('adds ownership metadata to a legacy database while preserving users, trips and points', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trip-painting-db-migration-'));
  const filename = path.join(dir, 'data.sqlite');
  let db;
  try {
    let raw = await openRaw(filename);
    const schema = await fs.readFile(path.join(__dirname, '../data/schema.sql'), 'utf8');
    const legacy = schema.split('-- Private photo ownership.')[0];
    await execRaw(
      raw,
      legacy +
        "\nINSERT INTO users(id,email,password_hash,username) VALUES (7,'legacy@example.test','existing-hash','Legacy');\nINSERT INTO trips(id,user_id,title) VALUES (8,7,'Existing trip');\nINSERT INTO steps(id,user_id,trip_id,latitude,longitude) VALUES (9,7,8,37,127);",
    );
    const before = {};
    for (const table of ['users', 'trips', 'steps'])
      before[table] = await allRaw(raw, `SELECT * FROM ${table} ORDER BY id`);
    await closeRaw(raw);
    db = await openDatabase(filename);
    for (const [table, rows] of Object.entries(before))
      assert.deepEqual(await db.all(`SELECT * FROM ${table} ORDER BY id`), rows);
    assert.equal((await db.get('SELECT username FROM users WHERE id=7')).username, 'Legacy');
    assert.equal((await db.get('SELECT title FROM trips WHERE id=8')).title, 'Existing trip');
    assert.equal((await db.get('SELECT trip_id FROM steps WHERE id=9')).trip_id, 8);
    assert.equal((await db.get('PRAGMA user_version')).user_version, 3);
    assert.equal((await db.get('PRAGMA foreign_keys')).foreign_keys, 1);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM photos')).count, 0);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM visit_photos')).count, 0);
    assert.deepEqual(await db.all('PRAGMA foreign_key_check'), []);
    await db.close();
    db = null;
    db = await openDatabase(filename);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM users')).count, 1);
  } finally {
    if (db) await db.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
it('rejects a newer database without downgrading it', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trip-painting-db-future-'));
  const filename = path.join(dir, 'data.sqlite');
  try {
    let raw = await openRaw(filename);
    await execRaw(
      raw,
      "PRAGMA user_version=9; CREATE TABLE future_data(value TEXT); INSERT INTO future_data VALUES ('preserve');",
    );
    await closeRaw(raw);
    await assert.rejects(openDatabase(filename), /newer/);
    raw = await openRaw(filename);
    assert.equal((await getRaw(raw, 'PRAGMA user_version')).user_version, 9);
    assert.equal((await getRaw(raw, 'SELECT value FROM future_data')).value, 'preserve');
    await closeRaw(raw);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
it('upgrades version 1 while preserving private photo ownership and existing accounts', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trip-painting-db-v1-'));
  const filename = path.join(dir, 'data.sqlite');
  let db;
  try {
    const raw = await openRaw(filename);
    const schema = (await fs.readFile(path.join(__dirname, '../data/schema.sql'), 'utf8')).split(
      '-- Confirmed GPS visits',
    )[0];
    await execRaw(
      raw,
      schema +
        "\nINSERT INTO users(id,email,password_hash,username) VALUES (7,'saved@example.test','preserved-hash','Saved'); INSERT INTO trips(id,user_id,title) VALUES (8,7,'Saved trip'); INSERT INTO steps(id,user_id,trip_id,latitude,longitude) VALUES (9,7,8,37,127); INSERT INTO photos(id,user_id,region_id,filename,thumbnail_filename,created_at) VALUES ('saved-photo',7,'gb:test','saved.jpg','saved-thumb.jpg','2026-01-01'); PRAGMA user_version=1;",
    );
    const before = {};
    for (const table of ['users', 'trips', 'steps', 'photos'])
      before[table] = await allRaw(raw, `SELECT * FROM ${table} ORDER BY id`);
    await closeRaw(raw);
    db = await openDatabase(filename);
    assert.equal((await db.get('PRAGMA user_version')).user_version, 3);
    for (const [table, rows] of Object.entries(before))
      assert.deepEqual(await db.all(`SELECT * FROM ${table} ORDER BY id`), rows);
    assert.equal(
      (await db.get('SELECT password_hash FROM users WHERE id=7')).password_hash,
      'preserved-hash',
    );
    assert.deepEqual(
      await db.get('SELECT user_id,filename,thumbnail_filename FROM photos WHERE id=?', [
        'saved-photo',
      ]),
      {
        user_id: 7,
        filename: 'saved.jpg',
        thumbnail_filename: 'saved-thumb.jpg',
      },
    );
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM visits')).count, 0);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM visit_photos')).count, 0);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM photo_sync_operations')).count, 0);
    assert.deepEqual(await db.all('PRAGMA foreign_key_check'), []);
  } finally {
    if (db) await db.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
it('upgrades version 2 without changing existing visits, tombstones, revisions, receipts or legacy photos', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trip-painting-db-v2-'));
  const filename = path.join(dir, 'data.sqlite');
  let db;
  try {
    const raw = await openRaw(filename);
    const schema = (await fs.readFile(path.join(__dirname, '../data/schema.sql'), 'utf8')).split(
      'CREATE TABLE IF NOT EXISTS visit_photos',
    )[0];
    await execRaw(
      raw,
      schema +
        `
      INSERT INTO users(id,email,password_hash,username) VALUES (7,'v2@example.test','preserved-v2-hash','Saved v2');
      INSERT INTO trips(id,user_id,title) VALUES (8,7,'Existing v2 trip');
      INSERT INTO steps(id,user_id,trip_id,latitude,longitude) VALUES (9,7,8,37.25,127.5);
      INSERT INTO photos(id,user_id,region_id,filename,thumbnail_filename,created_at) VALUES ('legacy-v2-photo',7,'gb:test','v2-original.jpg','v2-thumb.jpg','2026-01-01');
      INSERT INTO visit_changes(sequence,user_id,visit_id) VALUES (41,7,'00000000-0000-4000-8000-000000000001'),(42,7,'00000000-0000-4000-8000-000000000002');
      INSERT INTO visits(user_id,id,session_id,region_id,started_at,confirmed_at,source,deleted_at,revision) VALUES
        (7,'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','gb:test',1700000000000.25,1700000300000.5,'gps',NULL,41),
        (7,'00000000-0000-4000-8000-000000000002',NULL,NULL,NULL,NULL,NULL,1700000400000.75,42);
      INSERT INTO visit_sync_operations(user_id,operation_id,request_hash) VALUES (7,'00000000-0000-4000-8000-000000000004','preserved-request-hash');
      PRAGMA user_version=2;
    `,
    );
    const before = {};
    for (const table of [
      'users',
      'trips',
      'steps',
      'photos',
      'visits',
      'visit_changes',
      'visit_sync_operations',
    ])
      before[table] = await allRaw(raw, `SELECT * FROM ${table}`);
    await closeRaw(raw);
    db = await openDatabase(filename);
    assert.equal((await db.get('PRAGMA user_version')).user_version, 3);
    for (const [table, rows] of Object.entries(before))
      assert.deepEqual(await db.all(`SELECT * FROM ${table}`), rows);
    for (const table of ['visit_photos', 'visit_photo_changes', 'photo_sync_operations'])
      assert.equal((await db.get(`SELECT COUNT(*) AS count FROM ${table}`)).count, 0);
    assert.deepEqual(await db.all('PRAGMA foreign_key_check'), []);
    assert.equal((await db.get('PRAGMA integrity_check')).integrity_check, 'ok');
    await db.close();
    db = null;
    db = await openDatabase(filename);
    assert.deepEqual(await db.all('SELECT * FROM visits'), before.visits);
    assert.deepEqual(await db.all('SELECT * FROM photos'), before.photos);
    assert.equal(
      (await db.get("SELECT seq FROM sqlite_sequence WHERE name='visit_changes'")).seq,
      42,
    );
  } finally {
    if (db) await db.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
it('isolates queued writes from a transaction rollback', async () => {
  const db = await openDatabase(':memory:');
  try {
    let started, release;
    const entered = new Promise((resolve) => {
      started = resolve;
    });
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const transaction = db.transaction(async (raw) => {
      await raw.run('INSERT INTO users(email,password_hash,username) VALUES (?,?,?)', [
        'rollback@example.test',
        'hash',
        'Rolled back',
      ]);
      started();
      await gate;
      throw Error('rollback');
    });
    await entered;
    const outside = db.run('INSERT INTO users(email,password_hash,username) VALUES (?,?,?)', [
      'keep@example.test',
      'hash',
      'Keep',
    ]);
    release();
    await assert.rejects(transaction, /rollback/);
    await outside;
    assert.deepEqual(
      (await db.all('SELECT username FROM users')).map((row) => row.username),
      ['Keep'],
    );
  } finally {
    await db.close();
  }
});
