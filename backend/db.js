import 'dotenv/config'
import pg from 'pg'

const { Pool } = pg

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  idleTimeoutMillis:     30_000,   // drop idle connections after 30s (before Neon kills them)
  connectionTimeoutMillis: 15_000, // allow up to 15s for Neon cold-start reconnect
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
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      balance INTEGER NOT NULL DEFAULT 100000,
      is_bot BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT false;

    CREATE TABLE IF NOT EXISTS sessions (
      token UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS favorites (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      game_id INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, game_id)
    );

    CREATE TABLE IF NOT EXISTS check_ins (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      streak INTEGER NOT NULL DEFAULT 1,
      last_check_in DATE NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ledger (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      room_id TEXT,
      game TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE ledger ADD COLUMN IF NOT EXISTS game TEXT;
    ALTER TABLE ledger ADD COLUMN IF NOT EXISTS bet  INTEGER;
    ALTER TABLE users  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger (user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS slot_sessions (
      user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      free_spins_left INTEGER NOT NULL DEFAULT 0,
      joker_mult      INTEGER NOT NULL DEFAULT 1,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS admins (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username     TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token      UUID PRIMARY KEY,
      admin_id   UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS events (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title      TEXT NOT NULL,
      image_url  TEXT,
      content    TEXT,
      start_at   TIMESTAMPTZ,
      end_at     TIMESTAMPTZ,
      is_active  BOOLEAN NOT NULL DEFAULT true,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS news (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title        TEXT NOT NULL,
      content      TEXT,
      image_url    TEXT,
      published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      is_active    BOOLEAN NOT NULL DEFAULT true,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS quests (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title       TEXT NOT NULL,
      description TEXT,
      type        TEXT NOT NULL,
      target      INTEGER NOT NULL DEFAULT 1,
      reward      INTEGER NOT NULL DEFAULT 0,
      is_active   BOOLEAN NOT NULL DEFAULT true,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject    TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_tickets_user ON support_tickets (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tickets_status ON support_tickets (status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS support_messages (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id   UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
      sender_type TEXT NOT NULL,
      content     TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_smsg_ticket ON support_messages (ticket_id, created_at ASC);
  `)
}

export default pool
