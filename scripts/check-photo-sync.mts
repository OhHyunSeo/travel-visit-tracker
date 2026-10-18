import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Server } from "node:http";
import { advanceDwell } from "../travel_visit_tracker/src/domain/dwell.ts";
import type { Photo } from "../travel_visit_tracker/src/domain/types.ts";
import {
  AuthClient,
  sessionOwner,
  type Session,
} from "../travel_visit_tracker/src/services/authClient.ts";
import {
  PhotoFileError,
  PhotoSyncClient,
  type PreparedPhotoFile,
} from "../travel_visit_tracker/src/services/photoSync.ts";
import {
  PhotoBackupCoordinator,
  type PhotoBackupConsent,
} from "../travel_visit_tracker/src/services/photoBackup.ts";
import { VisitBackupCoordinator } from "../travel_visit_tracker/src/services/visitBackup.ts";
import { VisitSyncClient } from "../travel_visit_tracker/src/services/visitSync.ts";
import {
  Repository,
  type SqlConnection,
} from "../travel_visit_tracker/src/storage/repository.ts";

const require = createRequire(new URL("../backend/server.js", import.meta.url));
const { createBackend } = require("./src/app.js");
const sharp = require("sharp");
const directory = await mkdtemp(
  join(tmpdir(), "trip-painting-photo-sync-check-"),
);
const attachmentDirectory = join(directory, "attachments");
const serverUploads = join(directory, "uploads");
const mobilePath = join(directory, "mobile.sqlite");
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
let backend: Awaited<ReturnType<typeof createBackend>> | undefined;
let server: Server | undefined;
let database: DatabaseSync | undefined;

