import * as SQLite from 'expo-sqlite';
import { regionPack, regions } from '../data/regions';
import { BackgroundMapOperationRepository } from './backgroundMapOperationRepository';
import { Repository, type SqlConnection } from './repository';

let opened: Promise<SqlConnection> | null = null;
let backgroundMaps: Promise<BackgroundMapOperationRepository> | null = null;
const repositories = new Map<string, Repository>();

function sqliteConnection(db: SQLite.SQLiteDatabase): SqlConnection {
  return {
    exec: (sql) => db.execAsync(sql),
    run: (sql, ...params) => db.runAsync(sql, ...params),
    first: (sql, ...params) => db.getFirstAsync(sql, ...params),
    all: (sql, ...params) => db.getAllAsync(sql, ...params),
  };
}

async function getConnection(): Promise<SqlConnection> {
  if (!opened)
    opened = (async () => {
      const db = await SQLite.openDatabaseAsync('trip-painting-v1.db');
      await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
      const connection = sqliteConnection(db);
      const repository = new Repository(connection);
      await repository.initialize(regionPack, regions);
      repositories.set('guest', repository);
      return connection;
    })().catch((error) => {
      opened = null;
      throw error;
    });
  return opened;
}
export async function repositoryForOwner(ownerId: string): Promise<Repository> {
  const connection = await getConnection();
  let repository = repositories.get(ownerId);
  if (!repository) {
    repository = new Repository(connection, ownerId);
    repositories.set(ownerId, repository);
  }
  return repository;
}
export async function getRepository(): Promise<Repository> {
  const guest = await repositoryForOwner('guest');
  return repositoryForOwner(await guest.activeOwner());
}

export function getBackgroundMapOperationRepository(): Promise<BackgroundMapOperationRepository> {
  if (!backgroundMaps) {
    backgroundMaps = (async () => {
      const db = await SQLite.openDatabaseAsync('trip-painting-background-maps-v1.db');
      try {
        await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
        const repository = new BackgroundMapOperationRepository(sqliteConnection(db));
        await repository.initialize();
        return repository;
      } catch (error) {
        await db.closeAsync().catch(() => undefined);
        throw error;
      }
    })().catch((error) => {
      backgroundMaps = null;
      throw error;
    });
  }
  return backgroundMaps;
}
