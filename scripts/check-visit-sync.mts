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
  VisitConnectionError,
  VisitSyncClient,
  VisitSyncRunner,
} from "../travel_visit_tracker/src/services/visitSync.ts";
import { VisitBackupCoordinator } from "../travel_visit_tracker/src/services/visitBackup.ts";
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
  await assert.rejects(runner(lostResponse).run(), VisitConnectionError);
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
    (await repository.pendingVisitOperations()).map((operation) => ({
      ...operation,
    })),
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

  const c = await auth.signIn(
    apiUrl,
    "coordinator@example.test",
    "synthetic-coordinator-password-789",
    "Synthetic Coordinator",
  );
  session = c;
  repository = new Repository(connection, sessionOwner(c));
  await repository.activateOwner();
  const confirmSyntheticVisit = async (startedAt: number) => {
    const id = randomUUID(),
      candidateId = randomUUID();
    await repository.setRecording(true);
    for (let offset = 0; offset <= 300000; offset += 60000) {
      await repository.processObservation(
        (previous) =>
          advanceDwell(
            previous,
            {
              longitude: 127,
              latitude: 37,
              accuracy: 10,
              timestamp: startedAt + offset,
              regionId,
              boundaryDistanceM: 100,
            },
            startedAt + offset,
            () => candidateId,
          ),
        () => id,
      );
    }
    return id;
  };
  const firstBackupVisit = await confirmSyntheticVisit(epoch + 1000000);
  const coordinatorPhoto = {
    id: randomUUID(),
    visitId: firstBackupVisit,
    uri: "file:///synthetic-coordinator-photo.jpg",
    createdAt: epoch + 1400000,
  };
  await repository.addPhoto(coordinatorPhoto);
  const readPhotoWork = () =>
    connection.all(
      "SELECT * FROM outbox WHERE owner_id=? AND entity_type='photo' ORDER BY id",
      sessionOwner(c),
    );
  const originalPhotoWork = await readPhotoWork();
  let clock = epoch + 1500000;
  const coordinator = (send: typeof fetch = fetch) =>
    new VisitBackupCoordinator(
      () => session,
      async (owner) => new Repository(connection, owner),
      new VisitSyncClient(send, true),
      () => clock,
    );
  assert.equal((await repository.visitBackupState()).autoEnabled, false);
  const manualBackup = await coordinator().run(true);
  assert.equal(manualBackup.acknowledged, 1);
  assert.equal(manualBackup.paused, false);
  assert.deepEqual(await repository.visitBackupState(), {
    autoEnabled: false,
    pendingVisits: 0,
    pendingPhotos: 1,
    lastSuccessAt: clock,
    nextAttemptAt: null,
    connectionCheckAt: null,
    pauseReason: null,
  });
  assert.deepEqual(
    (await repository.snapshot(false)).photos.map((photo) => ({ ...photo })),
    [coordinatorPhoto],
  );
  assert.deepEqual(await readPhotoWork(), originalPhotoWork);
  const firstSuccessAt = clock;
  clock += 10000;
  assert.equal((await coordinator().run(true)).skipped, true);
  assert.equal(
    (await repository.visitBackupState()).lastSuccessAt,
    firstSuccessAt,
  );

  const retryVisit = await confirmSyntheticVisit(epoch + 2000000);
  await repository.setVisitBackupEnabled(true);
  const queuedBeforeLoss = await repository.pendingVisitOperations();
  assert.equal(queuedBeforeLoss.length, 1);
  assert.equal(queuedBeforeLoss[0].entityId, retryVisit);
  const losingTransport: typeof fetch = async (input, options) => {
    const response = await fetch(input, options);
    assert.equal(response.status, 200);
    assert.deepEqual(
      (await response.json()).acknowledgedIds,
      queuedBeforeLoss.map((op) => op.id),
    );
    assert.equal(
      (
        await backend.db.get(
          "SELECT COUNT(*) AS count FROM visits WHERE user_id=? AND id=?",
          c.user.id,
          retryVisit,
        )
      ).count,
      1,
    );
    throw new Error(
      "synthetic coordinator response loss after committed HTTP acknowledgement",
    );
  };
  const lostBackup = await coordinator(losingTransport).run();
  assert.equal(lostBackup.acknowledged, 0);
  assert.equal(lostBackup.paused, false);
  assert.ok(
    lostBackup.message &&
      !lostBackup.message.includes("synthetic coordinator response loss"),
  );
  const scheduledAt = clock + 30000;
  assert.deepEqual(await repository.visitBackupState(), {
    autoEnabled: true,
    pendingVisits: 1,
    pendingPhotos: 1,
    lastSuccessAt: firstSuccessAt,
    nextAttemptAt: scheduledAt,
    connectionCheckAt: scheduledAt,
    pauseReason: null,
  });
  db.close();
  db = new DatabaseSync(mobilePath);
  connection = adapter(db);
  repository = new Repository(connection, sessionOwner(c));
  assert.equal(
    (await repository.visitBackupState()).nextAttemptAt,
    scheduledAt,
  );
  assert.deepEqual(
    (await repository.pendingVisitOperations()).map((operation) => ({
      ...operation,
    })),
    queuedBeforeLoss.map((operation) => ({ ...operation, attempts: 1 })),
  );
  let retryRequests = 0;
  const retryTransport: typeof fetch = async (input, options) => {
    retryRequests++;
    const operations = JSON.parse(options!.body as string).operations;
    assert.deepEqual(
      operations.map((operation: { id: string }) => operation.id),
      queuedBeforeLoss.map((op) => op.id),
    );
    return fetch(input, options);
  };
  const resumedBackup = coordinator(retryTransport);
  assert.equal((await resumedBackup.run()).skipped, true);
  assert.equal(retryRequests, 0);
  clock = scheduledAt;
  assert.equal((await resumedBackup.run()).acknowledged, 1);
  assert.equal(retryRequests, 1);
  assert.deepEqual(await repository.visitBackupState(), {
    autoEnabled: true,
    pendingVisits: 0,
    pendingPhotos: 1,
    lastSuccessAt: clock,
    nextAttemptAt: null,
    connectionCheckAt: null,
    pauseReason: null,
  });
  assert.deepEqual(
    (await repository.snapshot(false)).photos.map((photo) => ({ ...photo })),
    [coordinatorPhoto],
  );
  assert.deepEqual(await readPhotoWork(), originalPhotoWork);
  assert.equal(
    (
      await backend.db.get(
        "SELECT COUNT(*) AS count FROM visits WHERE user_id=?",
        c.user.id,
      )
    ).count,
    2,
  );
  assert.equal(
    (
      await backend.db.get(
        "SELECT COUNT(*) AS count FROM visit_sync_operations WHERE user_id=?",
        c.user.id,
      )
    ).count,
    2,
  );
  assert.equal((await read(c)).visits.length, 2);
  console.log(
    "PASS: visit backup coordinator over temporary mobile/server SQLite and HTTP, manual opt-in bypass, photo queue/URI preservation, acknowledged-only success time, persisted retry after response loss, reopened delay skip and same-UUID replay without duplicate visits or receipts",
  );

  await confirmSyntheticVisit(epoch + 3000000);
  const recoveryWork = await repository.pendingVisitOperations();
  let unavailable = true;
  const recoveryCalls: { path: string; authorized: boolean; operationIds: string[] }[] = [];
  const recoveringTransport: typeof fetch = async (input, options) => {
    const requestPath = new URL(String(input)).pathname;
    const operations = options?.body ? JSON.parse(options.body as string).operations : [];
    recoveryCalls.push({
      path: requestPath,
      authorized: new Headers(options?.headers).has("Authorization"),
      operationIds: operations.map((operation: { id: string }) => operation.id),
    });
    if (unavailable) throw new TypeError("synthetic connection unavailable");
    return fetch(input, options);
  };
  clock = epoch + 3500000;
  const recovering = coordinator(recoveringTransport);
  assert.equal((await recovering.run()).acknowledged, 0);
  clock += 30000;
  assert.equal((await recovering.run()).acknowledged, 0);
  const waitingForConnection = await repository.visitBackupState();
  assert.equal(waitingForConnection.nextAttemptAt, clock + 60000);
  assert.equal(waitingForConnection.connectionCheckAt, clock + 30000);
  db.close();
  db = new DatabaseSync(mobilePath);
  connection = adapter(db);
  repository = new Repository(connection, sessionOwner(c));
  assert.deepEqual(await repository.visitBackupState(), waitingForConnection);
  const recoveredAfterReopen = coordinator(recoveringTransport);
  clock = waitingForConnection.connectionCheckAt! - 1;
  assert.equal((await recoveredAfterReopen.run()).skipped, true);
  assert.equal(recoveryCalls.length, 2);
  unavailable = false;
  clock++;
  assert.ok(clock < waitingForConnection.nextAttemptAt!);
  assert.equal((await recoveredAfterReopen.run()).acknowledged, 1);
  assert.deepEqual(recoveryCalls.map((call) => call.path), [
    "/api/visits/sync", "/api/visits/sync", "/health", "/api/visits/sync",
  ]);
  assert.equal(recoveryCalls[2].authorized, false);
  assert.deepEqual(recoveryCalls[2].operationIds, []);
  assert.deepEqual(recoveryCalls[3].operationIds, recoveryWork.map((operation) => operation.id));
  assert.deepEqual(await repository.visitBackupState(), {
    autoEnabled: true, pendingVisits: 0, pendingPhotos: 1, lastSuccessAt: clock,
    nextAttemptAt: null, connectionCheckAt: null, pauseReason: null,
  });
  assert.deepEqual(await readPhotoWork(), originalPhotoWork);
  assert.equal((await read(c)).visits.length, 3);
  assert.equal((await backend.db.get("SELECT COUNT(*) AS count FROM visit_sync_operations WHERE user_id=?", c.user.id)).count, 3);
  console.log("PASS: foreground connection recovery over real temporary HTTP and SQLite, persisted health-check timing after reopen, credential-free health probe and same-UUID retry before the longer delay, photo work preserved");

} finally {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );
  if (backend) await backend.close();
  db?.close();
  await rm(directory, { recursive: true, force: true });
}
