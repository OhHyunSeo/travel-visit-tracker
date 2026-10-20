import type { SqlConnection } from './repository';
import { accountIndexesSql, accountTablesSql, schemaSql, schemaVersion } from './schema';

const tables = {
  visits: 'id,owner_id,session_id,region_id,started_at,confirmed_at,source,deleted_at',
  photos: 'id,owner_id,visit_id,uri,created_at',
  outbox: 'id,owner_id,entity_type,entity_id,operation,payload,created_at,attempts',
  photo_backup_metadata:
    'photo_id,owner_id,operation_id,serialized_payload,sha256,byte_length,mime_type,revision,original_path,thumbnail_path,uploaded_at',
} as const;

// The caller holds the connection queue and one IMMEDIATE transaction, with FKs enabled.
export async function migrateSchema(db: SqlConnection): Promise<void> {
  const version = (await db.first<{ user_version: number }>('PRAGMA user_version'))?.user_version;
  if (version === undefined || version > schemaVersion)
    throw new Error('이 앱보다 새로운 데이터입니다. 앱을 업데이트해 주세요.');
  if (version < 0)
    throw new Error('저장 구조의 버전을 확인할 수 없어 기존 기록을 보존했습니다.');
  if (version === 0) {
    const existing = await db.first<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1",
    );
    if (existing) throw new Error('저장 구조의 버전을 확인할 수 없어 기존 기록을 보존했습니다.');
    await db.exec(schemaSql);
  } else if (version < 3) {
    const leftover = await db.first<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE name IN ('visits_v3','photos_v3','outbox_v3','photo_backup_metadata_v3') LIMIT 1",
    );
    if (leftover) throw new Error('저장 구조를 확인할 수 없어 기존 기록을 보존했습니다.');
    await db.exec(accountTablesSql('_v3'));
    for (const [table, columns] of Object.entries(tables)) {
      if (version === 1 && table === 'photo_backup_metadata') continue;
      await db.exec(`INSERT INTO ${table}_v3(${columns}) SELECT ${columns} FROM ${table};`);
    }
    // Drop children first. FKs stay enabled throughout; a cross-owner legacy link rolls back.
    if (version === 2) await db.exec('DROP TABLE photo_backup_metadata;');
    await db.exec('DROP TABLE photos; DROP TABLE visits; DROP TABLE outbox;');
    await db.exec(`
ALTER TABLE visits_v3 RENAME TO visits;
ALTER TABLE photos_v3 RENAME TO photos;
ALTER TABLE outbox_v3 RENAME TO outbox;
ALTER TABLE photo_backup_metadata_v3 RENAME TO photo_backup_metadata;
${accountIndexesSql}
`);
  }
  if (version < schemaVersion) {
    if (await db.first('PRAGMA foreign_key_check'))
      throw new Error('방문과 사진 연결을 확인할 수 없어 기존 기록을 보존했습니다.');
    await db.exec(`PRAGMA user_version = ${schemaVersion};`);
  }
}
