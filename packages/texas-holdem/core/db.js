import pg from 'pg'
const { Pool } = pg

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
})

export default pool

export async function query(text, params) {
  return pool.query(text, params)
}

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id           SERIAL PRIMARY KEY,
      username     TEXT    NOT NULL UNIQUE,
      password_hash TEXT   NOT NULL,
      balance      NUMERIC NOT NULL DEFAULT 10000,
      is_bot       BOOLEAN NOT NULL DEFAULT false,
      suspended_at TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ledger (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type       TEXT    NOT NULL,
      amount     NUMERIC NOT NULL,
      bet        NUMERIC,
      room_id    TEXT,
      game       TEXT,
      detail     JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS th_admin_accounts (
      id            SERIAL PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'cs',
      suspended_at  TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS th_admin_sessions (
      token      TEXT PRIMARY KEY,
      admin_id   INTEGER NOT NULL REFERENCES th_admin_accounts(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
  console.log('[db] tables ready')
}
