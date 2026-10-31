const { it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { createBackend } = require('../src/app');

let directory, backend, server, base, tokens, users;
const epoch = 1700000000000;
function upsert(overrides = {}) {
  const id = randomUUID();
  const payload = {
    id,
    sessionId: randomUUID(),
    regionId: 'gb:synthetic-test-region',
    startedAt: epoch,
    confirmedAt: epoch + 300000,
    source: 'gps',
    deletedAt: null,
    ...overrides,
  };
  return {
    id: payload.id,
    entityType: 'visit',
    entityId: payload.id,
    operation: 'upsert',
    payload,
  };
}
function deletion(id, at = epoch + 400000) {
  return {
    id: randomUUID(),
    entityType: 'visit',
    entityId: id,
    operation: 'delete',
    payload: { id, deletedAt: at },
  };
}
async function request(route, { token = tokens[0], operations } = {}) {
  return fetch(base + route, {
    method: operations === undefined ? 'GET' : 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(operations === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: operations === undefined ? undefined : JSON.stringify({ operations }),
  });
}
const sync = (operations, token = tokens[0]) => request('/api/visits/sync', { token, operations });
const count = async (table = 'visits') =>
  (await backend.db.get(`SELECT COUNT(*) AS count FROM ${table}`)).count;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'trip-painting-visit-api-'));
  const secret = randomBytes(32).toString('hex');
  backend = await createBackend({
    jwtSecret: secret,
    dbPath: path.join(directory, 'data.sqlite'),
    uploadsDir: path.join(directory, 'uploads'),
  });
  users = [];
  for (const email of ['first@example.test', 'second@example.test']) {
    const inserted = await backend.db.run(
      'INSERT INTO users(email,password_hash,username) VALUES (?,?,?)',
      [email, 'unused-test-hash', 'Synthetic user'],
    );
    users.push(inserted.lastID);
  }
  tokens = users.map((id) =>
    jwt.sign({ id }, secret, {
      algorithm: 'HS256',
      issuer: 'trip-painting-api',
      audience: 'trip-painting-mobile',
      subject: String(id),
      expiresIn: '5m',
    }),
  );
  server = await new Promise((resolve) => {
    const s = backend.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  if (server)
    await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  if (backend) await backend.close();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});

