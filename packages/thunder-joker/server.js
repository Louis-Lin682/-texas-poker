import 'dotenv/config'
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import pool, { query, initDb } from './core/db.js'
import { getConfig, loadConfig, configBus } from './core/config.js'
import { ThunderJokerGame } from './game/ThunderJokerGame.js'

process.on('uncaughtException',  (err) => console.error('[uncaughtException]',  err))
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err))

const PORT        = Number(process.env.PORT        || 4200)
const CORS_ORIGIN = process.env.CORS_ORIGIN        || 'http://localhost:5273'

const thunderJoker = new ThunderJokerGame({ getConfig })

// ── Helpers ───────────────────────────────────────────────────────────────────

function cors(res, origin = CORS_ORIGIN) {
  res.setHeader('Access-Control-Allow-Origin',  origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
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

async function getSessionUser(req) {
  const auth = req.headers.authorization || ''
  if (!auth.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  const { rows } = await query(
    'SELECT u.* FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.token = $1',
    [token]
  )
  return rows[0] ?? null
}

function toPublicUser(u) {
  return { id: u.id, username: u.username, balance: Number(u.balance), suspended_at: u.suspended_at ?? null }
}

// ── Slot session cache ────────────────────────────────────────────────────────

const slotSessions = new Map()

async function loadSlotSession(userId, client) {
  if (slotSessions.has(userId)) return slotSessions.get(userId)
  const { rows } = await client.query(
    'SELECT free_spins_left, joker_mult FROM slot_sessions WHERE user_id = $1', [userId]
  )
  const cfg  = getConfig()
  const jMax = cfg['joker.max'] ?? 10
  const sess = rows.length > 0
    ? { freeSpinsLeft: rows[0].free_spins_left, jokerMult: Math.min(Number(rows[0].joker_mult), jMax) }
    : { freeSpinsLeft: 0, jokerMult: 1 }
  slotSessions.set(userId, sess)
  return sess
}

async function saveSlotSession(userId, session, client) {
  await client.query(
    `INSERT INTO slot_sessions (user_id, free_spins_left, joker_mult, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET free_spins_left = EXCLUDED.free_spins_left,
           joker_mult      = EXCLUDED.joker_mult,
           updated_at      = NOW()`,
    [userId, session.freeSpinsLeft, session.jokerMult]
  )
}

configBus.on('updated', () => slotSessions.clear())

// ── Router ────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || CORS_ORIGIN
  const url    = new URL(req.url, 'http://localhost')
  const path   = url.pathname

  if (req.method === 'OPTIONS') { cors(res, origin); res.writeHead(204); res.end(); return }

  try {

    // ── Auth ──────────────────────────────────────────────────────────────────

    if (req.method === 'POST' && path === '/auth/register') {
      const { username, password } = await readBody(req)
      if (!username?.trim() || !password) {
        return sendJson(res, 400, { message: 'Username and password required.' }, origin)
      }
      const hash = await bcrypt.hash(password, 12)
      try {
        const { rows } = await query(
          `INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING *`,
          [username.trim(), hash]
        )
        const token = randomUUID()
        await query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, rows[0].id])
        return sendJson(res, 201, { token, user: toPublicUser(rows[0]) }, origin)
      } catch (e) {
        if (e.code === '23505') return sendJson(res, 409, { message: '帳號已存在。' }, origin)
        throw e
      }
    }

    if (req.method === 'POST' && path === '/auth/login') {
      const { username, password } = await readBody(req)
      const { rows } = await query(
        'SELECT * FROM users WHERE LOWER(username) = LOWER($1) AND is_bot = false', [username]
      )
      const user = rows[0]
      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return sendJson(res, 401, { message: '帳號或密碼錯誤。' }, origin)
      }
      if (user.suspended_at) {
        return sendJson(res, 403, { message: '帳號已停用。' }, origin)
      }
      const token = randomUUID()
      await query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, user.id])
      return sendJson(res, 200, { token, user: toPublicUser(user) }, origin)
    }

    if (req.method === 'GET' && path === '/auth/me') {
      const user = await getSessionUser(req)
      if (!user) return sendJson(res, 401, { message: 'Unauthorized.' }, origin)
      return sendJson(res, 200, { user: toPublicUser(user) }, origin)
    }

    // ── Slots ─────────────────────────────────────────────────────────────────

    if (req.method === 'GET' && path === '/slots/config') {
      const cfg = getConfig()
      return sendJson(res, 200, {
        min_bet:         cfg['min_bet'],
        max_bet:         cfg['max_bet'],
        win_level_big:   cfg['win_level.big'],
        win_level_mega:  cfg['win_level.mega'],
        win_level_epic:  cfg['win_level.epic'],
        win_level_super: cfg['win_level.super'],
      }, origin)
    }

    if (req.method === 'GET' && path === '/slots/session') {
      const user = await getSessionUser(req)
      if (!user) return sendJson(res, 401, { message: 'Unauthorized.' }, origin)
      const { rows } = await query(
        'SELECT free_spins_left, joker_mult FROM slot_sessions WHERE user_id = $1', [user.id]
      )
      return sendJson(res, 200, {
        freeSpinsLeft: rows[0]?.free_spins_left ?? 0,
        jokerMult:     rows[0]?.joker_mult ?? 1,
      }, origin)
    }

    if (req.method === 'POST' && path === '/slots/spin') {
      const user = await getSessionUser(req)
      if (!user) return sendJson(res, 401, { message: 'Unauthorized.' }, origin)

      const body = await readBody(req)
      const bet  = Number(body.bet)
      const cfg  = getConfig()
      if (!Number.isFinite(bet) || bet <= 0 || bet < cfg['min_bet'] || bet > cfg['max_bet']) {
        return sendJson(res, 400, { message: 'Invalid bet.' }, origin)
      }

      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const { rows: urows } = await client.query(
          'SELECT balance FROM users WHERE id = $1 FOR UPDATE', [user.id]
        )
        const balBefore = Number(urows[0].balance)
        const session   = await loadSlotSession(user.id, client)
        const isFree    = session.freeSpinsLeft > 0

        if (!isFree && balBefore < bet) {
          await client.query('ROLLBACK')
          return sendJson(res, 400, { message: '餘額不足。' }, origin)
        }

        const result = thunderJoker.spin({ bet, isFree, session })
        const { grid, hits, total, winTotal, scatters, lightningCell,
                jokerMultGained, jokerImgKey, freeSpinsGranted } = result
        const newSession  = result.session
        const newBalance  = balBefore - (isFree ? 0 : bet) + winTotal
        const netAmount   = isFree ? winTotal : winTotal - bet

        await client.query('UPDATE users SET balance = $1 WHERE id = $2', [newBalance, user.id])

        if (netAmount !== 0) {
          await client.query(
            `INSERT INTO ledger (user_id, type, amount, bet, game) VALUES ($1, $2, $3, $4, 'thunder-joker')`,
            [user.id, winTotal > 0 ? 'win' : 'loss', netAmount, bet]
          )
        }

        await saveSlotSession(user.id, newSession, client)
        slotSessions.set(user.id, newSession)
        await client.query('COMMIT')

        return sendJson(res, 200, {
          grid, hits, total, winTotal, newBalance, scatters,
          freeSpinsGranted, freeSpinsLeft: newSession.freeSpinsLeft,
          jokerMult: newSession.jokerMult, jokerMultGained, jokerImgKey,
          lightningCell,
        }, origin)
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
    }

    if (req.method === 'POST' && path === '/slots/ledger') {
      const user = await getSessionUser(req)
      if (!user) return sendJson(res, 401, { message: 'Unauthorized.' }, origin)
      const { type, amount } = await readBody(req)
      if (!['buy_in', 'cash_out'].includes(type)) {
        return sendJson(res, 400, { message: 'Invalid type.' }, origin)
      }
      await query(
        `INSERT INTO ledger (user_id, type, amount, game) VALUES ($1, $2, $3, 'thunder-joker')`,
        [user.id, type, Number(amount)]
      )
      return sendJson(res, 200, { ok: true }, origin)
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    if (req.method === 'POST' && path === '/internal/reload-config') {
      await loadConfig()
      slotSessions.clear()
      return sendJson(res, 200, { ok: true }, origin)
    }

    sendJson(res, 404, { message: 'Not found.' }, origin)

  } catch (err) {
    console.error('[server]', err)
    sendJson(res, 500, { message: err.message }, origin)
  }
})

// ── Boot ──────────────────────────────────────────────────────────────────────

initDb()
  .then(() => loadConfig())
  .then(() => {
    server.listen(PORT, () => console.log(`Thunder Joker server listening on :${PORT}`))
  })
  .catch(err => { console.error('Boot failed:', err); process.exit(1) })
