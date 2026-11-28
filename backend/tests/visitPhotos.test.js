const { it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const jwt = require('jsonwebtoken');
const sharp = require('sharp');
const { createBackend } = require('../src/app');

let directory,
  backend,
  server,
  base,
  config,
  tokens,
  users,
  parent,
  otherParent,
  png,
  jpeg,
  otherPng;
const epoch = 1700000000000.25;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
function visit(id = randomUUID()) {
  return {
    id,
    entityType: 'visit',
    entityId: id,
    operation: 'upsert',
    payload: {
      id,
      sessionId: randomUUID(),
      regionId: 'gb:synthetic-photo-region',
      startedAt: epoch,
      confirmedAt: epoch + 300000.25,
      source: 'gps',
      deletedAt: null,
    },
  };
}
function metadata(overrides = {}) {
  return {
    id: randomUUID(),
    visitId: parent.entityId,
    operationId: randomUUID(),
    createdAt: String(epoch + 123.5),
    ...overrides,
  };
}
function request(route, { token = tokens[0], method = 'GET', body } = {}) {
  return fetch(base + route, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body instanceof FormData || body === undefined ? body : JSON.stringify(body),
  });
}
const sync = (operations, token = tokens[0]) =>
  request('/api/visits/sync', { token, method: 'POST', body: { operations } });