function adapter(db: DatabaseSync): SqlConnection {
  return {
    exec: async (sql) => {
      db.exec(sql);
    },
    run: async (sql, ...params) => ({
      changes: Number(db.prepare(sql).run(...params).changes),
    }),
    first: async <T,>(sql: string, ...params: (string | number | null)[]) =>
      (db.prepare(sql).get(...params) as T | undefined) ?? null,
    all: async <T,>(sql: string, ...params: (string | number | null)[]) =>
      db.prepare(sql).all(...params) as T[],
  };
}
async function serverFileHashes(
  root = serverUploads,
  prefix = "",
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of (await readdir(root, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const name = prefix + entry.name;
    const target = join(root, entry.name);
    if (entry.isDirectory())
      Object.assign(result, await serverFileHashes(target, name + "/"));
    else result[name] = hash(await readFile(target));
  }
  return result;
}

try {
  await mkdir(attachmentDirectory);
  backend = await createBackend({
    jwtSecret: randomBytes(32).toString("hex"),
    dbPath: join(directory, "server.sqlite"),
    uploadsDir: serverUploads,
    logging: false,
  });
  server = await new Promise<Server>((resolve, reject) => {
    const listener = backend!.app.listen(0, "127.0.0.1", () =>
      resolve(listener),
    );
    listener.once("error", reject);
  });
  const apiUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const auth = new AuthClient();
  const accountA = await auth.signIn(
    apiUrl,
    "photo-a@example.test",
    "synthetic-photo-password-a",
    "Synthetic photo A",
  );
  const accountB = await auth.signIn(
    apiUrl,
    "photo-b@example.test",
    "synthetic-photo-password-b",
    "Synthetic photo B",
  );
  let session: Session | null = accountA;
  database = new DatabaseSync(mobilePath);
  let connection = adapter(database);
  const repositoryForOwner = async (owner: string) =>
    new Repository(connection, owner);
  let repository = await repositoryForOwner(sessionOwner(accountA));
  const regionId = "gb:synthetic-photo-region";
  const initialize = async () =>
    repository.initialize(
      { id: "synthetic-photo-pack", version: "test", count: 1 },
      [{ id: regionId, name: "합성 사진 지역" }],
    );
  await initialize();
  await repository.activateOwner();
  assert.equal(
    (database.prepare("PRAGMA user_version").get() as { user_version: number })
      .user_version,
    2,
  );
  const epoch = 1700000000000.25;
  let clock = epoch + 1000000;
  let photoTime = epoch + 400000;
  const png: Buffer = await sharp({
    create: { width: 8, height: 6, channels: 3, background: "#118866" },
  })
    .png()
    .toBuffer();
  const otherPng: Buffer = await sharp({
    create: { width: 8, height: 6, channels: 3, background: "#cc4422" },
  })
    .png()
    .toBuffer();
  const jpeg: Buffer = await sharp({
    create: { width: 8, height: 6, channels: 3, background: "#2244aa" },
  })
    .jpeg()
    .toBuffer();
  const consent = (account: Session): PhotoBackupConsent => {
    assert.ok(account.token);
    return { ownerId: sessionOwner(account), token: account.token };
  };
  const consentA = consent(accountA);
  const seedVisit = async (startedAt: number) => {
    const id = randomUUID(),
      candidateId = randomUUID();
    await repository.setRecording(false);
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
              timestamp: startedAt + offset,
              regionId,
              boundaryDistanceM: 100,
            },
            startedAt + offset,
            () => candidateId,
          ),
        () => id,
      );
    await repository.setRecording(false);
    return id;
  };
  const visitId = await seedVisit(epoch);
  const addPhoto = async (
    parentId: string,
    extension: string,
    bytes?: Uint8Array,
  ) => {
    const id = randomUUID();
    const filename = join(attachmentDirectory, `${id}.${extension}`);
    if (bytes !== undefined) await writeFile(filename, bytes);
    const photo: Photo = {
      id,
      visitId: parentId,
      uri: pathToFileURL(filename).href,
      createdAt: (photoTime += 0.5),
    };
    await repository.addPhoto(photo);
    return { photo, filename };
  };
  let loads = 0,
    disposals = 0;
  const fileLoader = async (uri: string): Promise<PreparedPhotoFile> => {
    const filename = fileURLToPath(uri);
    // Only this script's generated attachments may enter the loader.
    assert.equal(filename.startsWith(attachmentDirectory + "/"), true);
    if (![".jpg", ".jpeg", ".png"].includes(extname(filename)))
      throw new PhotoFileError("unsupported");
    let bytes: Buffer;
    try {
      bytes = await readFile(filename);
    } catch {
      throw new PhotoFileError("missing");
    }
    if (bytes.length > 10 * 1024 * 1024) throw new PhotoFileError("tooLarge");
    let format: string;
    try {
      const decoded = await sharp(bytes, {
        limitInputPixels: 25000000,
      }).metadata();
      format = decoded.format;
      assert.ok(["jpeg", "png"].includes(format));
    } catch {
      throw new PhotoFileError("invalid");
    }
    const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
    loads++;
    return {
      fingerprint: { sha256: hash(bytes), byteLength: bytes.length, mimeType },
      body: new Blob([new Uint8Array(bytes)], { type: mimeType }),
      dispose: async () => {
        disposals++;
      },
    };
  };
  const visitBackup = new VisitBackupCoordinator(
    () => session,
    repositoryForOwner,
    new VisitSyncClient(fetch, true),
    () => clock,
  );
  const beforePhotos = async (expected: PhotoBackupConsent) => {
    assert.ok(session?.token);
    assert.equal(sessionOwner(session), expected.ownerId);
    assert.equal(session.token, expected.token);
    await visitBackup.run(true);
    assert.equal(
      (await (await repositoryForOwner(expected.ownerId)).visitBackupState())
        .pendingVisits,
      0,
    );
  };
  const requests: {
    operationId: string;
    photoId: string;
    visitId: string;
    createdAt: string;
    sha256: string;
    status: number;
  }[] = [];
  let loseResponseFor: string | null = null;
  let switchAccountAfter: string | null = null;
  const send: typeof fetch = async (input, options) => {
    const form = options?.body;
    assert.ok(form instanceof FormData);
    const file = form.get("file");
    assert.ok(file instanceof Blob);
    const sent = {
      operationId: String(form.get("operationId")),
      photoId: String(form.get("id")),
      visitId: String(form.get("visitId")),
      createdAt: String(form.get("createdAt")),
      sha256: hash(new Uint8Array(await file.arrayBuffer())),
      status: 0,
    };
    const response = await fetch(input, options);
    sent.status = response.status;
    requests.push(sent);
    if (sent.photoId === loseResponseFor && response.status === 200) {
      loseResponseFor = null;
      await response.body?.cancel();
      throw new Error("synthetic photo response loss after server commit");
    }
    if (sent.photoId === switchAccountAfter && response.status === 200) {
      switchAccountAfter = null;
      session = accountB;
      await (await repositoryForOwner(sessionOwner(accountB))).activateOwner();
    }
    return response;
  };
  const coordinator = () =>
    new PhotoBackupCoordinator(
      () => session,
      repositoryForOwner,
      new PhotoSyncClient(send, true),
      fileLoader,
      beforePhotos,
      () => true,
      () => clock,
    );
  const countServer = async (table: string) =>
    (await backend!.db.get(`SELECT COUNT(*) AS count FROM ${table}`)).count;
  const photoMetadata = (id: string) =>
    database!
      .prepare("SELECT * FROM photo_backup_metadata WHERE photo_id=?")
      .get(id) as {
      operation_id: string;
      serialized_payload: string;
      sha256: string;
      byte_length: number;
      mime_type: string;
      revision: number | null;
      original_path: string | null;
      thumbnail_path: string | null;
      uploaded_at: number | null;
    };
  const pendingIds = async () =>
    (await repository.pendingPhotoOperations()).map(
      (operation) => operation.entityId,
    );

  const first = await addPhoto(visitId, "png", png);
  const firstOperation = (await repository.pendingPhotoOperations())[0];
  assert.ok(firstOperation);
  loseResponseFor = first.photo.id;
  const lost = await coordinator().run(consentA);
  assert.equal(lost.acknowledged, 0);
  assert.deepEqual(await pendingIds(), [first.photo.id]);
  assert.equal(await countServer("visits"), 1);
  assert.equal(await countServer("visit_photos"), 1);
  assert.equal(await countServer("photo_sync_operations"), 1);
  assert.equal(photoMetadata(first.photo.id).sha256, hash(png));
  assert.equal(photoMetadata(first.photo.id).operation_id, firstOperation.id);
  assert.equal(
    photoMetadata(first.photo.id).serialized_payload,
    firstOperation.serializedPayload,
  );
  assert.equal(photoMetadata(first.photo.id).uploaded_at, null);
  assert.deepEqual(await readFile(first.filename), png);
  const firstFiles = await serverFileHashes();
  assert.equal(Object.keys(firstFiles).length, 2);

  database.close();
  database = new DatabaseSync(mobilePath);
  connection = adapter(database);
  repository = await repositoryForOwner(sessionOwner(accountA));
  await initialize();
  assert.equal(photoMetadata(first.photo.id).sha256, hash(png));
  assert.equal(
    (await repository.pendingPhotoOperations())[0].id,
    firstOperation.id,
  );
  assert.equal((await repository.pendingPhotoOperations())[0].attempts, 1);

  // A local ACK failure must roll back remote metadata and queue deletion together.
  database.exec(
    `CREATE TRIGGER fail_photo_ack BEFORE DELETE ON outbox WHEN OLD.entity_type='photo' AND OLD.id='${firstOperation.id}' BEGIN SELECT RAISE(ABORT, 'synthetic photo ACK failure'); END;`,
  );
  const failedAck = await coordinator().run(consentA);
  assert.equal(failedAck.acknowledged, 0);
  assert.deepEqual(await pendingIds(), [first.photo.id]);
  assert.equal(photoMetadata(first.photo.id).uploaded_at, null);
  assert.equal(photoMetadata(first.photo.id).revision, null);
  assert.equal(photoMetadata(first.photo.id).original_path, null);
  assert.equal(photoMetadata(first.photo.id).thumbnail_path, null);
  assert.equal(await countServer("photo_sync_operations"), 1);
  assert.deepEqual(await serverFileHashes(), firstFiles);
  assert.deepEqual(await readFile(first.filename), png);
  database.exec("DROP TRIGGER fail_photo_ack");
  const replayed = await coordinator().run(consentA);
  assert.equal(replayed.acknowledged, 1);
  assert.deepEqual(await repository.photoBackupState(), {
    pendingPhotos: 0,
    backedUpPhotos: 1,
  });
  assert.equal(photoMetadata(first.photo.id).uploaded_at, clock);
  assert.ok(photoMetadata(first.photo.id).revision! > 0);
  assert.equal(
    photoMetadata(first.photo.id).original_path,
    `/api/visit-photos/${first.photo.id}/original`,
  );
  assert.deepEqual(await serverFileHashes(), firstFiles);
  assert.deepEqual(await readFile(first.filename), png);
  assert.equal(await countServer("visit_photos"), 1);
  assert.equal(await countServer("photo_sync_operations"), 1);
  assert.deepEqual(
    requests.slice(0, 3).map(({ status: _status, ...request }) => request),
    Array.from({ length: 3 }, () => ({
      operationId: firstOperation.id,
      photoId: first.photo.id,
      visitId,
      createdAt: String(first.photo.createdAt),
      sha256: hash(png),
    })),
  );

  const unsupported = await addPhoto(
    visitId,
    "heic",
    Buffer.from("synthetic unsupported HEIC attachment"),
  );
  const missing = await addPhoto(visitId, "jpg");
  const supported = await addPhoto(visitId, "jpg", jpeg);
  const beforeUnsupported = requests.length;
  const skipped = await coordinator().run(consentA);
  assert.equal(skipped.acknowledged, 1);
  assert.equal(skipped.skipped, 2);
  assert.equal(requests.length - beforeUnsupported, 1);
  assert.deepEqual(await pendingIds(), [
    unsupported.photo.id,
    missing.photo.id,
  ]);
  assert.equal(photoMetadata(unsupported.photo.id), undefined);
  assert.deepEqual(await readFile(supported.filename), jpeg);
  assert.equal(await countServer("visit_photos"), 2);

  const changed = await addPhoto(visitId, "png", png);
  loseResponseFor = changed.photo.id;
  await coordinator().run(consentA);
  const fixedFingerprint = { ...photoMetadata(changed.photo.id) };
  assert.equal(fixedFingerprint.sha256, hash(png));
  await writeFile(changed.filename, otherPng);
  const beforeChanged = requests.length;
  const rejectedChange = await coordinator().run(consentA);
  assert.equal(rejectedChange.acknowledged, 0);
  assert.equal(requests.length, beforeChanged);
  assert.equal(photoMetadata(changed.photo.id).sha256, fixedFingerprint.sha256);
  assert.equal(
    photoMetadata(changed.photo.id).operation_id,
    fixedFingerprint.operation_id,
  );
  assert.equal(photoMetadata(changed.photo.id).uploaded_at, null);
  assert.ok((await pendingIds()).includes(changed.photo.id));
  assert.deepEqual(await readFile(changed.filename), otherPng);
  await writeFile(changed.filename, png);
  assert.equal((await coordinator().run(consentA)).acknowledged, 1);
  assert.deepEqual(await readFile(changed.filename), png);

  const late = await addPhoto(visitId, "jpg", jpeg);
  switchAccountAfter = late.photo.id;
  const crossed = await coordinator().run(consentA);
  assert.equal(crossed.paused, true);
  assert.equal(crossed.acknowledged, 0);
  assert.equal(photoMetadata(late.photo.id).uploaded_at, null);
  assert.equal(
    (
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM outbox WHERE owner_id=? AND entity_id=?",
        )
        .get(sessionOwner(accountA), late.photo.id) as { count: number }
    ).count,
    1,
  );
  const requestsBeforeStaleConsent = requests.length;
  assert.equal((await coordinator().run(consentA)).paused, true);
  assert.equal(requests.length, requestsBeforeStaleConsent);
  const bRepository = await repositoryForOwner(sessionOwner(accountB));
  assert.deepEqual(await bRepository.photoBackupState(), {
    pendingPhotos: 0,
    backedUpPhotos: 0,
  });
  const privateList = await fetch(`${apiUrl}/api/visit-photos`, {
    headers: { Authorization: `Bearer ${accountB.token}` },
  });
  assert.deepEqual((await privateList.json()).photos, []);
  session = accountA;
  repository = await repositoryForOwner(sessionOwner(accountA));
  await repository.activateOwner();
  const lateFiles = await serverFileHashes();
  assert.equal((await coordinator().run(consentA)).acknowledged, 1);
  assert.deepEqual(await serverFileHashes(), lateFiles);
  assert.deepEqual(await readFile(late.filename), jpeg);

  const deletedVisit = await seedVisit(epoch + 2000000);
  const orphaned = await addPhoto(deletedVisit, "jpg", jpeg);
  await visitBackup.run(true);
  const deletion = await fetch(`${apiUrl}/api/visits/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accountA.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      operations: [
        {
          id: randomUUID(),
          entityType: "visit",
          entityId: deletedVisit,
          operation: "delete",
          payload: { id: deletedVisit, deletedAt: epoch + 3000000 },
        },
      ],
    }),
  });
  assert.equal(deletion.status, 200);
  const beforeDeleted = await serverFileHashes();
  const protectedParent = await coordinator().run(consentA);
  assert.equal(protectedParent.acknowledged, 0);
  assert.equal(requests.at(-1)!.status, 409);
  assert.ok((await pendingIds()).includes(orphaned.photo.id));
  assert.equal(photoMetadata(orphaned.photo.id).uploaded_at, null);
  assert.deepEqual(await readFile(orphaned.filename), jpeg);
  assert.deepEqual(await serverFileHashes(), beforeDeleted);
  assert.equal(await countServer("visit_photos"), 4);
  assert.equal(await countServer("photo_sync_operations"), 4);
  assert.deepEqual(await repository.photoBackupState(), {
    pendingPhotos: 3,
    backedUpPhotos: 4,
  });
  assert.deepEqual(await readFile(unsupported.filename), Buffer.from("synthetic unsupported HEIC attachment"));
  await assert.rejects(readFile(missing.filename), { code: "ENOENT" });
  assert.equal(
    (await repository.snapshot(false)).photos.find((photo) => photo.id === first.photo.id)!.uri,
    first.photo.uri,
  );
  assert.equal(loads, disposals);
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(
    (
      database.prepare("PRAGMA integrity_check").get() as {
        integrity_check: string;
      }
    ).integrity_check,
    "ok",
  );
  console.log(
    "PASS: synthetic photo HTTP sync, visit-first ordering, lost-response/DB-reopen replay, atomic local ACK, file/fingerprint preservation, unsupported/missing files, changed bytes, account isolation and deleted-parent protection",
  );
} finally {
  try {
    if (server)
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => (error ? reject(error) : resolve())),
      );
  } finally {
    try {
      database?.close();
    } finally {
      try {
        if (backend) await backend.close();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
}
