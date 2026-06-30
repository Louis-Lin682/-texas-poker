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
    ALTER TABLE ledger ADD COLUMN IF NOT EXISTS game   TEXT;
    ALTER TABLE ledger ADD COLUMN IF NOT EXISTS bet    INTEGER;
    ALTER TABLE ledger ADD COLUMN IF NOT EXISTS detail JSONB;
    ALTER TABLE users  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
    ALTER TABLE users  ADD COLUMN IF NOT EXISTS is_guest     BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE users  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    CREATE INDEX IF NOT EXISTS idx_ledger_user   ON ledger (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_users_guest   ON users  (is_guest, last_seen_at);

    CREATE TABLE IF NOT EXISTS slot_sessions (
      user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      free_spins_left INTEGER NOT NULL DEFAULT 0,
      joker_mult      INTEGER NOT NULL DEFAULT 1,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE slot_sessions ADD COLUMN IF NOT EXISTS buy_in_amount        INTEGER;
    ALTER TABLE slot_sessions ADD COLUMN IF NOT EXISTS buy_in_start_balance INTEGER;

    CREATE TABLE IF NOT EXISTS admins (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username     TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role         TEXT NOT NULL DEFAULT 'super_admin',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE admins ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'super_admin';

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token      UUID PRIMARY KEY,
      admin_id   UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS events (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title       TEXT NOT NULL,
      image_url   TEXT,
      content     TEXT,
      description TEXT,
      tag         VARCHAR(50) NOT NULL DEFAULT '限時',
      tag_color   VARCHAR(20) NOT NULL DEFAULT '#57d46f',
      is_hot      BOOLEAN NOT NULL DEFAULT false,
      start_at    TIMESTAMPTZ,
      end_at      TIMESTAMPTZ,
      is_active   BOOLEAN NOT NULL DEFAULT true,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE events ADD COLUMN IF NOT EXISTS description TEXT;
    ALTER TABLE events ADD COLUMN IF NOT EXISTS tag       VARCHAR(50) NOT NULL DEFAULT '限時';
    ALTER TABLE events ADD COLUMN IF NOT EXISTS tag_color VARCHAR(20) NOT NULL DEFAULT '#57d46f';
    ALTER TABLE events ADD COLUMN IF NOT EXISTS is_hot    BOOLEAN NOT NULL DEFAULT false;

    CREATE TABLE IF NOT EXISTS news (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title        TEXT NOT NULL,
      content      TEXT,
      image_url    TEXT,
      category     VARCHAR(20) NOT NULL DEFAULT '公告',
      published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      is_active    BOOLEAN NOT NULL DEFAULT true,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE news ADD COLUMN IF NOT EXISTS category   VARCHAR(20) NOT NULL DEFAULT '公告';
    ALTER TABLE news ADD COLUMN IF NOT EXISTS start_at   TIMESTAMPTZ;
    ALTER TABLE news ADD COLUMN IF NOT EXISTS end_at     TIMESTAMPTZ;

    CREATE TABLE IF NOT EXISTS announcements (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      content    TEXT NOT NULL,
      is_active  BOOLEAN NOT NULL DEFAULT true,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

    CREATE TABLE IF NOT EXISTS quest_definitions (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      category    VARCHAR(20) NOT NULL,
      action_type VARCHAR(50) NOT NULL,
      title       TEXT NOT NULL,
      description TEXT,
      target      INTEGER NOT NULL,
      reward      INTEGER NOT NULL,
      tier        INTEGER NOT NULL DEFAULT 1,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      is_active   BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_quests (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      quest_id   UUID NOT NULL REFERENCES quest_definitions(id) ON DELETE CASCADE,
      period_key TEXT NOT NULL,
      claimed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, quest_id, period_key)
    );
    CREATE INDEX IF NOT EXISTS idx_user_quests ON user_quests (user_id, period_key);

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
    ALTER TABLE support_tickets  ADD COLUMN IF NOT EXISTS category           TEXT    NOT NULL DEFAULT '一般問題';
    ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS is_read             BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE support_tickets  ADD COLUMN IF NOT EXISTS is_deleted_by_user BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE SEQUENCE IF NOT EXISTS support_ticket_seq START WITH 1000;
    ALTER TABLE support_tickets  ADD COLUMN IF NOT EXISTS ticket_number      BIGINT;
    UPDATE support_tickets SET ticket_number = nextval('support_ticket_seq') WHERE ticket_number IS NULL;
    CREATE TABLE IF NOT EXISTS support_config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    INSERT INTO support_config (key, value) VALUES ('auto_close_days', '7') ON CONFLICT DO NOTHING;

    CREATE TABLE IF NOT EXISTS dt_round_history (
      id          BIGSERIAL PRIMARY KEY,
      round_id    INTEGER,
      result      TEXT NOT NULL,
      dragon_rank TEXT NOT NULL,
      dragon_suit TEXT NOT NULL,
      tiger_rank  TEXT NOT NULL,
      tiger_suit  TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE dt_round_history ADD COLUMN IF NOT EXISTS round_id INTEGER;

    CREATE TABLE IF NOT EXISTS game_configs (
      slug         TEXT PRIMARY KEY,
      status       TEXT NOT NULL DEFAULT 'open',
      notice       TEXT NOT NULL DEFAULT '',
      display_name TEXT,
      image_url    TEXT,
      badge        TEXT,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE game_configs ADD COLUMN IF NOT EXISTS display_name TEXT;
    ALTER TABLE game_configs ADD COLUMN IF NOT EXISTS image_url    TEXT;
    ALTER TABLE game_configs ADD COLUMN IF NOT EXISTS badge        TEXT;
    ALTER TABLE game_configs ADD COLUMN IF NOT EXISTS category     TEXT;
    ALTER TABLE game_configs ADD COLUMN IF NOT EXISTS is_hot       BOOLEAN;
    INSERT INTO game_configs (slug, status, notice) VALUES
      ('texas-holdem',  'open', ''),
      ('big-two',       'open', ''),
      ('blackjack',     'open', ''),
      ('dragon-tiger',  'open', ''),
      ('thunder-joker', 'open', '')
    ON CONFLICT (slug) DO NOTHING;

  `)
}

export default pool