function removeVisit(id, token = tokens[0]) {
  return sync(
    [
      {
        id: randomUUID(),
        entityType: 'visit',
        entityId: id,
        operation: 'delete',
        payload: { id, deletedAt: epoch + 500000 },
      },
    ],
    token,
  );
}
function upload(
  value = metadata(),
  {
    token = tokens[0],
    bytes = png,
    type = 'image/png',
    field = 'file',
    extra = [],
    omitFile = false,
  } = {},
) {
  const form = new FormData();
  for (const [key, entry] of Object.entries(value))
    if (entry !== undefined) form.append(key, entry);
  for (const [key, entry] of extra) form.append(key, entry);
  if (!omitFile) form.append(field, new Blob([bytes], { type }), 'synthetic-image');
  return request('/api/visit-photos', { token, method: 'POST', body: form });
}
async function counts() {
  const result = {};
  for (const table of ['visit_photos', 'visit_photo_changes', 'photo_sync_operations'])
    result[table] = (await backend.db.get(`SELECT COUNT(*) AS count FROM ${table}`)).count;
  return result;
}
async function files(root = path.join(directory, 'uploads'), prefix = '') {
  const found = {};
  for (const entry of (await fs.readdir(root, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const relative = prefix + entry.name;
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) Object.assign(found, await files(target, relative + '/'));
    else found[relative] = digest(await fs.readFile(target));
  }
  return found;
}
async function start() {
  backend = await createBackend(config);
  server = await new Promise((resolve) => {
    const listener = backend.app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  base = `http://127.0.0.1:${server.address().port}`;
}
async function stop() {
  if (server) {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    server = null;
  }
  if (backend) {
    await backend.close();
    backend = null;
  }
}
function gate() {
  let resolve;
  const promise = new Promise((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('synthetic gate was not reached')), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'trip-painting-visit-photo-api-'));
  config = {
    jwtSecret: randomBytes(32).toString('hex'),
    dbPath: path.join(directory, 'data.sqlite'),
    uploadsDir: path.join(directory, 'uploads'),
  };
  await start();
  users = [];
  for (const email of ['photo-a@example.test', 'photo-b@example.test']) {
    const user = await backend.db.run(
      'INSERT INTO users(email,password_hash,username) VALUES (?,?,?)',
      [email, 'unused-synthetic-hash', 'Synthetic photo user'],
    );
    users.push(user.lastID);
  }
  tokens = users.map((id) =>
    jwt.sign({ id }, config.jwtSecret, {
      algorithm: 'HS256',
      issuer: 'trip-painting-api',
      audience: 'trip-painting-mobile',
      subject: String(id),
      expiresIn: '5m',
    }),
  );
  parent = visit();
  otherParent = visit();
  assert.equal((await sync([parent, otherParent])).status, 200);
  const image = (background) => sharp({ create: { width: 8, height: 6, channels: 3, background } });
  png = await image('#118866').png().toBuffer();
  jpeg = await image('#cc6644').jpeg({ quality: 87 }).toBuffer();
  otherPng = await image('#2244aa').png().toBuffer();
});
afterEach(async () => {
  await stop();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});

it('authenticates before accepting photos or listing private metadata', async () => {
  assert.equal((await upload(metadata(), { token: null })).status, 401);
  assert.equal((await request('/api/visit-photos', { token: null })).status, 401);
  assert.equal(
    (
      await request(`/api/visit-photos/${randomUUID()}/original`, {
        token: null,
      })
    ).status,
    401,
  );
  assert.deepEqual(await files(), {});
  assert.deepEqual(await counts(), {
    visit_photos: 0,
    visit_photo_changes: 0,
    photo_sync_operations: 0,
  });
});

for (const format of ['png', 'jpeg'])
  it(`preserves exact ${format.toUpperCase()} bytes, hash and fractional time with a separately decoded thumbnail`, async () => {
    const value = metadata();
    const bytes = format === 'png' ? png : jpeg;
    const type = `image/${format}`;
    const response = await upload(value, { bytes, type });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.acknowledgedId, value.operationId);
    assert.deepEqual(
      {
        id: result.photo.id,
        visitId: result.photo.visitId,
        createdAt: result.photo.createdAt,
        sha256: result.photo.sha256,
        byteLength: result.photo.byteLength,
        mimeType: result.photo.mimeType,
      },
      {
        id: value.id,
        visitId: value.visitId,
        createdAt: Number(value.createdAt),
        sha256: digest(bytes),
        byteLength: bytes.length,
        mimeType: type,
      },
    );
    assert.equal(Number.isSafeInteger(result.photo.revision) && result.photo.revision > 0, true);
    assert.equal(result.photo.originalPath, `/api/visit-photos/${value.id}/original`);
    assert.equal(result.photo.thumbnailPath, `/api/visit-photos/${value.id}/thumbnail`);
    for (const route of [result.photo.originalPath, result.photo.thumbnailPath]) {
      assert.equal((await request(route, { token: null })).status, 401);
      assert.equal((await request(route, { token: tokens[1] })).status, 404);
      const own = await request(route);
      assert.equal(own.status, 200);
      assert.equal(own.headers.get('cache-control'), 'private, no-store');
      assert.equal(own.headers.get('x-content-type-options'), 'nosniff');
      const received = Buffer.from(await own.arrayBuffer());
      const decoded = await sharp(received).metadata();
      if (route === result.photo.originalPath) {
        assert.deepEqual(received, bytes);
        assert.equal(own.headers.get('content-type').split(';')[0], type);
        assert.equal(decoded.format, format);
      } else {
        assert.equal(decoded.format, 'jpeg');
        assert.equal(decoded.width > 0 && decoded.width <= 200, true);
        assert.equal(decoded.height > 0 && decoded.height <= 200, true);
        const pixels = await sharp(received).raw().toBuffer({ resolveWithObject: true });
        assert.equal(
          pixels.data.length,
          pixels.info.width * pixels.info.height * pixels.info.channels,
        );
      }
    }
    const row = await backend.db.get(
      'SELECT filename,thumbnail_filename FROM visit_photos WHERE user_id=? AND id=?',
      [users[0], value.id],
    );
    assert.equal((await request('/uploads/' + row.filename, { token: null })).status, 401);
    assert.equal((await request('/uploads/' + row.filename, { token: tokens[0] })).status, 404);
    assert.equal(
      (
        await request('/uploads/thumbnails/' + row.thumbnail_filename, {
          token: tokens[0],
        })
      ).status,
      404,
    );
  });

it('serializes simultaneous duplicate operations without duplicate files or receipts', async () => {
  const value = metadata();
  const responses = await Promise.all([upload(value), upload(value)]);
  assert.deepEqual(
    responses.map((response) => response.status),
    [200, 200],
  );
  assert.deepEqual(await responses[0].json(), await responses[1].json());
  assert.deepEqual(await counts(), {
    visit_photos: 1,
    visit_photo_changes: 1,
    photo_sync_operations: 1,
  });
  assert.equal(Object.keys(await files()).length, 2);
});

it('replays a stored operation after discarding its unread HTTP response', async () => {
  const value = metadata();
  const ignored = await upload(value);
  assert.equal(ignored.status, 200);
  await ignored.body.cancel();
  const before = await files();
  const response = await upload(value);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).acknowledgedId, value.operationId);
  assert.deepEqual(await counts(), {
    visit_photos: 1,
    visit_photo_changes: 1,
    photo_sync_operations: 1,
  });
  assert.deepEqual(await files(), before);
});

