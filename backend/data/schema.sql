-- Users table for authentication
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  username TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- Create index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
-- Trips table
CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT,
  start_date DATETIME,
  end_date DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users (id)
);
-- Steps table (Location points)
CREATE TABLE IF NOT EXISTS steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER,
  user_id INTEGER NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  timestamp DATETIME,
  accuracy REAL,
  altitude REAL,
  type TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users (id),
  FOREIGN KEY (trip_id) REFERENCES trips (id)
);
-- Private photo ownership. Existing unregistered uploads are preserved, never made public.
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  region_id TEXT NOT NULL,
  filename TEXT NOT NULL UNIQUE,
  thumbnail_filename TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photos_owner_region ON photos(user_id, region_id);

-- Confirmed GPS visits and deletion markers. Client data never selects an account.
CREATE TABLE IF NOT EXISTS visits (
  user_id INTEGER NOT NULL REFERENCES users(id),
  id TEXT NOT NULL,
  session_id TEXT,
  region_id TEXT,
  started_at REAL,
  confirmed_at REAL,
  source TEXT CHECK(source = 'gps'),
  deleted_at REAL,
  revision INTEGER NOT NULL,
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, session_id),
  CHECK (deleted_at IS NOT NULL OR (session_id IS NOT NULL AND region_id IS NOT NULL AND started_at IS NOT NULL AND confirmed_at IS NOT NULL AND source IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_visits_owner_revision ON visits(user_id, revision);
CREATE TABLE IF NOT EXISTS visit_changes (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  visit_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS visit_sync_operations (
  user_id INTEGER NOT NULL REFERENCES users(id),
  operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  PRIMARY KEY (user_id, operation_id)
);
