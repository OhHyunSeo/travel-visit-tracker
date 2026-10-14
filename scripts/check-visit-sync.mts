import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Server } from "node:http";
import { advanceDwell } from "../travel_visit_tracker/src/domain/dwell.ts";
import {
  AuthClient,
  sessionOwner,
  type Session,
} from "../travel_visit_tracker/src/services/authClient.ts";
import {
  VisitSyncClient,
  VisitSyncRunner,
} from "../travel_visit_tracker/src/services/visitSync.ts";
import {
  Repository,
  type SqlConnection,
} from "../travel_visit_tracker/src/storage/repository.ts";

const require = createRequire(new URL("../backend/server.js", import.meta.url));
const { createBackend } = require("./src/app.js");
const directory = await mkdtemp(join(tmpdir(), "trip-painting-sync-check-"));
let backend: Awaited<ReturnType<typeof createBackend>>,
  server: Server | undefined,
  db: DatabaseSync | undefined;
function adapter(database: DatabaseSync): SqlConnection {
  return {
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
  };
}
try {
  backend = await createBackend({
    jwtSecret: randomBytes(32).toString("hex"),
    dbPath: join(directory, "server.sqlite"),
    uploadsDir: join(directory, "uploads"),
    logging: false,
  });
  server = await new Promise<Server>((resolve) => {
    const listener = backend.app.listen(0, "127.0.0.1", () =>
      resolve(listener),
    );
  });
  const apiUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const auth = new AuthClient();
  const a = await auth.signIn(
    apiUrl,
    "a@example.test",
    "synthetic-password-123",
    "Synthetic A",
  );
  const b = await auth.signIn(
    apiUrl,
    "b@example.test",
    "synthetic-password-456",
    "Synthetic B",
  );
  let session: Session | null = a;
  const mobilePath = join(directory, "mobile.sqlite");
  db = new DatabaseSync(mobilePath);
  let connection = adapter(db);
  let repository = new Repository(connection, sessionOwner(a));
  const regionId = "gb:synthetic-test-region";
  await repository.initialize({ id: "synthetic", version: "test", count: 1 }, [
    { id: regionId, name: "합성 지역" },
  ]);
  await repository.activateOwner();
  await repository.setRecording(true);
  const visitId = randomUUID(),
    sessionId = randomUUID(),
    epoch = 1700000000000.25;
  for (let offset = 0; offset <= 300000; offset += 60000) {
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
  }
  await repository.addPhoto({
    id: randomUUID(),
    visitId,
    uri: "file:///synthetic-photo.jpg",
    createdAt: epoch,
  });
  const lostResponse: typeof fetch = async (input, options) => {
    const response = await fetch(input, options);
    assert.equal(response.status, 200);
    throw new Error("synthetic response loss after server commit");
  };
  const runner = (send: typeof fetch = fetch) =>
    new VisitSyncRunner(
      () => session,
      async (owner) => new Repository(connection, owner),
      new VisitSyncClient(send, true),
    );
  const before = await repository.pendingVisitOperations();
  await assert.rejects(runner(lostResponse).run(), /synthetic response loss/);
  assert.equal((await repository.snapshot(false)).pending, 2);
  assert.equal(
    (await backend.db.get("SELECT COUNT(*) AS count FROM visits")).count,
    1,
  );
  db.close();
  db = new DatabaseSync(mobilePath);
  connection = adapter(db);
  repository = new Repository(connection, sessionOwner(a));
  assert.deepEqual(
    (await repository.pendingVisitOperations()).map((operation) => ({ ...operation })),
    before.map((op) => ({ ...op, attempts: 1 })),
  );
  assert.deepEqual(await runner().run(), {
    sent: 1,
    acknowledged: 1,
    paused: false,
  });
  const saved = await repository.snapshot(false);
  assert.equal(saved.pending, 1); // Photo work has its own future upload flow.
  assert.equal(saved.photos[0].uri, "file:///synthetic-photo.jpg");
  assert.equal(saved.visits[0].startedAt, epoch);
  assert.equal(
    (await backend.db.get("SELECT COUNT(*) AS count FROM visits")).count,
    1,
  );
  await repository.deleteVisit(visitId, randomUUID(), epoch + 400000);
  const switchingResponse: typeof fetch = async (input, options) => {
    const response = await fetch(input, options);
    session = b;
    await new Repository(connection, sessionOwner(b)).activateOwner();
    return response;
  };
  assert.deepEqual(await runner(switchingResponse).run(), {
    sent: 1,
    acknowledged: 0,
    paused: true,
  });
  assert.equal((await repository.snapshot(false)).pending, 1);
  assert.equal(
    (await new Repository(connection, sessionOwner(b)).snapshot(false)).pending,
    0,
  );
  const read = async (account: Session) => {
    const response = await fetch(`${apiUrl}/api/visits`, {
      headers: { Authorization: `Bearer ${account.token}` },
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  assert.deepEqual((await read(b)).visits, []);
  session = a;
  await repository.activateOwner();
  assert.deepEqual(await runner().run(), {
    sent: 1,
    acknowledged: 1,
    paused: false,
  });
  assert.equal((await read(a)).visits[0].deletedAt, epoch + 400000);
  assert.equal((await repository.snapshot(false)).pending, 0);
  console.log(
    "PASS: synthetic HTTP visit sync, lost-response replay after DB reopening, photo preservation, late ACK account isolation and tombstone replay",
  );
} finally {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );
  if (backend) await backend.close();
  db?.close();
  await rm(directory, { recursive: true, force: true });
}
