-- Fuelio Hub D1 Schema (SQLite)
-- Run this in Cloudflare D1 dashboard

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  manufacturer TEXT,
  model TEXT,
  year INTEGER,
  vehicle_type TEXT NOT NULL CHECK(vehicle_type IN ('car','motorcycle','electric','generator','other')),
  fuel_type TEXT NOT NULL CHECK(fuel_type IN ('gasoline','high_octane','diesel','electric','other')),
  color TEXT,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vehicle_members (
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (vehicle_id, user_id)
);

CREATE TABLE IF NOT EXISTS fuel_records (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  odometer REAL NOT NULL,
  fuel_amount REAL,
  fuel_price REAL,
  total_cost REAL,
  is_full_tank INTEGER NOT NULL DEFAULT 1,
  memo TEXT,
  weather TEXT,
  latitude REAL,
  longitude REAL,
  efficiency REAL,
  station_name TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS maintenance_records (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  cost REAL,
  odometer REAL,
  maintenance_date TEXT,
  category TEXT DEFAULT 'other',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','shared','public','open')),
  rate_limit INTEGER DEFAULT 1000,
  last_used_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vehicles_owner ON vehicles(owner_id);
CREATE INDEX IF NOT EXISTS idx_fuel_vehicle ON fuel_records(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fuel_date ON fuel_records(date);
CREATE INDEX IF NOT EXISTS idx_members_user ON vehicle_members(user_id);
CREATE INDEX IF NOT EXISTS idx_members_vehicle ON vehicle_members(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_api_vehicle ON api_tokens(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
