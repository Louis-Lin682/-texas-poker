import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { query, initDb } from '../core/db.js'

const USERNAME = process.env.ADMIN_USERNAME || 'admin'
const PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234'

async function run() {
  await initDb()

  const { rows } = await query('SELECT id FROM tj_admin_accounts WHERE username = $1', [USERNAME])
  if (rows.length > 0) {
    console.log(`✓ 帳號 "${USERNAME}" 已存在，跳過建立。`)
    process.exit(0)
  }

  const hash = await bcrypt.hash(PASSWORD, 12)
  await query(
    `INSERT INTO tj_admin_accounts (username, password_hash, role) VALUES ($1, $2, 'super_admin')`,
    [USERNAME, hash]
  )

  console.log('✓ 後台帳號建立成功')
  console.log(`  帳號：${USERNAME}`)
  console.log(`  密碼：${PASSWORD}`)
  console.log(`  角色：super_admin`)
  process.exit(0)
}

run().catch(err => { console.error(err); process.exit(1) })
