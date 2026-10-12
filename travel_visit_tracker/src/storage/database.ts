import * as SQLite from 'expo-sqlite';
import { regionPack, regions } from '../data/regions';
import { Repository } from './repository';

let opened: Promise<Repository> | null = null;
export function getRepository(): Promise<Repository> {
  if (!opened)
    opened = (async () => {
      const db = await SQLite.openDatabaseAsync('trip-painting-v1.db');
      await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
      const repository = new Repository({
        exec: (sql) => db.execAsync(sql),
        run: (sql, ...params) => db.runAsync(sql, ...params),
        first: (sql, ...params) => db.getFirstAsync(sql, ...params),
        all: (sql, ...params) => db.getAllAsync(sql, ...params),
      });
      await repository.initialize(regionPack, regions);
      return repository;
    })().catch((error) => {
      opened = null;
      throw error;
    });
  return opened;
}
