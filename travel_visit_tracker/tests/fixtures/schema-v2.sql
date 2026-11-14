PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS region_packs (id TEXT PRIMARY KEY, version TEXT NOT NULL, count INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS regions (id TEXT PRIMARY KEY, pack_id TEXT NOT NULL REFERENCES region_packs(id), name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS candidates (owner_id TEXT PRIMARY KEY, id TEXT NOT NULL, region_id TEXT NOT NULL REFERENCES regions(id), started_at INTEGER NOT NULL, last_observed_at INTEGER NOT NULL, confirmed_at INTEGER);
CREATE TABLE IF NOT EXISTS visits (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, session_id TEXT NOT NULL, region_id TEXT NOT NULL REFERENCES regions(id), started_at INTEGER NOT NULL, confirmed_at INTEGER NOT NULL, source TEXT NOT NULL CHECK(source IN ('gps','development')), deleted_at INTEGER, UNIQUE(owner_id,session_id));
CREATE INDEX IF NOT EXISTS visits_owner_region ON visits(owner_id,region_id,confirmed_at);
CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, visit_id TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE, uri TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, operation TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS outbox_owner ON outbox(owner_id,created_at);
CREATE TABLE IF NOT EXISTS photo_backup_metadata (
  photo_id TEXT PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  serialized_payload TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  byte_length INTEGER NOT NULL CHECK(byte_length>0 AND byte_length<=10485760),
  mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','image/png')),
  revision INTEGER CHECK(revision IS NULL OR (revision>0 AND revision<=9007199254740991)),
  original_path TEXT,
  thumbnail_path TEXT,
  uploaded_at INTEGER CHECK(uploaded_at IS NULL OR (uploaded_at>=0 AND uploaded_at<=9007199254740991))
);
CREATE INDEX IF NOT EXISTS photo_backup_owner ON photo_backup_metadata(owner_id,uploaded_at);
PRAGMA user_version = 2;