it('retains metadata, byte hashes and replay receipts after server database close and reopening', async () => {
  const value = metadata();
  const saved = await (await upload(value)).json();
  const before = await files();
  await stop();
  await start();
  const response = await upload(value);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), saved);
  assert.deepEqual(await files(), before);
  assert.deepEqual(await counts(), {
    visit_photos: 1,
    visit_photo_changes: 1,
    photo_sync_operations: 1,
  });
  assert.equal((await backend.db.get('PRAGMA user_version')).user_version, 3);
});

it('records a fresh operation for identical photo content without creating new files or revisions', async () => {
  const value = metadata();
  const first = await (await upload(value)).json();
  const before = await files();
  const next = { ...value, operationId: randomUUID() };
  const response = await upload(next);
  assert.equal(response.status, 200);
  const replay = await response.json();
  assert.equal(replay.acknowledgedId, next.operationId);
  assert.deepEqual(replay.photo, first.photo);
  assert.deepEqual(await files(), before);
  assert.deepEqual(await counts(), {
    visit_photos: 1,
    visit_photo_changes: 1,
    photo_sync_operations: 2,
  });
});

it('rejects reused operation IDs with different photo, bytes, visit or timestamp without changing stored content', async () => {
  const value = metadata();
  assert.equal((await upload(value)).status, 200);
  const before = await files();
  for (const [changed, options] of [
    [{ ...value, id: randomUUID() }, {}],
    [value, { bytes: otherPng }],
    [{ ...value, visitId: otherParent.entityId }, {}],
    [{ ...value, createdAt: String(Number(value.createdAt) + 0.25) }, {}],
  ])
    assert.equal((await upload(changed, options)).status, 409);
  assert.deepEqual(await files(), before);
  assert.deepEqual(await counts(), {
    visit_photos: 1,
    visit_photo_changes: 1,
    photo_sync_operations: 1,
  });
});

it('rejects changed existing photo content even when the operation ID is new', async () => {
  const value = metadata();
  const saved = await (await upload(value)).json();
  const before = await files();
  for (const [changed, options] of [
    [{ ...value, operationId: randomUUID() }, { bytes: otherPng }],
    [{ ...value, operationId: randomUUID(), visitId: otherParent.entityId }, {}],
    [
      {
        ...value,
        operationId: randomUUID(),
        createdAt: String(Number(value.createdAt) + 0.5),
      },
      {},
    ],
  ])
    assert.equal((await upload(changed, options)).status, 409);
  assert.deepEqual((await (await request('/api/visit-photos')).json()).photos, [saved.photo]);
  assert.deepEqual(await files(), before);
  assert.deepEqual(await counts(), {
    visit_photos: 1,
    visit_photo_changes: 1,
    photo_sync_operations: 1,
  });
});

it('isolates identical photo, operation and visit UUIDs by account', async () => {
  assert.equal((await sync([parent], tokens[1])).status, 200);
  const value = metadata();
  const a = await (await upload(value)).json();
  assert.deepEqual(
    (await (await request('/api/visit-photos', { token: tokens[1] })).json()).photos,
    [],
  );
  assert.equal((await request(a.photo.originalPath, { token: tokens[1] })).status, 404);
  const response = await upload(value, { token: tokens[1], bytes: otherPng });
  assert.equal(response.status, 200);
  const b = await response.json();
  assert.equal(b.photo.id, a.photo.id);
  assert.notEqual(b.photo.sha256, a.photo.sha256);
  assert.deepEqual(Buffer.from(await (await request(a.photo.originalPath)).arrayBuffer()), png);
  assert.deepEqual(
    Buffer.from(await (await request(b.photo.originalPath, { token: tokens[1] })).arrayBuffer()),
    otherPng,
  );
  assert.deepEqual(await counts(), {
    visit_photos: 2,
    visit_photo_changes: 2,
    photo_sync_operations: 2,
  });
  assert.equal(Object.keys(await files()).length, 4);
});

it('normalizes equivalent UUID casing without duplicating a photo or receipt', async () => {
  const value = metadata();
  const upper = Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      key === 'createdAt' ? entry : entry.toUpperCase(),
    ]),
  );
  const response = await upload(upper);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).photo.id, value.id);
  assert.equal((await upload(value)).status, 200);
  assert.deepEqual(await counts(), {
    visit_photos: 1,
    visit_photo_changes: 1,
    photo_sync_operations: 1,
  });
});

