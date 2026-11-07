import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { advanceDwell } from "../travel_visit_tracker/src/domain/dwell.ts";
import {
  AuthClient,
  AuthError,
  sessionOwner,
  type Session,
} from "../travel_visit_tracker/src/services/authClient.ts";
import {
  SessionManager,
  type SessionState,
} from "../travel_visit_tracker/src/services/sessionManager.ts";
import {
  Repository,
  type SqlConnection,
} from "../travel_visit_tracker/src/storage/repository.ts";

const require = createRequire(new URL("../backend/server.js", import.meta.url));
const { createBackend } = require("./src/app.js");
const directory = await mkdtemp(join(tmpdir(), "trip-painting-auth-deadline-"));
let backend: Awaited<ReturnType<typeof createBackend>>,
  internal: Server | undefined,
  front: Server | undefined,
  db: DatabaseSync | undefined;
const adapter = (database: DatabaseSync): SqlConnection => ({
  exec: async (sql) => {
    database.exec(sql);
  },
  run: async (sql, ...args) => ({
    changes: Number(database.prepare(sql).run(...args).changes),
  }),
  first: async <T,>(sql: string, ...args: (string | number | null)[]) =>
    (database.prepare(sql).get(...args) as T | undefined) ?? null,
  all: async <T,>(sql: string, ...args: (string | number | null)[]) =>
    database.prepare(sql).all(...args) as T[],
});
const snapshot = (database: DatabaseSync, ignoreActiveOwner = false) => {
  const tables = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();
  return Object.fromEntries(
    tables.map(({ name }) => {
      assert.match(String(name), /^[a-z_]+$/);
      const rows = database
        .prepare(`SELECT * FROM ${name}`)
        .all()
        .filter(
          (row) =>
            !ignoreActiveOwner ||
            name !== "settings" ||
            row.key !== "active_owner",
        );
      return [
        String(name),
        rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      ];
    }),
  );
};
try {
  backend = await createBackend({
    jwtSecret: randomBytes(32).toString("hex"),
    dbPath: join(directory, "server.sqlite"),
    uploadsDir: join(directory, "uploads"),
    logging: false,
  });
  internal = createServer(backend.app);
  await new Promise<void>((resolve, reject) => {
    internal!.once("error", reject);
    internal!.listen(0, "127.0.0.1", resolve);
  });
  const backendPort = (internal.address() as { port: number }).port;
  let hold: "me" | "login" | null = null;
  const release: (() => void)[] = [],
    prefixes: { path: string; bytes: number }[] = [];
  front = createServer((request, response) => {
    const shouldHold = request.url === `/api/auth/${hold}`;
    const upstream = httpRequest(
      {
        hostname: "127.0.0.1",
        port: backendPort,
        path: request.url,
        method: request.method,
        headers: {
          ...request.headers,
          host: `127.0.0.1:${backendPort}`,
          connection: "close",
        },
      },
      (incoming) => {
        incoming.on("error", () => response.destroy());
        if (shouldHold && incoming.statusCode === 200) {
          const chunks: Buffer[] = [];
          incoming.on("data", (chunk) => chunks.push(chunk));
          incoming.on("end", () => {
            const bytes = Buffer.concat(chunks);
            response.writeHead(200, {
              "Content-Type": "application/json",
              "Content-Length": bytes.length,
            });
            response.write(bytes.subarray(0, 16));
            prefixes.push({ path: request.url!, bytes: 16 });
            release.push(() => {
              if (!response.destroyed) response.end(bytes.subarray(16));
            });
          });
        } else {
          response.writeHead(incoming.statusCode || 502, incoming.headers);
          incoming.pipe(response);
        }
      },
    );
    upstream.on("error", () => response.destroy());
    request.on("error", () => upstream.destroy());
    request.pipe(upstream);
  });
  await new Promise<void>((resolve, reject) => {
    front!.once("error", reject);
    front!.listen(0, "127.0.0.1", resolve);
  });
  const apiUrl = `http://127.0.0.1:${(front.address() as { port: number }).port}`,
    normal = new AuthClient();
  const a = await normal.signIn(
    apiUrl,
    "a@example.test",
    "synthetic-password-a",
    "Synthetic A",
  );
  const b = await normal.signIn(
    apiUrl,
    "b@example.test",
    "synthetic-password-b",
    "Synthetic B",
  );
  const mobilePath = join(directory, "mobile.sqlite");
  db = new DatabaseSync(mobilePath);
  let connection = adapter(db);
  const regionId = "gb:synthetic-auth";
  const guest = new Repository(connection);
  await guest.initialize({ id: "synthetic", version: "qa", count: 1 }, [
    { id: regionId, name: "Synthetic auth" },
  ]);
  const image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const imagePath = join(directory, "synthetic-attachment.png");
  await writeFile(imagePath, image);
  for (const [index, owner] of ["guest", sessionOwner(a)].entries()) {
    const repository = new Repository(connection, owner),
      visitId = randomUUID(),
      sessionId = randomUUID(),
      epoch = 1700000000000.25 + index * 1000000;
    await repository.activateOwner();
    await repository.setRecording(true);
    for (let offset = 0; offset <= 300000; offset += 60000)
      await repository.processObservation(
        (previous) =>
          advanceDwell(
            previous,
            {
              longitude: 127,
              latitude: 37,
              accuracy: 10,
              timestamp: epoch + offset,
              regionId,
              boundaryDistanceM: 100,
            },
            epoch + offset,
            () => sessionId,
          ),
        () => visitId,
      );
    await repository.setRecording(false);
    await repository.addPhoto({
      id: randomUUID(),
      visitId,
      uri: imagePath,
      createdAt: epoch + 400000,
    });
  }
  let credential: string | null = JSON.stringify(a),
    state: SessionState = { session: null, status: "guest" };
  let writes = 0,
    clears = 0,
    pauses = 0,
    imports = 0;
  const transport: typeof fetch = (url, options) => {
    if (new URL(String(url)).pathname !== `/api/auth/${hold}`)
      return fetch(url, options);
    // Only held requests omit abort to isolate the independent deadline.
    const next = { ...options };
    delete next.signal;
    return fetch(url, next);
  };
  const manager = new SessionManager(
    {
      read: async () => credential,
      write: async (value) => {
        writes++;
        credential = value;
      },
      clear: async () => {
        clears++;
        credential = null;
      },
    },
    {
      activeOwner: () => new Repository(connection).activeOwner(),
      activate: (owner) => new Repository(connection, owner).activateOwner(),
      importGuest: async (owner) => {
        imports++;
        return new Repository(connection, owner).importGuestRecords();
      },
    },
    async () => {
      pauses++;
    },
    true,
    (next) => {
      state = next;
    },
    new AuthClient(transport),
  );
  await manager.restore();
  const before = snapshot(db),
    recordsBefore = snapshot(db, true);
  assert.equal(state.status, "offline");
  assert.equal(pauses, 0);
  hold = "me";
  let started = performance.now();
  await manager.check();
  const checkMs = performance.now() - started;
  assert.ok(checkMs >= 9900 && checkMs < 15000);
  assert.equal(state.status, "offline");
  assert.equal(credential, JSON.stringify(a));
  assert.equal(writes, 0);
  assert.equal(clears, 0);
  assert.equal(pauses, 0);
  assert.equal(imports, 0);
  assert.deepEqual(snapshot(db), before);
  assert.deepEqual(new Uint8Array(await readFile(imagePath)), image);
  release.splice(0).forEach((finish) => finish());
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(snapshot(db), before);
  assert.equal(credential, JSON.stringify(a));
  db.close();
  db = new DatabaseSync(mobilePath);
  connection = adapter(db);
  assert.deepEqual(snapshot(db), before);
  hold = "login";
  started = performance.now();
  await assert.rejects(
    manager.signIn(apiUrl, b.user.email, "synthetic-password-b"),
    (error: unknown) => error instanceof AuthError && error.status === 0,
  );
  const loginMs = performance.now() - started;
  assert.ok(loginMs >= 9900 && loginMs < 15000);
  assert.equal(credential, JSON.stringify(a));
  assert.equal(await new Repository(connection).activeOwner(), sessionOwner(a));
  assert.deepEqual(snapshot(db), before);
  release.splice(0).forEach((finish) => finish());
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(credential, JSON.stringify(a));
  assert.deepEqual(snapshot(db), before);
  hold = null;
  await manager.signIn(apiUrl, b.user.email, "synthetic-password-b");
  assert.equal(state.status, "signed-in");
  assert.equal(state.session?.user.id, b.user.id);
  assert.equal(await new Repository(connection).activeOwner(), sessionOwner(b));
  assert.equal(writes, 1);
  assert.equal(pauses, 1);
  assert.equal(imports, 0);
  const after = snapshot(db, true),
    newPrefix = `${sessionOwner(b)}:`;
  const addedSettings = after.settings.filter((row) =>
    String(row.key).startsWith(newPrefix),
  );
  assert.deepEqual(
    addedSettings.map((row) => String(row.key).slice(newPrefix.length)).sort(),
    ["diagnostics", "message", "recording", "status"],
  );
  const defaults = Object.fromEntries(
    addedSettings.map((row) => [
      String(row.key).slice(newPrefix.length),
      JSON.parse(String(row.value)),
    ]),
  );
  assert.deepEqual(defaults, {
    recording: false,
    status: "off",
    message: "계정을 바꿨습니다. 기록을 다시 켜 주세요.",
    diagnostics: {
      lastSampleAt: null,
      accuracyM: null,
      gapMs: null,
      delayMs: null,
      lastResetAt: null,
      lastResetReason: null,
      collectorMode: "off",
    },
  });
  after.settings = after.settings.filter(
    (row) => !String(row.key).startsWith(newPrefix),
  );
  assert.deepEqual(after, recordsBefore);
  assert.deepEqual(new Uint8Array(await readFile(imagePath)), image);
  assert.deepEqual(prefixes, [
    { path: "/api/auth/me", bytes: 16 },
    { path: "/api/auth/login", bytes: 16 },
  ]);
  console.log(
    `PASS: actual partial HTTP account check/login deadlines (${Math.round(checkMs)}ms/${Math.round(loginMs)}ms), unchanged saved credentials/owners/all SQLite records/photo bytes, late server-tail preservation, DB reopen and next login without guest import`,
  );
} finally {
  for (const server of [front, internal]) {
    server?.closeAllConnections();
    if (server)
      await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (backend) await backend.close();
  db?.close();
  await rm(directory, { recursive: true, force: true });
}
