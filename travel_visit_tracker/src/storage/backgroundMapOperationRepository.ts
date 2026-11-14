import {
  backgroundMapUuid,
  readBackgroundMapPackMetadata,
  type BackgroundMapPackMetadata,
} from '../domain/backgroundMapPack';
import type { SqlConnection } from './repository';

export type BackgroundMapOperation = Readonly<{
  metadata: BackgroundMapPackMetadata;
  packId: string | null;
}>;

// SDK packs are device-wide. Keep the single provisional download in a separate database.
export class BackgroundMapOperationRepository {
  constructor(private readonly db: SqlConnection) {}

  async initialize(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS background_map_operation (
        slot INTEGER PRIMARY KEY CHECK (slot = 1),
        metadata TEXT NOT NULL CHECK (length(metadata) <= 20000),
        pack_id TEXT CHECK (pack_id IS NULL OR length(pack_id) = 36)
      );
    `);
  }

  async current(): Promise<BackgroundMapOperation | null> {
    const row = await this.db.first<{ metadata: string; packId: string | null }>(
      'SELECT metadata, pack_id AS packId FROM background_map_operation WHERE slot=1',
    );
    if (!row) return null;
    if (row.metadata.length > 20000 || (row.packId !== null && !backgroundMapUuid.test(row.packId)))
      throw new Error('Invalid saved background map operation');
    return Object.freeze({
      metadata: readBackgroundMapPackMetadata(JSON.parse(row.metadata)),
      packId: row.packId,
    });
  }

  async prepare(metadata: BackgroundMapPackMetadata): Promise<boolean> {
    const saved = JSON.stringify(readBackgroundMapPackMetadata(metadata));
    // The existing row wins even if a different operation begins at the same time.
    const result = await this.db.run(
      'INSERT INTO background_map_operation(slot, metadata) VALUES (1,?) ON CONFLICT(slot) DO NOTHING',
      saved,
    );
    return result.changes === 1;
  }

  async bindPack(expected: BackgroundMapPackMetadata, packId: string): Promise<boolean> {
    if (!backgroundMapUuid.test(packId)) throw new Error('Invalid background map SDK pack ID');
    const saved = JSON.stringify(readBackgroundMapPackMetadata(expected));
    const result = await this.db.run(
      'UPDATE background_map_operation SET pack_id=? WHERE slot=1 AND metadata=? AND (pack_id IS NULL OR pack_id=?)',
      packId,
      saved,
      packId,
    );
    return result.changes === 1;
  }
}
