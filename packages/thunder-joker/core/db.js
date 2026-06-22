import 'dotenv/config'
import pg from 'pg'

const { Pool } = pg

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  idleTimeoutMillis:       30_000,
  connectionTimeoutMillis: 15_000,
  max: 5,
})

const RETRYABLE = ['Connection terminated', 'Connection refused', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED']

export async function query(sql, params) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await pool.query(sql, params)
    } catch (err) {
      const retryable = RETRYABLE.some(msg => err.message?.includes(msg))
      if (attempt < 2 && retryable) {
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
        continue
      }
      throw err
    }
  }
}

export async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      balance       NUMERIC(12,2) NOT NULL DEFAULT 10000,
      is_bot        BOOLEAN NOT NULL DEFAULT false,
      suspended_at  TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_bot       BOOLEAN     NOT NULL DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;

    CREATE TABLE IF NOT EXISTS sessions (
      token      UUID PRIMARY KEY,
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS slot_sessions (
      user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      free_spins_left INTEGER      NOT NULL DEFAULT 0,
      joker_mult      NUMERIC(4,1) NOT NULL DEFAULT 1,
      updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ledger (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type       TEXT NOT NULL,
      amount     NUMERIC(12,2) NOT NULL,
      bet        NUMERIC(12,2),
      game       TEXT NOT NULL DEFAULT 'thunder-joker',
      detail     JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE ledger ADD COLUMN IF NOT EXISTS bet    NUMERIC(12,2);
    ALTER TABLE ledger ADD COLUMN IF NOT EXISTS game   TEXT NOT NULL DEFAULT 'thunder-joker';
    ALTER TABLE ledger ADD COLUMN IF NOT EXISTS detail JSONB;
    CREATE INDEX IF NOT EXISTS idx_tj_ledger_user ON ledger (user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS game_config_versions (
      id         SERIAL PRIMARY KEY,
      game       VARCHAR(64)  NOT NULL,
      version    INTEGER      NOT NULL,
      config     JSONB        NOT NULL,
      changed_by VARCHAR(128) NOT NULL DEFAULT 'system',
      note       TEXT         NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_gcv_game ON game_config_versions(game);

    CREATE TABLE IF NOT EXISTS game_config_current (
      game       VARCHAR(64) PRIMARY KEY,
      version_id INTEGER     NOT NULL REFERENCES game_config_versions(id)
    );

    CREATE TABLE IF NOT EXISTS tj_admin_accounts (
      id            SERIAL PRIMARY KEY,
      username      VARCHAR(64) UNIQUE NOT NULL,
      password_hash VARCHAR(128)       NOT NULL,
      role          VARCHAR(32)        NOT NULL DEFAULT 'cs',
      suspended_at  TIMESTAMPTZ,
      created_at    TIMESTAMPTZ        NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tj_admin_sessions (
      id         SERIAL PRIMARY KEY,
      admin_id   INTEGER NOT NULL REFERENCES tj_admin_accounts(id) ON DELETE CASCADE,
      token      VARCHAR(128) UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
}

export default pool