it('requires an existing active GPS parent owned by the authenticated account', async () => {
  for (const [value, options] of [
    [metadata({ visitId: randomUUID() }), {}],
    [metadata(), { token: tokens[1] }],
  ])
    assert.equal((await upload(value, options)).status, 404);
  assert.equal((await removeVisit(parent.entityId)).status, 200);
  assert.equal((await upload(metadata())).status, 409);
  assert.deepEqual(await files(), {});
  assert.deepEqual(await counts(), {
    visit_photos: 0,
    visit_photo_changes: 0,
    photo_sync_operations: 0,
  });
});

it('hides both file variants and metadata after parent deletion and rejects old or fresh upload operations', async () => {
  const value = metadata();
  const saved = await (await upload(value)).json();
  const before = await files();
  assert.equal((await removeVisit(parent.entityId)).status, 200);
  assert.equal((await upload(value)).status, 409);
  assert.equal((await upload({ ...value, operationId: randomUUID() })).status, 409);
  for (const route of [saved.photo.originalPath, saved.photo.thumbnailPath])
    assert.equal((await request(route)).status, 404);
  assert.deepEqual((await (await request('/api/visit-photos')).json()).photos, []);
  assert.deepEqual(await files(), before);
  assert.deepEqual(await counts(), {
    visit_photos: 1,
    visit_photo_changes: 1,
    photo_sync_operations: 1,
  });
});

it('paginates only this account active-parent photos across revision gaps and validates cursors', async () => {
  const first = metadata();
  await upload(first);
  await sync([parent], tokens[1]);
  await upload(metadata(), { token: tokens[1] });
  await upload(metadata({ visitId: otherParent.entityId }));
  const last = metadata();
  await upload(last);
  await removeVisit(otherParent.entityId);
  let response = await request('/api/visit-photos?limit=1');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  let page = await response.json();
  assert.deepEqual(
    page.photos.map((photo) => photo.id),
    [first.id],
  );
  assert.equal(page.hasMore, true);
  const cursor = page.cursor;
  page = await (await request(`/api/visit-photos?after=${cursor}&limit=1`)).json();
  assert.deepEqual(
    page.photos.map((photo) => photo.id),
    [last.id],
  );
  assert.equal(page.cursor > cursor, true);
  assert.equal(page.hasMore, false);
  const empty = await (await request(`/api/visit-photos?after=${page.cursor}`)).json();
  assert.deepEqual(empty, { photos: [], cursor: page.cursor, hasMore: false });
  for (const query of [
    'after=-1',
    'after=1.2',
    'after=9007199254740992',
    'after=1&after=2',
    'limit=0',
    'limit=501',
    'limit=x',
    'user_id=2',
  ])
    assert.equal((await request('/api/visit-photos?' + query)).status, 400);
});

it('rejects missing, duplicate, unrecognized and malformed metadata before keeping any files', async () => {
  const value = metadata();
  for (const key of ['id', 'visitId', 'operationId']) {
    for (const invalid of [undefined, '', 'not-a-uuid', '../../private'])
      assert.equal((await upload({ ...value, [key]: invalid })).status, 400);
  }
  for (const invalid of [undefined, '', ' ', 'NaN', 'Infinity', '-1', '9007199254740992'])
    assert.equal((await upload({ ...value, createdAt: invalid })).status, 400);
  assert.equal((await upload(value, { extra: [['id', value.id]] })).status, 400);
  assert.equal((await upload(value, { extra: [['userId', String(users[1])]] })).status, 400);
  assert.equal((await upload(value, { field: 'wrong-file-field' })).status, 400);
  assert.equal((await upload(value, { omitFile: true })).status, 400);
  assert.deepEqual(await files(), {});
  assert.deepEqual(await counts(), {
    visit_photos: 0,
    visit_photo_changes: 0,
    photo_sync_operations: 0,
  });
});

it('rejects invalid images, unsupported media and actual-format MIME mismatches without storing bytes', async () => {
  const gif = await sharp(png).gif().toBuffer();
  for (const options of [
    { type: 'text/plain' },
    { bytes: Buffer.from('not an image') },
    { bytes: png, type: 'image/jpeg' },
    { bytes: jpeg, type: 'image/png' },
    { bytes: gif, type: 'image/gif' },
    { bytes: png.subarray(0, 30) },
  ])
    assert.equal((await upload(metadata(), options)).status, 400);
  assert.deepEqual(await files(), {});
  assert.deepEqual(await counts(), {
    visit_photos: 0,
    visit_photo_changes: 0,
    photo_sync_operations: 0,
  });
});

