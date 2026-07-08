import 'dotenv/config'
import http from 'node:http'
import bcrypt from 'bcryptjs'
import { query, initDb } from './core/db.js'
import { getConfig, saveConfig, loadConfig, getVersion } from './core/config.js'

const PORT        = Number(process.env.ADMIN_PORT || 4201)
const GAME_PORT   = Number(process.env.PORT       || 4200)
const CORS_ORIGIN = process.env.ADMIN_CORS_ORIGIN || 'http://localhost:5274'

async function notifyGameServer() {
  try {
    await fetch(`http://localhost:${GAME_PORT}/internal/reload-config`, { method: 'POST' })
  } catch {}
}

function cors(res, origin = CORS_ORIGIN) {
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
    `SELECT a.* FROM tj_admin_accounts a
     JOIN tj_admin_sessions s ON s.admin_id = a.id
     WHERE s.token = $1 AND s.expires_at > NOW()`,
    [token]
  )
  return rows[0] ?? null
}

function requireRole(...roles) {
  return async (req, res, origin) => {
    const admin = await getAdmin(req)
    if (!admin) { sendJson(res, 401, { message: 'Unauthorized' }, origin); return null }
    if (roles.length && !roles.includes(admin.role)) {
      sendJson(res, 403, { message: 'Forbidden' }, origin); return null
    }
    return admin
  }
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || CORS_ORIGIN
  const url    = new URL(req.url, 'http://localhost')
  const path   = url.pathname

  if (req.method === 'OPTIONS') { cors(res, origin); res.writeHead(204); res.end(); return }

  try {

    // ── Auth ──────────────────────────────────────────────────────────────────

    if (req.method === 'POST' && path === '/admin/login') {
      const { username, password } = await readBody(req)
      const { rows } = await query(
        'SELECT * FROM tj_admin_accounts WHERE username = $1 AND suspended_at IS NULL', [username]
      )
      const admin = rows[0]
      if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
        return sendJson(res, 401, { message: '帳號或密碼錯誤' }, origin)
      }
      const token = crypto.randomUUID()
      await query(
        `INSERT INTO tj_admin_sessions (admin_id, token, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '12 hours')`,
        [admin.id, token]
      )
      return sendJson(res, 200, { token, role: admin.role, username: admin.username }, origin)
    }

    // ── Slot config ───────────────────────────────────────────────────────────

    if (req.method === 'GET' && path === '/admin/config') {
      const admin = await requireRole()(req, res, origin)
      if (!admin) return
      return sendJson(res, 200, { config: getConfig() }, origin)
    }

    if (req.method === 'PUT' && path === '/admin/config') {
      const admin = await requireRole('super_admin', 'game_operator')(req, res, origin)
      if (!admin) return
      const { config, note } = await readBody(req)
      const versionId = await saveConfig(config, admin.username, note ?? '')
      notifyGameServer()
      return sendJson(res, 200, { versionId, config: getConfig() }, origin)
    }

    if (req.method === 'GET' && path === '/admin/config/history') {
      const admin = await requireRole()(req, res, origin)
      if (!admin) return
      const { rows } = await query(
        `SELECT id, version, config, changed_by, note, created_at
         FROM game_config_versions WHERE game = 'thunder-joker'
         ORDER BY version DESC LIMIT 50`
      )
      return sendJson(res, 200, { history: rows }, origin)
    }

    // ── RTP stats ─────────────────────────────────────────────────────────────

    if (req.method === 'GET' && path.startsWith('/admin/rtp')) {
      const admin = await requireRole('super_admin', 'finance')(req, res, origin)
      if (!admin) return
      const sinceVersion = new URL('http://x' + path).searchParams.get('since')
      const versionFilter = sinceVersion ? 'AND config_version >= $1' : ''
      const params = sinceVersion ? [Number(sinceVersion)] : []
      const { rows } = await query(`
        SELECT
          COALESCE(SUM(CASE WHEN type = 'win'  THEN amount ELSE 0 END), 0) AS total_payout,
          COALESCE(SUM(bet), 0)                                             AS total_bet,
          COUNT(*)                                                          AS spins
        FROM ledger WHERE game = 'thunder-joker' AND type IN ('win', 'loss') ${versionFilter}
      `, params)
      const r = rows[0]
      const totalBet    = Number(r.total_bet)
      const totalPayout = Number(r.total_payout)
      return sendJson(res, 200, {
        totalBet, totalPayout,
        actualRtp: totalBet > 0 ? ((totalPayout / totalBet) * 100).toFixed(2) : null,
        spins: Number(r.spins),
        currentVersion: getVersion(),
      }, origin)
    }

    // ── Members ───────────────────────────────────────────────────────────────

    if (req.method === 'GET' && path === '/admin/members') {
      const admin = await requireRole('super_admin', 'finance', 'cs')(req, res, origin)
      if (!admin) return
      const q      = url.searchParams.get('q') || ''
      const limit  = Math.min(Number(url.searchParams.get('limit')  || 20), 100)
      const offset = Math.max(Number(url.searchParams.get('offset') || 0),   0)
      const params = q ? [`%${q}%`, limit + 1, offset] : [limit + 1, offset]
      const pLimit = q ? '$2' : '$1'
      const pOff   = q ? '$3' : '$2'
      const { rows } = await query(
        `SELECT id, username, balance, suspended_at, created_at
         FROM users WHERE is_bot = false ${q ? 'AND username ILIKE $1' : ''}
         ORDER BY created_at DESC LIMIT ${pLimit} OFFSET ${pOff}`,
        params
      )
      const hasMore = rows.length > limit
      return sendJson(res, 200, { members: rows.slice(0, limit), hasMore }, origin)
    }

    if (path.match(/^\/admin\/members\/[^/]+$/) && req.method === 'PUT') {
      const admin = await requireRole('super_admin', 'finance')(req, res, origin)
      if (!admin) return
      const userId = path.split('/')[3]
      const { balance, suspended } = await readBody(req)
      if (balance !== undefined) {
        await query('UPDATE users SET balance = $1 WHERE id = $2', [balance, userId])
      }
      if (suspended !== undefined) {
        await query('UPDATE users SET suspended_at = $1 WHERE id = $2', [suspended ? new Date() : null, userId])
      }
      const { rows } = await query('SELECT id, username, balance, suspended_at FROM users WHERE id = $1', [userId])
      return sendJson(res, 200, { member: rows[0] }, origin)
    }

    // ── Ledger ────────────────────────────────────────────────────────────────

    if (req.method === 'GET' && path === '/admin/ledger') {
      const admin = await requireRole('super_admin', 'finance')(req, res, origin)
      if (!admin) return
      const limit  = Math.min(Number(url.searchParams.get('limit')  || 50), 200)
      const offset = Math.max(Number(url.searchParams.get('offset') || 0),   0)
      const userId = url.searchParams.get('user_id')
      const params = userId ? [limit + 1, offset, userId] : [limit + 1, offset]
      const filter = userId ? 'AND l.user_id = $3' : ''
      const { rows } = await query(
        `SELECT l.id, l.user_id, u.username, l.type, l.amount, l.bet, l.created_at
         FROM ledger l JOIN users u ON u.id = l.user_id
         WHERE l.game = 'thunder-joker' ${filter}
         ORDER BY l.created_at DESC LIMIT $1 OFFSET $2`,
        params
      )
      const hasMore = rows.length > limit
      return sendJson(res, 200, { entries: rows.slice(0, limit), hasMore }, origin)
    }

    // ── Admin accounts ────────────────────────────────────────────────────────

    if (req.method === 'GET' && path === '/admin/accounts') {
      const admin = await requireRole('super_admin')(req, res, origin)
      if (!admin) return
      const { rows } = await query(
        'SELECT id, username, role, suspended_at, created_at FROM tj_admin_accounts ORDER BY created_at'
      )
      return sendJson(res, 200, { accounts: rows }, origin)
    }

    if (req.method === 'POST' && path === '/admin/accounts') {
      const admin = await requireRole('super_admin')(req, res, origin)
      if (!admin) return
      const { username, password, role } = await readBody(req)
      const hash = await bcrypt.hash(password, 12)
      const { rows } = await query(
        `INSERT INTO tj_admin_accounts (username, password_hash, role)
         VALUES ($1, $2, $3) RETURNING id, username, role, created_at`,
        [username, hash, role ?? 'cs']
      )
      return sendJson(res, 201, { account: rows[0] }, origin)
    }

    sendJson(res, 404, { message: 'Not found' }, origin)

  } catch (err) {
    console.error('[admin-server]', err)
    sendJson(res, 500, { message: err.message }, origin)
  }
})

initDb()
  .then(() => loadConfig())
  .then(() => {
    server.listen(PORT, () => console.log(`Thunder Joker admin server listening on :${PORT}`))
  })
  .catch(err => { console.error('Admin boot failed:', err); process.exit(1) })