it('authenticates both sync and download, without storing anonymous data', async () => {
  assert.equal((await sync([upsert()], null)).status, 401);
  assert.equal((await request('/api/visits', { token: null })).status, 401);
  assert.equal(await count(), 0);
});
it('stores a batch and permits exact retries after an ignored/lost HTTP response', async () => {
  const operations = [upsert(), upsert()];
  assert.equal((await sync(operations)).status, 200);
  const retry = await sync(operations);
  assert.deepEqual(await retry.json(), {
    acknowledgedIds: operations.map((o) => o.id),
  });
  assert.equal(await count(), 2);
  assert.equal(await count('visit_changes'), 2);
  assert.equal(await count('visit_sync_operations'), 2);
  const response = await request('/api/visits');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const page = await response.json();
  assert.deepEqual(
    page.visits.map((v) => v.id),
    operations.map((o) => o.entityId),
  );
  assert.equal(page.hasMore, false);
});
it('serializes concurrent retries and deduplicates acknowledgement IDs within one batch', async () => {
  const operation = upsert();
  const responses = await Promise.all([sync([operation, operation]), sync([operation])]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [200, 200],
  );
  assert.deepEqual((await responses[0].json()).acknowledgedIds, [operation.id]);
  assert.equal(await count(), 1);
  assert.equal(await count('visit_sync_operations'), 1);
});
it('preserves fractional millisecond timestamps from native GPS without rounding them', async () => {
  const operation = upsert({ startedAt: epoch + 0.25, confirmedAt: epoch + 300000.5 });
  assert.equal((await sync([operation])).status, 200);
  assert.equal((await sync([operation])).status, 200);
  const visit = (await (await request('/api/visits')).json()).visits[0];
  assert.equal(visit.startedAt, operation.payload.startedAt);
  assert.equal(visit.confirmedAt, operation.payload.confirmedAt);
  assert.equal(await count(), 1);
});
it('keeps identical visit/operation/session UUIDs isolated by account', async () => {
  const operation = upsert();
  assert.equal((await sync([operation])).status, 200);
  assert.deepEqual((await (await request('/api/visits', { token: tokens[1] })).json()).visits, []);
  assert.equal((await sync([operation], tokens[1])).status, 200);
  assert.equal(await count(), 2);
  assert.equal((await sync([deletion(operation.entityId)], tokens[1])).status, 200);
  assert.equal((await (await request('/api/visits')).json()).visits[0].deletedAt, null);
});
it('rejects malformed batches, client ownership, development visits and unconfirmed timestamps atomically', async () => {
  const valid = upsert();
  const invalid = [
    { ...valid, id: 'not-a-uuid' },
    { ...valid, entityType: 'photo' },
    { ...valid, entityId: randomUUID() },
    { ...valid, operation: 'unknown' },
    { ...valid, userId: users[1] },
    upsert({ source: 'development' }),
    upsert({ confirmedAt: epoch + 299999 }),
    upsert({ startedAt: -1 }),
    upsert({ confirmedAt: Number.MAX_SAFE_INTEGER + 1 }),
    upsert({ regionId: '../private' }),
    upsert({ regionId: 'region\nwith-control' }),
    upsert({ deletedAt: epoch }),
    upsert({ sessionId: null }),
    upsert({ user_id: users[1] }),
    deletion(randomUUID(), null),
    null,
  ];
  for (const bad of invalid) assert.equal((await sync([upsert(), bad])).status, 400);
  assert.equal((await sync(Array.from({ length: 101 }, () => upsert()))).status, 400);
  assert.equal(await count(), 0);
  assert.equal(await count('visit_sync_operations'), 0);
});
it('detects an operation UUID reused for different data and rolls back preceding writes', async () => {
  const old = upsert();
  await sync([old]);
  const conflicting = {
    ...old,
    payload: { ...old.payload, regionId: 'gb:changed' },
  };
  const response = await sync([upsert(), conflicting]);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'OPERATION_CONFLICT');
  assert.equal(await count(), 1);
  assert.equal(await count('visit_sync_operations'), 1);
});
it('accepts identical entity content with a fresh operation UUID without adding a change', async () => {
  const old = upsert();
  await sync([old]);
  assert.equal((await sync([{ ...old, id: randomUUID() }])).status, 200);
  assert.equal(await count(), 1);
  assert.equal(await count('visit_changes'), 1);
  assert.equal(await count('visit_sync_operations'), 2);
});
it('rejects conflicting confirmed metadata and a session reused under another visit UUID', async () => {
  const old = upsert();
  await sync([old]);
  const changed = {
    ...old,
    id: randomUUID(),
    payload: { ...old.payload, confirmedAt: epoch + 301000 },
  };
  assert.equal((await sync([upsert(), changed])).status, 409);
  const duplicateSession = upsert({ sessionId: old.payload.sessionId });
  const response = await sync([duplicateSession]);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'SESSION_CONFLICT');
  assert.equal(await count(), 1);
});
it('never resurrects a deleted visit through old or new upsert operation IDs', async () => {
  const old = upsert();
  await sync([old]);
  const original = (await (await request('/api/visits')).json()).cursor;
  const removed = deletion(old.entityId);
  await sync([removed]);
  await sync([old]);
  await sync([{ ...old, id: randomUUID() }]);
  await sync([removed, deletion(old.entityId, epoch + 500000)]);
  const page = await (await request(`/api/visits?after=${original}`)).json();
  assert.equal(page.visits.length, 1);
  assert.equal(page.visits[0].deletedAt, removed.payload.deletedAt);
  assert.equal(await count('visit_changes'), 2);
});
it('preserves delete-before-create tombstones regardless of batch/request arrival order', async () => {
  const old = upsert();
  assert.equal((await sync([deletion(old.entityId), old])).status, 200);
  const page = await (await request('/api/visits')).json();
  assert.equal(page.visits[0].deletedAt, epoch + 400000);
  assert.equal(page.visits[0].sessionId, null);
  assert.equal(await count(), 1);
  assert.equal(await count('visit_changes'), 1);
  await sync([old]);
  assert.equal((await (await request('/api/visits')).json()).visits[0].deletedAt, epoch + 400000);
});
it('does not omit another visit when paginating through updates and tombstones', async () => {
  const operations = [upsert(), upsert(), upsert()];
  await sync(operations);
  await sync([upsert()], tokens[1]);
  let page = await (await request('/api/visits?limit=1')).json();
  assert.equal(page.visits[0].id, operations[0].entityId);
  assert.equal(page.hasMore, true);
  const firstCursor = page.cursor;
  await sync([deletion(operations[0].entityId)]);
  page = await (await request(`/api/visits?after=${firstCursor}&limit=1`)).json();
  assert.equal(page.visits[0].id, operations[1].entityId);
  page = await (await request(`/api/visits?after=${page.cursor}`)).json();
  assert.deepEqual(
    page.visits.map((v) => v.id),
    [operations[2].entityId, operations[0].entityId],
  );
  assert.equal(page.hasMore, false);
  const empty = await (await request(`/api/visits?after=${page.cursor}`)).json();
  assert.deepEqual(empty.visits, []);
  assert.equal(empty.cursor, page.cursor);
});
it('validates bounded pagination and normalizes equivalent UUID casing', async () => {
  for (const query of [
    'after=-1',
    'after=1e2',
    'limit=0',
    'limit=501',
    'limit=x',
    'after=9007199254740992',
    'after=1&after=2',
    'user_id=2',
  ])
    assert.equal((await request(`/api/visits?${query}`)).status, 400);
  const old = upsert();
  const upper = {
    ...old,
    id: old.id.toUpperCase(),
    entityId: old.entityId.toUpperCase(),
    payload: {
      ...old.payload,
      id: old.payload.id.toUpperCase(),
      sessionId: old.payload.sessionId.toUpperCase(),
    },
  };
  await sync([upper]);
  assert.equal((await sync([old])).status, 200);
  assert.equal(await count(), 1);
});
it('rolls back entities, revisions and receipts when a database write fails', async () => {
  await backend.db.exec(
    "CREATE TRIGGER fail_visit_receipt BEFORE INSERT ON visit_sync_operations BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
  );
  assert.equal((await sync([upsert()])).status, 500);
  assert.equal(await count(), 0);
  assert.equal(await count('visit_changes'), 0);
  assert.equal(await count('visit_sync_operations'), 0);
  assert.equal((await fetch(base + '/health')).status, 200);
});
it('preserves visit data and retry acknowledgements after reopening the server database', async () => {
  const old = upsert();
  await sync([old]);
  await new Promise((resolve) => server.close(resolve));
  server = null;
  await backend.close();
  const { openDatabase } = require('../src/database');
  const db = await openDatabase(path.join(directory, 'data.sqlite'));
  backend = { close: () => db.close() };
  assert.equal((await db.get('SELECT COUNT(*) AS count FROM visits')).count, 1);
  assert.equal((await db.get('SELECT COUNT(*) AS count FROM visit_sync_operations')).count, 1);
  assert.equal((await db.get('PRAGMA user_version')).user_version, 3);
});
