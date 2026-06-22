import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { initDb, query } from '../core/db.js'

const username = process.env.ADMIN_USERNAME || 'admin'
const password = process.env.ADMIN_PASSWORD || 'admin1234'

await initDb()
const hash = await bcrypt.hash(password, 12)
const { rows } = await query(
  `INSERT INTO th_admin_accounts (username, password_hash, role)
   VALUES ($1, $2, 'super_admin')
   ON CONFLICT (username) DO UPDATE SET password_hash = $2
   RETURNING id, username`,
  [username, hash]
)
console.log(`[init-admin] Texas Hold'em admin account ready: ${rows[0].username} (id=${rows[0].id})`)
process.exit(0)
