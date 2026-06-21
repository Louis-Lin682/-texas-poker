import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { query, initDb } from '../core/db.js'

const USERNAME = process.env.ADMIN_USERNAME || 'admin'
const PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234'

async function run() {
  await initDb()

  // Ensure tables exist
  await query(`
    CREATE TABLE IF NOT EXISTS dt_admin_accounts (
      id            SERIAL PRIMARY KEY,
      username      VARCHAR(64) UNIQUE NOT NULL,
      password_hash VARCHAR(128)       NOT NULL,
      role          VARCHAR(32)        NOT NULL DEFAULT 'cs',
      suspended_at  TIMESTAMPTZ,
      created_at    TIMESTAMPTZ        NOT NULL DEFAULT NOW()
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS dt_admin_sessions (
      id         SERIAL PRIMARY KEY,
      admin_id   INTEGER NOT NULL REFERENCES dt_admin_accounts(id) ON DELETE CASCADE,
      token      VARCHAR(128) UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  // Check if already exists
  const { rows } = await query('SELECT id FROM dt_admin_accounts WHERE username = $1', [USERNAME])
  if (rows.length > 0) {
    console.log(`✓ 帳號 "${USERNAME}" 已存在，跳過建立。`)
    process.exit(0)
  }

  const hash = await bcrypt.hash(PASSWORD, 12)
  await query(
    `INSERT INTO dt_admin_accounts (username, password_hash, role) VALUES ($1, $2, 'super_admin')`,
    [USERNAME, hash]
  )

  console.log('✓ 後台帳號建立成功')
  console.log(`  帳號：${USERNAME}`)
  console.log(`  密碼：${PASSWORD}`)
  console.log(`  角色：super_admin`)
  console.log('')
  console.log('請登入後立即修改密碼。')
  process.exit(0)
}

run().catch(err => { console.error(err); process.exit(1) })
