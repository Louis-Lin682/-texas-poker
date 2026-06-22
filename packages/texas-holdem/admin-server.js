import 'dotenv/config'
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { query, initDb } from './core/db.js'

process.on('uncaughtException',  (err) => console.error('[uncaughtException]',  err))
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err))

const ADMIN_PORT        = Number(process.env.ADMIN_PORT        || 4301)
const ADMIN_CORS_ORIGIN = process.env.ADMIN_CORS_ORIGIN        || 'http://localhost:5276'
const GAME_PORT         = Number(process.env.PORT              || 4300)

function cors(res, origin = ADMIN_CORS_ORIGIN) {
  res.setHeader('Access-Control-Allow-Origin',  origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
}

function sendJson(res, status, body, origin) {
  cors(res, origin)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end',  () => { try { resolve(JSON.parse(raw || '{}')) } catch (e) { reject(e) } })
    req.on('error', reject)
  })
}

async function getAdmin(req) {
  const auth = req.headers.authorization || ''
  if (!auth.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  const { rows } = await query(
    `SELECT a.* FROM th_admin_accounts a
     JOIN th_admin_sessions s ON s.admin_id = a.id
     WHERE s.token = $1 AND a.suspended_at IS NULL`,
    [token]
  )
  return rows[0] ?? null
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || ADMIN_CORS_ORIGIN
  const url    = new URL(req.url, 'http://localhost')
  const path   = url.pathname

  if (req.method === 'OPTIONS') { cors(res, origin); res.writeHead(204); res.end(); return }

  try {
    // ── Auth ──────────────────────────────────────────────────────────────────

    if (req.method === 'POST' && path === '/admin/login') {
      const { username, password } = await readBody(req)
      const { rows } = await query(
        'SELECT * FROM th_admin_accounts WHERE username = $1 AND suspended_at IS NULL', [username]
      )
      const admin = rows[0]
      if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
        return sendJson(res, 401, { message: '帳號或密碼錯誤。' }, origin)
      }
      const token = randomUUID()
      await query('INSERT INTO th_admin_sessions (token, admin_id) VALUES ($1, $2)', [token, admin.id])
      return sendJson(res, 200, {
        token,
        admin: { id: admin.id, username: admin.username, role: admin.role },
      }, origin)
    }

    const admin = await getAdmin(req)
    if (!admin) return sendJson(res, 401, { message: 'Unauthorized.' }, origin)

    // ── Members ───────────────────────────────────────────────────────────────

    if (req.method === 'GET' && path === '/admin/members') {
      const q    = url.searchParams.get('q') ?? ''
      const limit  = Number(url.searchParams.get('limit')  || 20)
      const offset = Number(url.searchParams.get('offset') || 0)
      const { rows } = await query(
        `SELECT id, username, balance, suspended_at, created_at
         FROM users
         WHERE is_bot = false AND ($1 = '' OR username ILIKE $2)
         ORDER BY id DESC LIMIT $3 OFFSET $4`,
        [q, `%${q}%`, limit + 1, offset]
      )
      const hasMore = rows.length > limit
      return sendJson(res, 200, { members: rows.slice(0, limit), hasMore }, origin)
    }

    if (req.method === 'PUT' && path.startsWith('/admin/members/')) {
      const userId = Number(path.split('/')[3])
      const body   = await readBody(req)
      if (body.balance !== undefined) {
        await query('UPDATE users SET balance = $1 WHERE id = $2', [body.balance, userId])
      }
      if (body.suspended !== undefined) {
        await query(
          'UPDATE users SET suspended_at = $1 WHERE id = $2',
          [body.suspended ? new Date() : null, userId]
        )
      }
      return sendJson(res, 200, { ok: true }, origin)
    }

    // ── Ledger ────────────────────────────────────────────────────────────────

    if (req.method === 'GET' && path === '/admin/ledger') {
      const userId = url.searchParams.get('user_id')
      const limit  = Number(url.searchParams.get('limit')  || 50)
      const offset = Number(url.searchParams.get('offset') || 0)
      const { rows } = await query(
        `SELECT l.id, l.type, l.amount, l.bet, l.room_id, l.game, l.created_at,
                u.username
         FROM ledger l JOIN users u ON u.id = l.user_id
         WHERE ($1::int IS NULL OR l.user_id = $1)
         ORDER BY l.id DESC LIMIT $2 OFFSET $3`,
        [userId ? Number(userId) : null, limit + 1, offset]
      )
      const hasMore = rows.length > limit
      return sendJson(res, 200, { entries: rows.slice(0, limit), hasMore }, origin)
    }

    // ── Admin accounts ────────────────────────────────────────────────────────

    if (req.method === 'GET' && path === '/admin/accounts') {
      if (admin.role !== 'super_admin') return sendJson(res, 403, { message: '權限不足' }, origin)
      const { rows } = await query(
        'SELECT id, username, role, suspended_at, created_at FROM th_admin_accounts ORDER BY id'
      )
      return sendJson(res, 200, { accounts: rows }, origin)
    }

    if (req.method === 'POST' && path === '/admin/accounts') {
      if (admin.role !== 'super_admin') return sendJson(res, 403, { message: '權限不足' }, origin)
      const { username, password, role } = await readBody(req)
      const hash = await bcrypt.hash(password, 12)
      try {
        await query(
          'INSERT INTO th_admin_accounts (username, password_hash, role) VALUES ($1, $2, $3)',
          [username, hash, role ?? 'cs']
        )
      } catch (e) {
        if (e.code === '23505') return sendJson(res, 409, { message: '帳號已存在。' }, origin)
        throw e
      }
      return sendJson(res, 201, { ok: true }, origin)
    }

    sendJson(res, 404, { message: 'Not found.' }, origin)
  } catch (err) {
    console.error('[admin-server]', err)
    sendJson(res, 500, { message: err.message }, origin)
  }
})

initDb().then(() => {
  server.listen(ADMIN_PORT, () => {
    console.log(`Texas Hold'em admin server listening on :${ADMIN_PORT}`)
  })
}).catch(err => { console.error('Boot failed:', err); process.exit(1) })
