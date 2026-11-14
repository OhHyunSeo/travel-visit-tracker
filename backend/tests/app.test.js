const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const sharp = require('sharp');
const { createBackend } = require('../src/app');
const { readConfig } = require('../src/config');

let directory, backend, server, base, secret, userA, userB, image;
async function request(route, { token, method = 'GET', body, headers = {} } = {}) {
  if (token) headers = { ...headers, Authorization: `Bearer ${token}` };
  if (body && !(body instanceof FormData)) {
    headers = { ...headers, 'Content-Type': 'application/json' };
    body = JSON.stringify(body);
  }
  return fetch(`${base}${route}`, { method, body, headers });
}
async function signup(email = 'a@example.test') {
  const response = await request('/api/auth/signup', {
    method: 'POST',
    body: { email, password: 'test-password-123', username: 'Test user' },
  });
  assert.equal(response.status, 201);
  return response.json();
}
async function upload(
  token,
  { type = 'image/png', buffer = image, regionId = 'gb:test-region', field = 'file' } = {},
) {
  const form = new FormData();
  form.append('region_id', regionId);
  form.append(field, new Blob([buffer], { type }), 'test.png');
  return request('/api/photos', { method: 'POST', token, body: form });
}
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'trip-painting-backend-test-'));
  secret = crypto.randomBytes(32).toString('hex');
  backend = await createBackend({
    jwtSecret: secret,
    dbPath: path.join(directory, 'data/database.sqlite'),
    uploadsDir: path.join(directory, 'uploads'),
    dataDir: path.join(directory, 'data'),
  });
  server = await new Promise((resolve) => {
    const listener = backend.app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  base = `http://127.0.0.1:${server.address().port}`;
  image = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#118866' } })
    .png()
    .toBuffer();
  userA = await signup();
  userB = await signup('b@example.test');
});
afterEach(async () => {
  if (server)
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  if (backend) await backend.close();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});
describe('isolated backend API and owner protection', { concurrency: false }, () => {
  it('requires an explicit secret before creating a database or upload directory', async () => {
    for (const value of [
      undefined,
      'short',
      ' '.repeat(32),
      'your-secret-key-change-in-production',
    ]) {
      assert.throws(() => readConfig({ JWT_SECRET: value }), /JWT_SECRET/);
      await assert.rejects(
        createBackend({
          jwtSecret: value,
          dbPath: path.join(directory, 'not-created/db.sqlite'),
          uploadsDir: path.join(directory, 'not-created/uploads'),
        }),
        /JWT_SECRET/,
      );
    }
    await assert.rejects(fs.access(path.join(directory, 'not-created')));
  });
  it('serves health and a public development pack with conditional caching', async () => {
    assert.equal((await request('/health')).status, 200);
    await fs.writeFile(
      path.join(directory, 'data/KR_boundaries.geojson'),
      JSON.stringify({ type: 'FeatureCollection', features: [] }),
    );
    const response = await request('/api/geojson/KR');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /geo\+json/);
    assert.equal(
      (
        await request('/api/geojson/KR', {
          headers: { 'If-None-Match': response.headers.get('etag') },
        })
      ).status,
      304,
    );
    assert.equal((await request('/api/geojson/kr')).status, 400);
    assert.equal((await request('/api/geojson/US')).status, 404);
  });
  it('normalizes new email addresses and handles simultaneous duplicate signup safely', async () => {
    const responses = await Promise.all(
      ['New@Example.test', 'new@example.test'].map((email) =>
        request('/api/auth/signup', {
          method: 'POST',
          body: { email, password: 'password-123', username: 'New' },
        }),
      ),
    );
    assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
    assert.equal(
      (
        await backend.db.get('SELECT COUNT(*) AS count FROM users WHERE email=?', [
          'new@example.test',
        ])
      ).count,
      1,
    );
  });
  it('rejects malformed credentials and passwords beyond bcrypt UTF-8 input length', async () => {
    for (const body of [
      { email: [], password: 'password-123', username: 'x' },
      { email: 'invalid', password: 'password-123', username: 'x' },
      { email: 'new@example.test', password: '가'.repeat(25), username: 'x' },
      { email: 'new@example.test', password: 'short', username: 'x' },
    ])
      assert.equal((await request('/api/auth/signup', { method: 'POST', body })).status, 400);
  });
  it('logs in an existing mixed-case email without changing or deleting the account', async () => {
    const hash = await bcrypt.hash('legacy-password', 10);
    const inserted = await backend.db.run(
      'INSERT INTO users(email,password_hash,username) VALUES (?,?,?)',
      ['Legacy@Example.test', hash, 'Legacy'],
    );
    const response = await request('/api/auth/login', {
      method: 'POST',
      body: { email: 'legacy@example.test', password: 'legacy-password' },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.id, inserted.lastID);
    assert.equal(
      (await backend.db.get('SELECT email FROM users WHERE id=?', [inserted.lastID])).email,
      'Legacy@Example.test',
    );
    assert.equal(
      (
        await request('/api/auth/signup', {
          method: 'POST',
          body: { email: 'LEGACY@example.test', password: 'password-123', username: 'Other' },
        })
      ).status,
      409,
    );
  });
  it('preserves login for legacy passwords over 72 bytes while rejecting new truncated passwords', async () => {
    const password = 'legacy-password-'.repeat(6);
    const hash = await bcrypt.hash(password, 10);
    const inserted = await backend.db.run(
      'INSERT INTO users(email,password_hash,username) VALUES (?,?,?)',
      ['long-legacy@example.test', hash, 'Legacy long password'],
    );
    const login = await request('/api/auth/login', {
      method: 'POST',
      body: { email: 'long-legacy@example.test', password },
    });
    assert.equal(login.status, 200);
    assert.equal((await login.json()).user.id, inserted.lastID);
    const signup = await request('/api/auth/signup', {
      method: 'POST',
      body: { email: 'new-long@example.test', password, username: 'New' },
    });
    assert.equal(signup.status, 400);
  });
  it('rejects missing, malformed, expired, wrong-scope and wrong-algorithm tokens', async () => {
    assert.equal((await request('/api/auth/me')).status, 401);
    assert.equal(
      (await request('/api/auth/me', { headers: { Authorization: `Basic ${userA.token}` } }))
        .status,
      401,
    );
    for (const options of [
      { algorithm: 'HS512' },
      { issuer: 'other-api' },
      { audience: 'other-client' },
      { expiresIn: -1 },
    ]) {
      const token = jwt.sign({ id: userA.user.id }, secret, {
        algorithm: 'HS256',
        issuer: 'trip-painting-api',
        audience: 'trip-painting-mobile',
        subject: String(userA.user.id),
        expiresIn: '30d',
        ...options,
      });
      assert.equal((await request('/api/auth/me', { token })).status, 401);
    }
    const token = jwt.sign({ id: 999 }, secret, {
      algorithm: 'HS256',
      issuer: 'trip-painting-api',
      audience: 'trip-painting-mobile',
      subject: '999',
      expiresIn: '30d',
    });
    assert.equal((await request('/api/auth/me', { token })).status, 401);
    const response = await request('/api/auth/me', { token: userA.token });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.id, userA.user.id);
  });
  it('does not allow wildcard web origins by default', async () => {
    const response = await request('/health', { headers: { Origin: 'https://unrelated.example' } });
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });
  it('authenticates before accepting an uploaded file', async () => {
    assert.equal((await upload(undefined)).status, 401);
    assert.deepEqual(await fs.readdir(path.join(directory, 'uploads')), ['thumbnails']);
    assert.equal((await backend.db.get('SELECT COUNT(*) AS count FROM photos')).count, 0);
  });
  it('protects originals and thumbnails from anonymous and other-account access', async () => {
    const response = await upload(userA.token);
    assert.equal(response.status, 200);
    const photo = await response.json();
    assert.match(photo.url, /\.jpg$/);
    for (const url of [photo.url, photo.thumbnail_url]) {
      const route = new URL(url).pathname;
      assert.equal((await request(route)).status, 401);
      assert.equal((await request(route, { token: userB.token })).status, 404);
      const own = await request(route, { token: userA.token });
      assert.equal(own.status, 200);
      assert.equal(own.headers.get('cache-control'), 'private, no-store');
      assert.match(own.headers.get('content-type'), /image\/jpeg/);
      const metadata = await sharp(Buffer.from(await own.arrayBuffer())).metadata();
      assert.equal(metadata.format, 'jpeg');
    }
    const row = await backend.db.get('SELECT user_id,region_id FROM photos WHERE id=?', [photo.id]);
    assert.equal(row.user_id, userA.user.id);
    assert.equal(row.region_id, 'gb:test-region');
  });
  it('preserves unregistered legacy files while denying public or guessed access', async () => {
    const legacy = path.join(directory, 'uploads/legacy.jpg');
    await fs.writeFile(legacy, 'existing file, preserve');
    assert.equal((await request('/uploads/legacy.jpg')).status, 401);
    assert.equal((await request('/uploads/legacy.jpg', { token: userA.token })).status, 404);
    assert.equal(await fs.readFile(legacy, 'utf8'), 'existing file, preserve');
  });
  it('rejects invalid IDs, MIME types, bytes and oversized images without keeping files', async () => {
    for (const options of [
      { regionId: '../../private' },
      { type: 'text/plain' },
      { buffer: Buffer.from('not an image') },
      { field: 'wrong-field' },
    ])
      assert.equal((await upload(userA.token, options)).status, 400);
    assert.equal(
      (await upload(userA.token, { buffer: Buffer.alloc(10 * 1024 * 1024 + 1) })).status,
      413,
    );
    assert.deepEqual(await fs.readdir(path.join(directory, 'uploads')), ['thumbnails']);
    assert.deepEqual(await fs.readdir(path.join(directory, 'uploads/thumbnails')), []);
  });
  it('removes only this request newly-created files if metadata persistence fails', async () => {
    const old = path.join(directory, 'uploads/keep.jpg');
    await fs.writeFile(old, 'keep');
    const run = backend.db.run;
    backend.db.run = (sql, params) =>
      sql.startsWith('INSERT INTO photos')
        ? Promise.reject(new Error('private internal path must not be exposed'))
        : run(sql, params);
    const response = await upload(userA.token);
    assert.equal(response.status, 500);
    assert.equal((await response.json()).message, 'An unexpected error occurred.');
    backend.db.run = run;
    assert.deepEqual((await fs.readdir(path.join(directory, 'uploads'))).sort(), [
      'keep.jpg',
      'thumbnails',
    ]);
    assert.equal(await fs.readFile(old, 'utf8'), 'keep');
    assert.deepEqual(await fs.readdir(path.join(directory, 'uploads/thumbnails')), []);
  });
  it('rejects a cross-account trip and never partially stores the batch', async () => {
    const trip = await backend.db.run('INSERT INTO trips(user_id,title) VALUES (?,?)', [
      userB.user.id,
      'Private trip',
    ]);
    const response = await request('/api/trips/sync', {
      method: 'POST',
      token: userA.token,
      body: {
        steps: [
          { local_id: 'first', latitude: 37, longitude: 127 },
          { local_id: 'second', latitude: 37, longitude: 127, trip_id: trip.lastID },
        ],
      },
    });
    assert.equal(response.status, 403);
    assert.equal((await backend.db.get('SELECT COUNT(*) AS count FROM steps')).count, 0);
  });
  it('stores only validated location points for the authenticated owner', async () => {
    const trip = await backend.db.run('INSERT INTO trips(user_id,title) VALUES (?,?)', [
      userA.user.id,
      'Own trip',
    ]);
    const response = await request('/api/trips/sync', {
      method: 'POST',
      token: userA.token,
      body: { steps: [{ local_id: 'one', latitude: 37, longitude: 127, trip_id: trip.lastID }] },
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).synced_ids, ['one']);
    assert.equal((await backend.db.get('SELECT user_id FROM steps')).user_id, userA.user.id);
    assert.equal(
      (
        await request('/api/trips/sync', {
          method: 'POST',
          token: userA.token,
          body: { steps: [{ local_id: 'bad', latitude: 999, longitude: 127 }] },
        })
      ).status,
      400,
    );
    assert.equal((await backend.db.get('SELECT COUNT(*) AS count FROM steps')).count, 1);
  });
  it('rolls back earlier point inserts when a later SQL insert fails', async () => {
    const transaction = backend.db.transaction;
    backend.db.transaction = (operation) =>
      transaction(async (raw) => {
        let inserted = 0;
        return operation({
          ...raw,
          run: (sql, params) =>
            sql.startsWith('INSERT INTO steps') && ++inserted === 2
              ? Promise.reject(new Error('insertion failed'))
              : raw.run(sql, params),
        });
      });
    const response = await request('/api/trips/sync', {
      method: 'POST',
      token: userA.token,
      body: {
        steps: [
          { local_id: 1, latitude: 37, longitude: 127 },
          { local_id: 2, latitude: 37, longitude: 127 },
        ],
      },
    });
    assert.equal(response.status, 500);
    assert.equal((await backend.db.get('SELECT COUNT(*) AS count FROM steps')).count, 0);
    backend.db.transaction = transaction;
  });
  it('converts malformed JSON into a bounded client error and stays available', async () => {
    const response = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'ignored',
    });
    assert.equal(response.status, 400);
    const malformed = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"bad"',
    });
    assert.equal(malformed.status, 400);
    assert.equal((await request('/health')).status, 200);
  });
});
