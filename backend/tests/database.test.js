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
    await closeRaw(raw);
    db = await openDatabase(filename);
    assert.equal((await db.get('SELECT username FROM users WHERE id=7')).username, 'Legacy');
    assert.equal((await db.get('SELECT title FROM trips WHERE id=8')).title, 'Existing trip');
    assert.equal((await db.get('SELECT trip_id FROM steps WHERE id=9')).trip_id, 8);
    assert.equal((await db.get('PRAGMA user_version')).user_version, 1);
    assert.equal((await db.get('PRAGMA foreign_keys')).foreign_keys, 1);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM photos')).count, 0);
    await db.close();
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
