-- TimeSwap — PostgreSQL schema (Neon / Supabase)
-- Run this once against your Postgres database before starting the API
-- with DATABASE_URL set. In local/demo mode (no DATABASE_URL) the server
-- creates an equivalent SQLite schema automatically — see src/db.js.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  google_id     TEXT UNIQUE NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  username      TEXT UNIQUE,
  avatar_url    TEXT,
  bio           TEXT DEFAULT '',
  onboarded     INTEGER NOT NULL DEFAULT 0, -- 0/1 (kept as integer so it matches the SQLite dev store 1:1)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS skills (
  id            SERIAL PRIMARY KEY,
  name          TEXT UNIQUE NOT NULL,
  category      TEXT NOT NULL DEFAULT 'General',
  emoji         TEXT NOT NULL DEFAULT '✨'
);

-- type: 'teach' | 'learn'
CREATE TABLE IF NOT EXISTS user_skills (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id      INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('teach', 'learn')),
  level         TEXT NOT NULL DEFAULT 'Intermediate',
  UNIQUE(user_id, skill_id, type)
);

-- day_of_week: 0 (Sun) .. 6 (Sat). start/end are 30-min-aligned "HH:MM".
CREATE TABLE IF NOT EXISTS availability (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week   INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time    TEXT NOT NULL,
  end_time      TEXT NOT NULL
);

-- status: 'pending' | 'accepted' | 'declined'
CREATE TABLE IF NOT EXISTS connections (
  id            SERIAL PRIMARY KEY,
  requester_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id      INTEGER REFERENCES skills(id),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  meet_link     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(requester_id, receiver_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_user_skills_user ON user_skills(user_id);
CREATE INDEX IF NOT EXISTS idx_user_skills_skill ON user_skills(skill_id);
CREATE INDEX IF NOT EXISTS idx_availability_user ON availability(user_id);
CREATE INDEX IF NOT EXISTS idx_connections_receiver ON connections(receiver_id);
CREATE INDEX IF NOT EXISTS idx_connections_requester ON connections(requester_id);
