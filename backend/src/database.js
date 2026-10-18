const sqlite3 = require('sqlite3').verbose();
const fs = require('node:fs/promises');
const path = require('node:path');

async function openDatabase(filename) {
  const native = await new Promise((resolve, reject) => {
    const connection = new sqlite3.Database(filename, (error) =>
      error ? reject(error) : resolve(connection),
    );
  });
  const raw = {
    exec: (sql) =>
      new Promise((resolve, reject) =>
        native.exec(sql, (error) => (error ? reject(error) : resolve())),
      ),
    get: (sql, params = []) =>
      new Promise((resolve, reject) =>
        native.get(sql, params, (error, row) => (error ? reject(error) : resolve(row))),
      ),
    all: (sql, params = []) =>
      new Promise((resolve, reject) =>
        native.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows))),
      ),
    run: (sql, params = []) =>
      new Promise((resolve, reject) =>
        native.run(sql, params, function (error) {
          if (error) reject(error);
          else resolve({ lastID: this.lastID, changes: this.changes });
        }),
      ),
  };
  let queue = Promise.resolve();
  const exclusive = (operation) => {
    const result = queue.then(operation);
    queue = result.catch(() => undefined);
    return result;
  };
  const db = {
    exec: (sql) => exclusive(() => raw.exec(sql)),
    get: (sql, params) => exclusive(() => raw.get(sql, params)),
    all: (sql, params) => exclusive(() => raw.all(sql, params)),
    run: (sql, params) => exclusive(() => raw.run(sql, params)),
    transaction: (operation) =>
      exclusive(async () => {
        await raw.exec('BEGIN IMMEDIATE');
        try {
          const result = await operation(raw);
          await raw.exec('COMMIT');
          return result;
        } catch (error) {
          await raw.exec('ROLLBACK');
          throw error;
        }
      }),
    close: () =>
      exclusive(
        () =>
          new Promise((resolve, reject) =>
            native.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  };
  try {
    await db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const version = (await db.get('PRAGMA user_version')).user_version;
    if (version > 3) throw new Error('Database schema is newer than this server.');
    const schema = await fs.readFile(path.join(__dirname, '../data/schema.sql'), 'utf8');
    await db.transaction(async (transaction) => {
      await transaction.exec(schema);
      await transaction.exec('PRAGMA user_version=3;');
    });
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
module.exports = { openDatabase };
