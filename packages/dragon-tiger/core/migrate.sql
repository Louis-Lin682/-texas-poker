-- Game config versioning
CREATE TABLE IF NOT EXISTS game_config_versions (
  id          SERIAL PRIMARY KEY,
  game        VARCHAR(64)  NOT NULL,
  version     INTEGER      NOT NULL,
  config      JSONB        NOT NULL,
  changed_by  VARCHAR(128) NOT NULL DEFAULT 'system',
  note        TEXT         NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gcv_game ON game_config_versions(game);

-- Pointer to current active version per game
CREATE TABLE IF NOT EXISTS game_config_current (
  game        VARCHAR(64) PRIMARY KEY,
  version_id  INTEGER NOT NULL REFERENCES game_config_versions(id)
);

-- Per-round config snapshot (for audit / dispute resolution)
CREATE TABLE IF NOT EXISTS dt_rounds (
  round_id          VARCHAR(64)  PRIMARY KEY,
  config_version_id INTEGER      REFERENCES game_config_versions(id),
  config_snapshot   JSONB        NOT NULL,
  started_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ended_at          TIMESTAMPTZ,
  total_wagered     BIGINT       NOT NULL DEFAULT 0,
  total_paid        BIGINT       NOT NULL DEFAULT 0
);
