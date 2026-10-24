import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Repository, type SqlConnection } from '../src/storage/repository';
import type { RemotePhoto, RemoteVisit } from '../src/storage/restore';
import type { Session } from '../src/services/authClient';
export const epoch = 1700000000000.25;
export const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
export const session: Session = {
  apiUrl: 'https://restore.example.test',
  user: { id: 1, email: 'synthetic@example.test', username: 'synthetic' },
  token: 'synthetic-token',
};
export const owner = `account:${session.apiUrl}:${session.user.id}`;
export const pack = { id: 'synthetic', version: 'v1', count: 1 };
export const regions = [{ id: 'A', name: 'Synthetic A' }];
export const visit = (overrides: Partial<RemoteVisit> = {}): RemoteVisit => ({
  id: randomUUID(),
  sessionId: randomUUID(),
  regionId: 'A',
  startedAt: epoch,
  confirmedAt: epoch + 300000,
  source: 'gps',
  deletedAt: null,
  revision: 1,
  ...overrides,
});
export const photo = (v: RemoteVisit, overrides: Partial<RemotePhoto> = {}): RemotePhoto => {
  const id = randomUUID();
  return {
    id,
    visitId: v.id,
    createdAt: epoch + 400000,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.length,
    mimeType: 'image/png',
    revision: 1,
    originalPath: `/api/visit-photos/${id}/original`,
    thumbnailPath: `/api/visit-photos/${id}/thumbnail`,
    ...overrides,
  };
};
export function adapter(db: DatabaseSync): SqlConnection {
  return {
    exec: async (sql) => db.exec(sql),
    run: async (sql, ...p) => ({ changes: Number(db.prepare(sql).run(...p).changes) }),
    first: async <T>(sql: string, ...p: (string | number | null)[]) =>
      (db.prepare(sql).get(...p) as T | undefined) ?? null,
    all: async <T>(sql: string, ...p: (string | number | null)[]) =>
      db.prepare(sql).all(...p) as T[],
  };
}
export async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'trip-restore-'));
  const path = join(directory, 'synthetic.sqlite');
  const db = new DatabaseSync(path),
    connection = adapter(db);
  const repo = new Repository(connection, owner);
  await repo.initialize(pack, regions);
  await repo.activateOwner();
  return {
    db,
    connection,
    repo,
    path,
    close: () => {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
export const page = <T extends { revision: number }>(items: T[]) => ({
  items,
  cursor: items.at(-1)?.revision ?? 0,
  hasMore: false,
});
