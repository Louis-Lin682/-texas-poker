-- Dragon Tiger Standalone — Complete Schema
-- Safe to run multiple times (all statements use IF NOT EXISTS / IF EXISTS guards).
-- The Node.js server also auto-runs this on startup via initDb(), so manual execution
-- is only needed for inspection or fresh installs via psql.

-- ── Core auth ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT        UNIQUE NOT NULL,
  password_hash TEXT        NOT NULL,
  balance       INTEGER     NOT NULL DEFAULT 100000,
  is_bot        BOOLEAN     NOT NULL DEFAULT false,
  suspended_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  token      UUID        PRIMARY KEY,
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Financial ledger ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ledger (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT        NOT NULL,
  amount     INTEGER     NOT NULL,
  detail     JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger (user_id, created_at DESC);

-- ── Game config versioning ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS game_config_versions (
  id         SERIAL      PRIMARY KEY,
  game       VARCHAR(64) NOT NULL,
  version    INTEGER     NOT NULL,
  config     JSONB       NOT NULL,
  changed_by VARCHAR(128) NOT NULL DEFAULT 'system',
  note       TEXT        NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gcv_game ON game_config_versions(game);

CREATE TABLE IF NOT EXISTS game_config_current (
  game       VARCHAR(64) PRIMARY KEY,
  version_id INTEGER     NOT NULL REFERENCES game_config_versions(id)
);

-- ── Round audit ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dt_rounds (
  round_id          VARCHAR(64)  PRIMARY KEY,
  config_version_id INTEGER      REFERENCES game_config_versions(id),
  config_snapshot   JSONB        NOT NULL,
  started_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ended_at          TIMESTAMPTZ,
  total_wagered     BIGINT       NOT NULL DEFAULT 0,
  total_paid        BIGINT       NOT NULL DEFAULT 0
);

-- Bead road / history display (one row per round)
CREATE TABLE IF NOT EXISTS dt_round_history (
  id          BIGSERIAL   PRIMARY KEY,
  result      TEXT        NOT NULL,
  dragon_rank TEXT        NOT NULL,
  dragon_suit TEXT        NOT NULL,
  tiger_rank  TEXT        NOT NULL,
  tiger_suit  TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Admin accounts ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dt_admin_accounts (
  id            SERIAL      PRIMARY KEY,
  username      VARCHAR(64) UNIQUE NOT NULL,
  password_hash VARCHAR(128)       NOT NULL,
  role          VARCHAR(32)        NOT NULL DEFAULT 'cs',
  suspended_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dt_admin_sessions (
  id         SERIAL      PRIMARY KEY,
  admin_id   INTEGER     NOT NULL REFERENCES dt_admin_accounts(id) ON DELETE CASCADE,
  token      VARCHAR(128) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
