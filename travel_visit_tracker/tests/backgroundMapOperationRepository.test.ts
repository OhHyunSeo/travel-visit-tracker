import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { regions } from '../src/data/regions';
import { createBackgroundMapPackMetadata } from '../src/domain/backgroundMapPack';
import { planBackgroundMap } from '../src/domain/backgroundMapPlan';
import { BackgroundMapOperationRepository } from '../src/storage/backgroundMapOperationRepository';
import type { SqlConnection, SqlValue } from '../src/storage/repository';

const packId = '1b433638-83b7-4d7b-ae95-63c41f70abcd';
const otherId = '2b433638-83b7-4d7b-ae95-63c41f70abcd';
const plan = planBackgroundMap(regions[0].id, {
  styleSha256: 'a'.repeat(64),
  tileVersion: '20261028_120000_pt',
});
const metadata = createBackgroundMapPackMetadata(plan, {
  operationId: '3b433638-83b7-4d7b-ae95-63c41f70abcd',
  tileJsonSha256: 'b'.repeat(64),
  localStyleSha256: 'c'.repeat(64),
});

function adapter(db: DatabaseSync): SqlConnection {
  return {
    exec: async (sql) => db.exec(sql),
    run: async (sql, ...params) => ({ changes: Number(db.prepare(sql).run(...params).changes) }),
    first: async <T>(sql: string, ...params: SqlValue[]) =>
      (db.prepare(sql).get(...params) as T | undefined) ?? null,
    all: async <T>(sql: string, ...params: SqlValue[]) => db.prepare(sql).all(...params) as T[],
  };
}

let directory: string;
let path: string;
let db: DatabaseSync;
let repository: BackgroundMapOperationRepository;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'trip-painting-map-operation-'));
  path = join(directory, 'maps.sqlite');
  db = new DatabaseSync(path);
  repository = new BackgroundMapOperationRepository(adapter(db));
  await repository.initialize();
});

afterEach(() => {
  db.close();
  rmSync(directory, { force: true, recursive: true });
});

describe('saved background map operation', () => {
  it('preserves an unbound operation across reopen, then saves the matching SDK ID', async () => {
    expect(await repository.current()).toBeNull();
    expect(await repository.prepare(metadata)).toBe(true);
    db.close();
    db = new DatabaseSync(path);
    repository = new BackgroundMapOperationRepository(adapter(db));
    await repository.initialize();
    expect(await repository.current()).toEqual({ metadata, packId: null });
    expect(await repository.bindPack(metadata, packId)).toBe(true);
    db.close();
    db = new DatabaseSync(path);
    expect(await new BackgroundMapOperationRepository(adapter(db)).current()).toEqual({
      metadata,
      packId,
    });
  });

  it('preserves a single operation when two connections prepare at the same time', async () => {
    const other = new DatabaseSync(path);
    const contender = { ...metadata, operationId: otherId };
    try {
      const results = await Promise.all([
        repository.prepare(metadata),
        new BackgroundMapOperationRepository(adapter(other)).prepare(contender),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await repository.current()).toEqual({
        metadata: results[0] ? metadata : contender,
        packId: null,
      });
    } finally {
      other.close();
    }
  });

  it('rejects a different style, operation or second SDK ID while same-ID retry succeeds', async () => {
    await repository.prepare(metadata);
    expect(
      await repository.bindPack({ ...metadata, localStyleSha256: 'd'.repeat(64) }, packId),
    ).toBe(false);
    expect(await repository.bindPack({ ...metadata, operationId: otherId }, packId)).toBe(false);
    expect(await repository.bindPack(metadata, packId)).toBe(true);
    expect(await repository.bindPack(metadata, otherId)).toBe(false);
    expect(await repository.bindPack(metadata, packId)).toBe(true);
  });

  it('reports and preserves malformed stored metadata', async () => {
    db.exec("INSERT INTO background_map_operation(slot,metadata) VALUES (1,'{}')");
    await expect(repository.current()).rejects.toThrow();
    expect(await repository.prepare(metadata)).toBe(false);
    expect(db.prepare('SELECT metadata FROM background_map_operation').get()?.metadata).toBe('{}');
  });
});