it('accepts exactly 10MiB and rejects bytes beyond that limit without altering the accepted photo', async () => {
  const boundary = Buffer.concat([png, Buffer.alloc(10 * 1024 * 1024 - png.length)]);
  const value = metadata();
  const accepted = await upload(value, { bytes: boundary });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).photo.byteLength, boundary.length);
  const before = await files();
  assert.equal(
    (
      await upload(metadata(), {
        bytes: Buffer.concat([boundary, Buffer.from([0])]),
      })
    ).status,
    413,
  );
  assert.deepEqual(await files(), before);
  assert.deepEqual(await counts(), {
    visit_photos: 1,
    visit_photo_changes: 1,
    photo_sync_operations: 1,
  });
});

it('accepts the 25-million-pixel boundary and rejects larger decoded dimensions', async () => {
  const boundary = await sharp({
    create: { width: 5000, height: 5000, channels: 3, background: '#113355' },
  })
    .png()
    .toBuffer();
  assert.equal((await upload(metadata(), { bytes: boundary })).status, 200);
  const before = await files();
  const excessive = await sharp({
    create: { width: 5001, height: 5000, channels: 3, background: '#113355' },
  })
    .png()
    .toBuffer();
  assert.equal([400, 413].includes((await upload(metadata(), { bytes: excessive })).status), true);
  assert.deepEqual(await files(), before);
  assert.deepEqual(await counts(), {
    visit_photos: 1,
    visit_photo_changes: 1,
    photo_sync_operations: 1,
  });
});

it('rolls back photo metadata and receipts and removes only new files on receipt persistence failure', async () => {
  const value = metadata();
  assert.equal((await upload(value)).status, 200);
  await fs.writeFile(
    path.join(config.uploadsDir, 'unregistered-legacy.jpg'),
    'preserved legacy attachment',
  );
  const before = await files();
  const saved = await backend.db.all('SELECT * FROM visit_photos');
  await backend.db.exec(
    "CREATE TRIGGER fail_photo_receipt BEFORE INSERT ON photo_sync_operations BEGIN SELECT RAISE(ABORT, 'synthetic receipt failure'); END;",
  );
  for (const next of [metadata(), { ...value, operationId: randomUUID() }]) {
    const response = await upload(next);
    assert.equal(response.status, 500);
    assert.equal((await response.json()).message, 'An unexpected error occurred.');
    assert.deepEqual(await files(), before);
    assert.deepEqual(await backend.db.all('SELECT * FROM visit_photos'), saved);
    assert.deepEqual(await counts(), {
      visit_photos: 1,
      visit_photo_changes: 1,
      photo_sync_operations: 1,
    });
  }
  await backend.db.exec('DROP TRIGGER fail_photo_receipt');
  assert.equal((await upload(metadata())).status, 200);
});

it('cleans partial new file writes while preserving existing photo bytes and metadata', async () => {
  assert.equal((await upload(metadata())).status, 200);
  const before = await files();
  const saved = await backend.db.all('SELECT * FROM visit_photos');
  const originalWrite = fs.writeFile;
  let writes = 0;
  fs.writeFile = async (...args) => {
    if (++writes === 2) {
      await originalWrite(args[0], Buffer.from('partial synthetic thumbnail'));
      throw new Error('synthetic partial file write failure');
    }
    return originalWrite(...args);
  };
  let response;
  try {
    response = await upload(metadata());
  } finally {
    fs.writeFile = originalWrite;
  }
  assert.equal(response.status, 500);
  assert.equal((await response.json()).message, 'An unexpected error occurred.');
  assert.equal(writes, 2);
  assert.deepEqual(await files(), before);
  assert.deepEqual(await backend.db.all('SELECT * FROM visit_photos'), saved);
  assert.deepEqual(await counts(), {
    visit_photos: 1,
    visit_photo_changes: 1,
    photo_sync_operations: 1,
  });
});

