import { query, initDb } from './core/db.js'
import bcrypt from 'bcryptjs'

await initDb()
const hash = await bcrypt.hash('admin123', 12)

// Upsert: 若帳號已存在則更新密碼
await query(
  `INSERT INTO dt_admin_accounts (username, password_hash, role)
   VALUES ('admin', $1, 'super_admin')
   ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'super_admin'`,
  [hash]
)
console.log('Admin upserted: admin / admin123')
process.exit(0)
