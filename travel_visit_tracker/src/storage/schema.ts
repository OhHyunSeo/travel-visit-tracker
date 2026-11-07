export const schemaVersion = 5;

// The migration builds independent parent/child tables before replacing the old set.
export function accountTablesSql(suffix: '' | '_v3' = ''): string {
  return `
CREATE TABLE IF NOT EXISTS visits${suffix} (
  id TEXT NOT NULL, owner_id TEXT NOT NULL, session_id TEXT NOT NULL,
  region_id TEXT NOT NULL REFERENCES regions(id), started_at INTEGER NOT NULL,
  confirmed_at INTEGER NOT NULL, source TEXT NOT NULL CHECK(source IN ('gps','development')),
  deleted_at INTEGER, PRIMARY KEY(owner_id,id), UNIQUE(owner_id,session_id)
);
CREATE TABLE IF NOT EXISTS photos${suffix} (
  id TEXT NOT NULL, owner_id TEXT NOT NULL, visit_id TEXT NOT NULL,
  uri TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(owner_id,id),
  FOREIGN KEY(owner_id,visit_id) REFERENCES visits${suffix}(owner_id,id) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS outbox${suffix} (
  id TEXT NOT NULL, owner_id TEXT NOT NULL, entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL, operation TEXT NOT NULL, payload TEXT NOT NULL,
  created_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(owner_id,id)
);
CREATE TABLE IF NOT EXISTS photo_backup_metadata${suffix} (
  photo_id TEXT NOT NULL, owner_id TEXT NOT NULL, operation_id TEXT NOT NULL,
  serialized_payload TEXT NOT NULL, sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  byte_length INTEGER NOT NULL CHECK(byte_length>0 AND byte_length<=10485760),
  mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','image/png')),
  revision INTEGER CHECK(revision IS NULL OR (revision>0 AND revision<=9007199254740991)),
  original_path TEXT, thumbnail_path TEXT,
  uploaded_at INTEGER CHECK(uploaded_at IS NULL OR (uploaded_at>=0 AND uploaded_at<=9007199254740991)),
  PRIMARY KEY(owner_id,photo_id),
  FOREIGN KEY(owner_id,photo_id) REFERENCES photos${suffix}(owner_id,id) ON UPDATE CASCADE ON DELETE CASCADE
);
`;
}

export const accountIndexesSql = `
CREATE INDEX IF NOT EXISTS visits_owner_region ON visits(owner_id,region_id,confirmed_at);
CREATE INDEX IF NOT EXISTS photos_owner_visit ON photos(owner_id,visit_id);
CREATE INDEX IF NOT EXISTS outbox_owner ON outbox(owner_id,created_at);
CREATE INDEX IF NOT EXISTS photo_backup_owner ON photo_backup_metadata(owner_id,uploaded_at);
`;

export const restoreSchemaSql = `
CREATE TABLE IF NOT EXISTS restore_state (
  owner_id TEXT PRIMARY KEY, visit_cursor INTEGER NOT NULL DEFAULT 0, photo_cursor INTEGER NOT NULL DEFAULT 0,
  visit_scan INTEGER NOT NULL DEFAULT 0, photo_scan INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS restore_visits (
  owner_id TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','applied','blocked')), problem TEXT,
  PRIMARY KEY(owner_id,id)
);
CREATE TABLE IF NOT EXISTS restore_photos (
  owner_id TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','applied','blocked','deleted','existing')), problem TEXT,
  PRIMARY KEY(owner_id,id)
);
CREATE INDEX IF NOT EXISTS restore_visit_pending ON restore_visits(owner_id,state,revision);
CREATE INDEX IF NOT EXISTS restore_photo_pending ON restore_photos(owner_id,state,revision);
`;

export const restoreFileSchemaSql = `
CREATE TABLE IF NOT EXISTS restore_files (
  owner_id TEXT NOT NULL, photo_id TEXT NOT NULL, uri TEXT NOT NULL, payload TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('unchecked','valid','missing','damaged','preserved')),
  PRIMARY KEY(owner_id,photo_id,uri),
  FOREIGN KEY(owner_id,photo_id) REFERENCES photos(owner_id,id) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS restore_files_owner ON restore_files(owner_id,state);
`;

export const schemaSql = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS region_packs (id TEXT PRIMARY KEY, version TEXT NOT NULL, count INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS regions (id TEXT PRIMARY KEY, pack_id TEXT NOT NULL REFERENCES region_packs(id), name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS candidates (owner_id TEXT PRIMARY KEY, id TEXT NOT NULL, region_id TEXT NOT NULL REFERENCES regions(id), started_at INTEGER NOT NULL, last_observed_at INTEGER NOT NULL, confirmed_at INTEGER);
${accountTablesSql()}
${accountIndexesSql}
${restoreSchemaSql}
ALTER TABLE restore_state ADD COLUMN verify_scan INTEGER NOT NULL DEFAULT 0;
${restoreFileSchemaSql}
`;