for (const unreadable of [false, true])
  it(`preserves committed files after an uncertain commit result${unreadable ? ' even when cleanup ownership lookup also fails' : ''}`, async () => {
    assert.equal((await upload(metadata())).status, 200);
    const previous = await files();
    const value = metadata();
    const transaction = backend.db.transaction;
    const get = backend.db.get;
    let committed = false;
    backend.db.transaction = async (operation) => {
      const result = await transaction(operation);
      committed = true;
      throw new Error('synthetic failure after database commit');
    };
    if (unreadable)
      backend.db.get = (...args) => {
        if (committed) throw new Error('synthetic cleanup lookup failure');
        return get(...args);
      };
    let response;
    try {
      response = await upload(value);
    } finally {
      backend.db.transaction = transaction;
      backend.db.get = get;
    }
    assert.equal(response.status, 500);
    assert.equal((await response.json()).message, 'An unexpected error occurred.');
    assert.deepEqual(await counts(), {
      visit_photos: 2,
      visit_photo_changes: 2,
      photo_sync_operations: 2,
    });
    const after = await files();
    assert.equal(Object.keys(after).length, 4);
    for (const [filename, hash] of Object.entries(previous)) assert.equal(after[filename], hash);
    const replay = await upload(value);
    assert.equal(replay.status, 200);
    const result = await replay.json();
    assert.equal(result.acknowledgedId, value.operationId);
    assert.deepEqual(
      Buffer.from(await (await request(result.photo.originalPath)).arrayBuffer()),
      png,
    );
    assert.equal(
      (
        await sharp(
          Buffer.from(await (await request(result.photo.thumbnailPath)).arrayBuffer()),
        ).metadata()
      ).format,
      'jpeg',
    );
    assert.deepEqual(await files(), after);
    assert.deepEqual(await counts(), {
      visit_photos: 2,
      visit_photo_changes: 2,
      photo_sync_operations: 2,
    });
  });

it('preserves a pre-existing file when exclusive creation encounters a name collision', async () => {
  const originalOpen = fs.open;
  const originalWrite = fs.writeFile;
  let collision;
  fs.open = async (filename, flags, mode) => {
    if (
      !collision &&
      flags === 'wx' &&
      path.resolve(filename).startsWith(config.uploadsDir + path.sep)
    ) {
      collision = filename;
      await originalWrite(filename, 'another request owns this file');
    }
    return originalOpen(filename, flags, mode);
  };
  let response;
  try {
    response = await upload(metadata());
  } finally {
    fs.open = originalOpen;
  }
  assert.equal(response.status, 500);
  assert.equal(await fs.readFile(collision, 'utf8'), 'another request owns this file');
  assert.deepEqual(await counts(), {
    visit_photos: 0,
    visit_photo_changes: 0,
    photo_sync_operations: 0,
  });
  assert.equal(Object.keys(await files()).length, 1);
});

it('serializes a parent deletion racing an upload and never exposes the attachment after deletion commits', async () => {
  const value = metadata();
  const entered = gate(),
    release = gate(),
    deletionQueued = gate();
  const originalWrite = fs.writeFile;
  const originalGet = backend.db.get;
  let held = false,
    uploading,
    deleting;
  fs.writeFile = async (...args) => {
    if (!held) {
      held = true;
      entered.resolve();
      await release.promise;
    }
    return originalWrite(...args);
  };
  try {
    uploading = upload(value);
    await bounded(entered.promise);
    backend.db.get = (...args) => {
      deletionQueued.resolve();
      return originalGet(...args);
    };
    deleting = removeVisit(parent.entityId);
    await bounded(deletionQueued.promise);
    release.resolve();
    assert.equal((await uploading).status, 200);
    assert.equal((await deleting).status, 200);
  } finally {
    release.resolve();
    fs.writeFile = originalWrite;
    backend.db.get = originalGet;
    if (uploading) await uploading.catch(() => undefined);
    if (deleting) await deleting.catch(() => undefined);
  }
  assert.equal((await request(`/api/visit-photos/${value.id}/original`)).status, 404);
  assert.equal((await request(`/api/visit-photos/${value.id}/thumbnail`)).status, 404);
  assert.deepEqual((await (await request('/api/visit-photos')).json()).photos, []);
  assert.equal((await upload(value)).status, 409);
  assert.deepEqual(await counts(), {
    visit_photos: 1,
    visit_photo_changes: 1,
    photo_sync_operations: 1,
  });
  assert.equal(Object.keys(await files()).length, 2);
  assert.deepEqual(await backend.db.all('PRAGMA foreign_key_check'), []);
});
