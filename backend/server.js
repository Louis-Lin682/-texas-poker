import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { existsSync, readFileSync } from 'node:fs'
import http from 'node:http'
import { randomUUID, randomInt } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import pool, { initDb, query } from './db.js'
import { RoomManager, HOUSE_USERNAME } from './game/RoomManager.js'
import { BotManager } from './game/BotManager.js'
import { GAMES, GAME_LIST } from './lottery/definitions.js'
import { initLotteryScheduler, ensureTodayDraws } from './lottery/scheduler.js'
import { settleDraw } from './lottery/settler.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// A single room's edge-case bug must never take the whole server (and every
// other room's players) down with it — log and keep serving instead of exiting.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err)
})
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err)
})

const port = Number(process.env.PORT || 4000)
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173'
const adminCorsOrigin = process.env.ADMIN_CORS_ORIGIN || 'http://localhost:5174'

const gamesFile = path.join(__dirname, 'data', 'games.json')
const games = existsSync(gamesFile) ? JSON.parse(readFileSync(gamesFile, 'utf8')) : []

const CONFIG = {
  minBuyIn: 3000,
}

// ── Slot machine (Thunder Joker) ──────────────────────────────────────────────

const slotSessions = new Map() // userId → { freeSpinsLeft, jokerMult }  (write-through cache)

async function loadSlotSession(userId, dbClient) {
  if (slotSessions.has(userId)) return slotSessions.get(userId)
  const { rows } = await dbClient.query(
    'SELECT free_spins_left, joker_mult FROM slot_sessions WHERE user_id = $1',
    [userId]
  )
  const session = rows.length > 0
    ? { freeSpinsLeft: rows[0].free_spins_left, jokerMult: Math.min(rows[0].joker_mult, 10) }
    : { freeSpinsLeft: 0, jokerMult: 1 }
  slotSessions.set(userId, session)
  return session
}

async function saveSlotSession(userId, session, dbClient) {
  await dbClient.query(
    `INSERT INTO slot_sessions (user_id, free_spins_left, joker_mult, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET free_spins_left = EXCLUDED.free_spins_left,
           joker_mult      = EXCLUDED.joker_mult,
           updated_at      = NOW()`,
    [userId, session.freeSpinsLeft, session.jokerMult]
  )
}

const SLOT_POOL = [
  ...Array(3).fill('10'), ...Array(3).fill('J'), ...Array(3).fill('Q'),
  ...Array(3).fill('K'), ...Array(3).fill('A'), ...Array(3).fill('clownhat-blue'),
  ...Array(3).fill('clownhat-golden'), ...Array(3).fill('clownhat-purple'), ...Array(3).fill('clownhat-red'),
  ...Array(8).fill('bell'), ...Array(15).fill('joker'),
  ...Array(8).fill('wild'), ...Array(2).fill('scatter'),
]

const SLOT_V = {
  wild:              [0,0,150,750,3500],
  joker:             [0,0,100,600,2000],
  bell:              [0,0,22,75,300],
  'clownhat-red':    [0,0,12,40,150],
  'clownhat-purple': [0,0,8,22,90],
  'clownhat-blue':   [0,0,6,15,60],
  'clownhat-golden': [0,0,4,12,45],
  A:                 [0,0,3,8,30],
  K:                 [0,0,2,6,22],
  Q:                 [0,0,2,5,18],
  J:                 [0,0,1,4,15],
  '10':              [0,0,1,2,10],
  scatter:           [0,0,0,0,0],
}

const SLOT_PAYLINES = [
  [0,0,0,0,0],[1,1,1,1,1],[2,2,2,2,2],[3,3,3,3,3],[4,4,4,4,4],
  [0,1,2,3,4],[4,3,2,1,0],
  [0,1,2,1,0],[0,2,4,2,0],[2,3,4,3,2],
  [4,3,2,3,4],[4,2,0,2,4],[2,1,0,1,2],
  [0,2,0,2,0],[4,2,4,2,4],
]

const SLOT_BASE_MULTS  = [2, 2, 3]
const SLOT_FS_MULTS    = [2, 3]
const SLOT_JOKER_MULTS = [1, 1, 2, 3, 5]

function slotRnd(pool) { return pool[randomInt(pool.length)] }

function slotGenGrid() {
  return Array.from({ length: 5 }, () =>
    Array.from({ length: 5 }, () => slotRnd(SLOT_POOL))
  )
}

function slotCalcWins(grid, bet) {
  let total = 0
  const hits = []
  for (let li = 0; li < SLOT_PAYLINES.length; li++) {
    const syms = SLOT_PAYLINES[li].map((row, reel) => grid[reel][row])
    const key  = syms.find(s => s !== 'wild' && s !== 'scatter') ?? 'wild'
    let cnt = 0
    for (const s of syms) {
      if (s === key || s === 'wild') cnt++
      else break
    }
    if (cnt >= 3) {
      const mult = (SLOT_V[key] ?? [])[cnt - 1] ?? 0
      if (mult > 0) { const w = mult * bet; total += w; hits.push({ li, key, cnt, w }) }
    }
  }
  let scatters = 0
  for (let r = 0; r < 5; r++)
    for (let row = 0; row < 5; row++)
      if (grid[r][row] === 'scatter') scatters++
  return { total, hits, scatters }
}

function slotJokerImgKey(mult) {
  return Math.min(Math.max(Math.round(mult), 1), 10)
}

function getCheckInReward(cycleDay) {
  if (cycleDay <= 2) return 100
  if (cycleDay <= 5) return 300
  return 800
}

function toPublicUser(user) {
  return {
    id: user.id,
    username: user.username,
    balance: user.balance,
    suspended_at: user.suspended_at ?? null,
  }
}

function sendJson(response, statusCode, payload, allowOrigin = corsOrigin) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS, PATCH',
  })
  response.end(JSON.stringify(payload))
}

function getRequestBody(request) {
  return new Promise((resolve, reject) => {
    let raw = ''
    request.on('data', (chunk) => { raw += chunk })
    request.on('end', () => {
      if (!raw) { resolve({}); return }
      try { resolve(JSON.parse(raw)) } catch (error) { reject(error) }
    })
    request.on('error', reject)
  })
}

function getTokenFromHeaders(request) {
  const authorization = request.headers.authorization || ''
  if (!authorization.startsWith('Bearer ')) return null
  return authorization.slice(7)
}

async function getSessionUser(request) {
  const token = getTokenFromHeaders(request)
  if (!token) return null

  const { rows } = await query(
    `SELECT u.* FROM users u
     JOIN sessions s ON s.user_id = u.id
     WHERE s.token = $1`,
    [token],
  )
  return rows[0] ?? null
}

async function getAdminFromToken(request) {
  const token = getTokenFromHeaders(request)
  if (!token) return null
  const { rows } = await query(
    `SELECT a.* FROM admins a
     JOIN admin_sessions s ON s.admin_id = a.id
     WHERE s.token = $1`,
    [token],
  )
  return rows[0] ?? null
}

async function getUserQuestStats(userId) {
  const { rows } = await query(`
    WITH ls AS (
      SELECT
        COUNT(*)                          FILTER (WHERE type='cash_out')::int                                                         AS games_all,
        COUNT(*)                          FILTER (WHERE type='cash_out' AND DATE(created_at)=CURRENT_DATE)::int                       AS games_today,
        COUNT(*)                          FILTER (WHERE type='cash_out' AND created_at>=DATE_TRUNC('week',NOW()))::int                 AS games_week,
        COALESCE(SUM(ABS(amount))         FILTER (WHERE type='buy_in'), 0)::bigint                                                   AS wagered_all,
        COALESCE(SUM(ABS(amount))         FILTER (WHERE type='buy_in' AND DATE(created_at)=CURRENT_DATE), 0)::bigint                  AS wagered_today,
        COALESCE(SUM(ABS(amount))         FILTER (WHERE type='buy_in' AND created_at>=DATE_TRUNC('week',NOW())), 0)::bigint           AS wagered_week,
        COALESCE(SUM(amount)              FILTER (WHERE type='hand_win'), 0)::bigint                                                 AS won_all,
        COALESCE(SUM(amount)              FILTER (WHERE type='hand_win' AND DATE(created_at)=CURRENT_DATE), 0)::bigint                AS won_today,
        COALESCE(SUM(amount)              FILTER (WHERE type='hand_win' AND created_at>=DATE_TRUNC('week',NOW())), 0)::bigint         AS won_week
      FROM ledger WHERE user_id=$1
    )
    SELECT ls.*,
      COALESCE(ci.streak, 0) AS checkin_streak,
      (SELECT COUNT(*)::int FROM favorites WHERE user_id=$1 AND DATE(created_at)=CURRENT_DATE) AS favorites_count,
      (SELECT COUNT(*)::int FROM ledger WHERE user_id=$1 AND type='deposit') AS deposit_count,
      (SELECT COALESCE(MAX(amount),0)::bigint FROM ledger WHERE user_id=$1 AND type='deposit') AS max_single_deposit
    FROM ls LEFT JOIN check_ins ci ON ci.user_id=$1
  `, [userId])
  return rows[0]
}

function calcQuestProgress(stats, actionType, category) {
  const s = stats
  switch (actionType) {
    case 'login':          return 1
    case 'games_played':   return category==='daily' ? s.games_today   : category==='weekly' ? s.games_week   : s.games_all
    case 'chips_wagered':  return category==='daily' ? Number(s.wagered_today) : category==='weekly' ? Number(s.wagered_week) : Number(s.wagered_all)
    case 'chips_won':      return category==='daily' ? Number(s.won_today)     : category==='weekly' ? Number(s.won_week)     : Number(s.won_all)
    case 'checkin_streak': return s.checkin_streak
    case 'add_favorite':      return s.favorites_count
    case 'first_deposit':     return s.deposit_count > 0 ? 1 : 0
    case 'deposit':           return Number(s.max_single_deposit ?? 0)
    default: return 0
  }
}

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    sendJson(response, 404, { message: 'Not found' })
    return
  }

  const url = new URL(request.url, `http://${request.headers.host}`)
  const pathname = url.pathname

  const reqOrigin = request.headers.origin || ''
  const effectiveCors = reqOrigin.startsWith('http://localhost:') ? reqOrigin : corsOrigin

  if (request.method === 'OPTIONS') {
    sendJson(response, 200, { ok: true }, effectiveCors)
    return
  }

  if (pathname.includes('suspend')) console.log('[DEBUG suspend]', request.method, pathname)

  // /games and /config are DB-free and always available; everything else needs DB ready
  const dbFree = pathname === '/games' || pathname === '/config'
  if (!dbReady && !dbFree) {
    sendJson(response, 503, { message: '伺服器啟動中，請稍後再試' }, effectiveCors)
    return
  }

  try {
    if (request.method === 'POST' && pathname === '/auth/register') {
      const body = await getRequestBody(request)
      const username = String(body.username || '').trim()
      const password = String(body.password || '')

      if (!username || !password) {
        sendJson(response, 400, { message: 'Username and password are required.' })
        return
      }

      const passwordHash = await bcrypt.hash(password, 12)

      try {
        const { rows } = await query(
          `INSERT INTO users (username, password_hash)
           VALUES ($1, $2)
           RETURNING id, username, balance`,
          [username, passwordHash],
        )
        sendJson(response, 201, { user: toPublicUser(rows[0]) })
      } catch (error) {
        if (error.code === '23505') {
          sendJson(response, 409, { message: 'Username already exists.' })
        } else {
          throw error
        }
      }
      return
    }

    if (request.method === 'POST' && pathname === '/auth/login') {
      const body = await getRequestBody(request)
      const username = String(body.username || '').trim()
      const password = String(body.password || '')

      const { rows } = await query(
        'SELECT * FROM users WHERE LOWER(username) = LOWER($1)',
        [username],
      )
      const user = rows[0]

      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        sendJson(response, 401, { message: 'Invalid username or password.' })
        return
      }

      const token = randomUUID()
      await query(
        'INSERT INTO sessions (token, user_id) VALUES ($1, $2)',
        [token, user.id],
      )

      sendJson(response, 200, { token, user: toPublicUser(user) })
      return
    }

    if (request.method === 'GET' && pathname === '/me') {
      const user = await getSessionUser(request)
      if (!user) {
        sendJson(response, 401, { message: 'Unauthorized.' })
        return
      }
      sendJson(response, 200, toPublicUser(user))
      return
    }

    if (request.method === 'POST' && pathname === '/auth/change-password') {
      const user = await getSessionUser(request)
      if (!user) { sendJson(response, 401, { message: 'Unauthorized.' }); return }
      const body = await getRequestBody(request)
      const current = String(body.current_password || '')
      const next    = String(body.new_password    || '')
      if (!current || !next) {
        sendJson(response, 400, { message: '請填寫目前密碼與新密碼。' }); return
      }
      if (next.length < 6) {
        sendJson(response, 400, { message: '新密碼至少需要 6 個字元。' }); return
      }
      const { rows } = await query('SELECT password_hash FROM users WHERE id=$1', [user.id])
      if (!(await bcrypt.compare(current, rows[0].password_hash))) {
        sendJson(response, 401, { message: '目前密碼不正確。' }); return
      }
      const hash = await bcrypt.hash(next, 12)
      await query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, user.id])
      sendJson(response, 200, { ok: true })
      return
    }

    if (request.method === 'GET' && pathname === '/games') {
      sendJson(response, 200, { games })
      return
    }

    if (request.method === 'GET' && pathname === '/config') {
      sendJson(response, 200, CONFIG)
      return
    }

    if (request.method === 'GET' && pathname === '/favorites') {
      const user = await getSessionUser(request)
      if (!user) {
        sendJson(response, 401, { message: 'Unauthorized.' })
        return
      }
      const { rows } = await query(
        'SELECT game_id FROM favorites WHERE user_id = $1 ORDER BY created_at',
        [user.id],
      )
      sendJson(response, 200, { favorites: rows.map((r) => r.game_id) })
      return
    }

    if (request.method === 'POST' && pathname.startsWith('/favorites/')) {
      const user = await getSessionUser(request)
      if (!user) {
        sendJson(response, 401, { message: 'Unauthorized.' })
        return
      }
      const gameId = Number(pathname.split('/').pop())
      if (!Number.isFinite(gameId)) {
        sendJson(response, 400, { message: 'Invalid game id.' })
        return
      }
      await query(
        `INSERT INTO favorites (user_id, game_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, game_id) DO NOTHING`,
        [user.id, gameId],
      )
      const { rows } = await query(
        'SELECT game_id FROM favorites WHERE user_id = $1 ORDER BY created_at',
        [user.id],
      )
      sendJson(response, 200, { favorites: rows.map((r) => r.game_id) })
      return
    }

    if (request.method === 'DELETE' && pathname.startsWith('/favorites/')) {
      const user = await getSessionUser(request)
      if (!user) {
        sendJson(response, 401, { message: 'Unauthorized.' })
        return
      }
      const gameId = Number(pathname.split('/').pop())
      if (!Number.isFinite(gameId)) {
        sendJson(response, 400, { message: 'Invalid game id.' })
        return
      }
      await query(
        'DELETE FROM favorites WHERE user_id = $1 AND game_id = $2',
        [user.id, gameId],
      )
      const { rows } = await query(
        'SELECT game_id FROM favorites WHERE user_id = $1 ORDER BY created_at',
        [user.id],
      )
      sendJson(response, 200, { favorites: rows.map((r) => r.game_id) })
      return
    }

    if (request.method === 'GET' && pathname === '/checkin') {
      const user = await getSessionUser(request)
      if (!user) { sendJson(response, 401, { message: 'Unauthorized.' }); return }

      const { rows } = await query(
        `SELECT streak,
           last_check_in = CURRENT_DATE     AS checked_today,
           last_check_in = CURRENT_DATE - 1 AS was_yesterday
         FROM check_ins WHERE user_id = $1`,
        [user.id],
      )
      const record = rows[0]

      if (!record) {
        sendJson(response, 200, { streak: 0, checked_today: false, cycle_day: 1, today_reward: 100 })
        return
      }

      if (record.checked_today) {
        const cycleDay = ((record.streak - 1) % 7) + 1
        sendJson(response, 200, { streak: record.streak, checked_today: true, cycle_day: cycleDay, today_reward: getCheckInReward(cycleDay) })
        return
      }

      if (record.was_yesterday) {
        const nextStreak = record.streak + 1
        const cycleDay = ((nextStreak - 1) % 7) + 1
        sendJson(response, 200, { streak: record.streak, checked_today: false, cycle_day: cycleDay, today_reward: getCheckInReward(cycleDay) })
        return
      }

      // Missed a day — streak will reset on next check-in
      sendJson(response, 200, { streak: 0, checked_today: false, cycle_day: 1, today_reward: 100 })
      return
    }

    if (request.method === 'POST' && pathname === '/checkin') {
      const user = await getSessionUser(request)
      if (!user) { sendJson(response, 401, { message: 'Unauthorized.' }); return }

      const { rows } = await query(
        `SELECT streak,
           last_check_in = CURRENT_DATE     AS is_today,
           last_check_in = CURRENT_DATE - 1 AS was_yesterday
         FROM check_ins WHERE user_id = $1`,
        [user.id],
      )
      const record = rows[0]

      if (record?.is_today) {
        sendJson(response, 409, { message: '今日已簽到。' })
        return
      }

      let newStreak = 1
      if (record?.was_yesterday) newStreak = record.streak + 1

      const cycleDay = ((newStreak - 1) % 7) + 1
      const reward = getCheckInReward(cycleDay)

      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(
          `INSERT INTO check_ins (user_id, streak, last_check_in)
           VALUES ($1, $2, CURRENT_DATE)
           ON CONFLICT (user_id) DO UPDATE
           SET streak = $2, last_check_in = CURRENT_DATE, updated_at = NOW()`,
          [user.id, newStreak],
        )
        const { rows: updated } = await client.query(
          'UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance',
          [reward, user.id],
        )
        await client.query(
          'INSERT INTO ledger (user_id, type, amount) VALUES ($1, $2, $3)',
          [user.id, 'checkin', reward],
        )
        await client.query('COMMIT')
        sendJson(response, 200, { streak: newStreak, cycle_day: cycleDay, reward, balance: updated[0].balance })
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
      return
    }

    if (request.method === 'POST' && pathname === '/deposit') {
      const user = await getSessionUser(request)
      if (!user) { sendJson(response, 401, { message: 'Unauthorized.' }, effectiveCors); return }
      const { amount } = await getRequestBody(request)
      const n = Math.floor(Number(amount))
      if (!n || n < 1 || n > 1_000_000) {
        sendJson(response, 400, { message: '金額無效。' }, effectiveCors); return
      }
      const FIRST_DEPOSIT_BONUS_CAP = 5_000
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        // Check if this is the user's first deposit
        const { rows: cntRows } = await client.query(
          "SELECT COUNT(*)::int AS cnt FROM ledger WHERE user_id=$1 AND type='deposit'",
          [user.id]
        )
        const isFirst = cntRows[0].cnt === 0
        // Credit deposit
        const { rows: updated } = await client.query(
          'UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance',
          [n, user.id]
        )
        await client.query(
          'INSERT INTO ledger (user_id, type, amount) VALUES ($1, $2, $3)',
          [user.id, 'deposit', n]
        )
        // First deposit bonus (100% up to cap)
        let bonus = 0
        let finalBalance = Number(updated[0].balance)
        if (isFirst) {
          bonus = Math.min(n, FIRST_DEPOSIT_BONUS_CAP)
          const { rows: bonusRows } = await client.query(
            'UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance',
            [bonus, user.id]
          )
          await client.query(
            'INSERT INTO ledger (user_id, type, amount) VALUES ($1, $2, $3)',
            [user.id, 'quest_reward', bonus]
          )
          finalBalance = Number(bonusRows[0].balance)
        }
        await client.query('COMMIT')
        sendJson(response, 200, { ok: true, amount: n, bonus, balance: finalBalance }, effectiveCors)
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
      return
    }

    if (request.method === 'GET' && pathname === '/ledger') {
      const user = await getSessionUser(request)
      if (!user) { sendJson(response, 401, { message: 'Unauthorized.' }); return }
      const limit  = Math.min(Number(url.searchParams.get('limit')  || 10), 200)
      const offset = Number(url.searchParams.get('offset') || 0)
      const game     = url.searchParams.get('game')     || null
      const dateFrom = url.searchParams.get('date_from') || null
      const dateTo   = url.searchParams.get('date_to')   || null

      const fp = [user.id]
      const where = ['user_id = $1']
      if (game)     { fp.push(game);     where.push(`game = $${fp.length}`) }
      if (dateFrom) { fp.push(dateFrom); where.push(`created_at >= $${fp.length}`) }
      if (dateTo)   { fp.push(dateTo);   where.push(`created_at < $${fp.length}`) }
      const whereStr = where.join(' AND ')

      const [{ rows }, { rows: sumRows }] = await Promise.all([
        query(
          `SELECT id, type, amount, bet, room_id, game, detail, created_at
           FROM ledger WHERE ${whereStr}
           ORDER BY created_at DESC
           LIMIT $${fp.length + 1} OFFSET $${fp.length + 2}`,
          [...fp, limit, offset],
        ),
        query(
          `SELECT COUNT(*) AS total,
                  COALESCE(SUM(CASE WHEN type IN ('buy_in','cash_out') THEN amount ELSE 0 END), 0) AS net,
                  COALESCE(SUM(CASE WHEN type = 'buy_in'   THEN ABS(amount) ELSE 0 END), 0) AS total_buy_in,
                  COALESCE(SUM(CASE WHEN type = 'cash_out' THEN amount      ELSE 0 END), 0) AS total_cash_out
           FROM ledger WHERE ${whereStr}`,
          fp,
        ),
      ])
      sendJson(response, 200, {
        entries:        rows,
        total:          Number(sumRows[0].total),
        net:            Number(sumRows[0].net),
        totalBuyIn:     Number(sumRows[0].total_buy_in),
        totalCashOut:   Number(sumRows[0].total_cash_out),
      })
      return
    }

    if (request.method === 'GET' && pathname === '/dt-history') {
      const limit  = Math.min(Number(url.searchParams.get('limit')  || 60), 120)
      const offset = Math.max(Number(url.searchParams.get('offset') || 0),  0)
      const { rows } = await query(
        `SELECT id, result, dragon_rank, dragon_suit, tiger_rank, tiger_suit
         FROM dt_round_history
         ORDER BY id DESC
         LIMIT $1 OFFSET $2`,
        [limit + 1, offset],
      )
      const hasMore = rows.length > limit
      sendJson(response, 200, {
        rounds: rows.slice(0, limit).map(r => ({
          dbId:       Number(r.id),
          result:     r.result,
          dragonRank: r.dragon_rank,
          dragonSuit: r.dragon_suit,
          tigerRank:  r.tiger_rank,
          tigerSuit:  r.tiger_suit,
        })),
        hasMore,
      }, effectiveCors)
      return
    }

    if (request.method === 'GET' && pathname === '/game-configs') {
      const { rows } = await query('SELECT slug, status, notice, display_name, image_url, badge, category, is_hot FROM game_configs ORDER BY slug')
      sendJson(response, 200, { configs: rows }, effectiveCors); return
    }

    const gameConfigSlugMatch = pathname.match(/^\/game-configs\/([^/]+)$/)
    if (gameConfigSlugMatch && request.method === 'GET') {
      const slug = gameConfigSlugMatch[1]
      const { rows } = await query('SELECT slug, status, notice, display_name, image_url, badge, category, is_hot FROM game_configs WHERE slug = $1', [slug])
      if (!rows.length) { sendJson(response, 404, { message: 'Not found' }, effectiveCors); return }
      sendJson(response, 200, rows[0], effectiveCors); return
    }

    if (request.method === 'GET' && pathname === '/slots/session') {
      const user = await getSessionUser(request)
      if (!user) { sendJson(response, 401, { message: 'Unauthorized.' }); return }
      const { rows } = await query(
        'SELECT free_spins_left, joker_mult, buy_in_amount, buy_in_start_balance FROM slot_sessions WHERE user_id = $1',
        [user.id]
      )
      const freeSpinsLeft  = rows.length > 0 ? rows[0].free_spins_left        : 0
      const jokerMult      = rows.length > 0 ? rows[0].joker_mult             : 1
      const buyInAmount    = rows.length > 0 ? rows[0].buy_in_amount          : null
      const buyInStartBal  = rows.length > 0 ? rows[0].buy_in_start_balance   : null

      // Clear stale buy-in session left by a crash — no cashout entry recorded
      // (individual spin win/loss entries already account for the session activity)
      if (buyInAmount != null) {
        await query(
          `UPDATE slot_sessions SET buy_in_amount = NULL, buy_in_start_balance = NULL WHERE user_id = $1`,
          [user.id]
        )
      }

      sendJson(response, 200, { freeSpinsLeft, jokerMult })
      return
    }

    if (request.method === 'POST' && pathname === '/slots/spin') {
      const user = await getSessionUser(request)
      if (!user) { sendJson(response, 401, { message: 'Unauthorized.' }); return }

      const body = await getRequestBody(request)
      const bet  = Number(body.bet)
      if (!Number.isFinite(bet) || bet <= 0) {
        sendJson(response, 400, { message: 'Invalid bet.' }); return
      }

      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const { rows: urows } = await client.query(
          'SELECT balance FROM users WHERE id = $1 FOR UPDATE', [user.id]
        )
        const balBefore = Number(urows[0].balance)

        const session = await loadSlotSession(user.id, client)
        const isFree  = session.freeSpinsLeft > 0

        if (!isFree && balBefore < bet) {
          await client.query('ROLLBACK')
          sendJson(response, 400, { message: '餘額不足。' }); return
        }

        // Generate grid and calc wins
        const grid = slotGenGrid()
        const { total, hits, scatters } = slotCalcWins(grid, bet)

        // Lightning cell
        let lightningCell = null
        if (!isFree && randomInt(100) < 5 || isFree && randomInt(100) < 14) {
          const mults = isFree ? SLOT_FS_MULTS : SLOT_BASE_MULTS
          lightningCell = { reel: randomInt(5), row: randomInt(5), mult: slotRnd(mults) }
        }

        // Joker accumulation (free spins only)
        let jokerMultGained = 0
        let jokerImgKey     = null
        if (isFree) {
          let jokerCount = 0
          for (let r = 0; r < 5; r++)
            for (let row = 0; row < 5; row++)
              if (grid[r][row] === 'joker') jokerCount++
          if (jokerCount > 0) {
            for (let i = 0; i < jokerCount; i++) {
              const m = slotRnd(SLOT_JOKER_MULTS)
              if (jokerMultGained === 0) jokerMultGained = m
              session.jokerMult = Math.min(session.jokerMult + m, 10)
            }
            jokerImgKey = slotJokerImgKey(jokerMultGained)
          }
        }

        // Apply multipliers to win — only one applies per spin to avoid stacking
        let winTotal = total
        if (lightningCell && winTotal > 0) {
          winTotal = Math.floor(winTotal * lightningCell.mult)
        } else if (isFree && session.jokerMult > 1 && winTotal > 0) {
          winTotal = Math.floor(winTotal * session.jokerMult)
        }

        const newBalance = balBefore - (isFree ? 0 : bet) + winTotal

        await client.query(
          'UPDATE users SET balance = $1 WHERE id = $2', [newBalance, user.id]
        )

        // Ledger
        const netAmount = isFree ? winTotal : winTotal - bet
        if (netAmount !== 0) {
          await client.query(
            `INSERT INTO ledger (user_id, type, amount, bet, game) VALUES ($1, $2, $3, $4, $5)`,
            [user.id, winTotal > 0 ? 'win' : 'loss', netAmount, bet, 'thunder-joker']
          )
        }

        // Update session state and persist to DB within the same transaction
        let freeSpinsGranted = 0
        if (isFree) {
          session.freeSpinsLeft = Math.max(0, session.freeSpinsLeft - 1)
          if (scatters >= 3 && session.freeSpinsLeft < 30) {
            const extra = scatters === 3 ? 4 : scatters === 4 ? 6 : 8
            session.freeSpinsLeft = Math.min(session.freeSpinsLeft + extra, 30)
            freeSpinsGranted = extra
          }
          if (session.freeSpinsLeft === 0) session.jokerMult = 1
        } else if (scatters >= 3) {
          freeSpinsGranted = scatters === 3 ? 6 : scatters === 4 ? 9 : 12
          session.freeSpinsLeft = freeSpinsGranted
          session.jokerMult = 1
        }
        await saveSlotSession(user.id, session, client)

        await client.query('COMMIT')

        sendJson(response, 200, {
          grid, hits, total, winTotal, newBalance, scatters,
          freeSpinsGranted, freeSpinsLeft: session.freeSpinsLeft,
          jokerMult: session.jokerMult, jokerMultGained, jokerImgKey,
          lightningCell,
        })
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
      return
    }

    // Record a buy_in or cash_out ledger entry for the slots session (no balance change)
    if (request.method === 'POST' && pathname === '/slots/ledger') {
      const user = await getSessionUser(request)
      if (!user) { sendJson(response, 401, { message: 'Unauthorized.' }); return }
      const body   = await getRequestBody(request)
      const type   = body.type
      const amount = Number(body.amount)
      if (!['buy_in', 'cash_out'].includes(type) || !Number.isFinite(amount)) {
        sendJson(response, 400, { message: 'Invalid.' }); return
      }
      await query(
        `INSERT INTO ledger (user_id, type, amount, game) VALUES ($1, $2, $3, $4)`,
        [user.id, type, amount, 'thunder-joker'],
      )
      if (type === 'buy_in') {
        const { rows: urows } = await query('SELECT balance FROM users WHERE id = $1', [user.id])
        const startBalance = Number(urows[0].balance)
        await query(
          `INSERT INTO slot_sessions (user_id, free_spins_left, joker_mult, buy_in_amount, buy_in_start_balance, updated_at)
           VALUES ($1, 0, 1, $2, $3, NOW())
           ON CONFLICT (user_id) DO UPDATE
             SET buy_in_amount = $2, buy_in_start_balance = $3, updated_at = NOW()`,
          [user.id, Math.abs(amount), startBalance]
        )
      } else {
        await query(
          `UPDATE slot_sessions SET buy_in_amount = NULL, buy_in_start_balance = NULL WHERE user_id = $1`,
          [user.id]
        )
      }
      sendJson(response, 200, { ok: true })
      return
    }

    // ── 排行榜 ──
    if (request.method === 'GET' && pathname === '/rank') {
      const period = url.searchParams.get('period') || 'weekly'
      const days = period === 'monthly' ? 30 : 7

      const { rows: list } = await query(`
        WITH human_gains AS (
          SELECT u.id, u.username, SUM(l.amount)::bigint AS score
          FROM ledger l
          JOIN users u ON u.id = l.user_id
          WHERE u.is_bot = false
            AND l.type IN ('hand_win', 'hand_loss')
            AND l.created_at >= NOW() - ($1 || ' days')::interval
          GROUP BY u.id, u.username
          HAVING SUM(l.amount) > 0
        ),
        bot_scores AS (
          SELECT id, username, balance::bigint AS score
          FROM users WHERE is_bot = true
        ),
        combined AS (
          SELECT * FROM human_gains
          UNION ALL
          SELECT * FROM bot_scores
        )
        SELECT username, score
        FROM combined
        ORDER BY score DESC
        LIMIT 20
      `, [days])

      let myRank = null
      const user = await getSessionUser(request)
      if (user) {
        const { rows: myRows } = await query(`
          SELECT COALESCE(SUM(amount), 0)::bigint AS score
          FROM ledger
          WHERE user_id = $1
            AND type IN ('hand_win', 'hand_loss')
            AND created_at >= NOW() - ($2 || ' days')::interval
        `, [user.id, days])
        const myScore = Number(myRows[0]?.score ?? 0)

        const { rows: rankRows } = await query(`
          WITH human_gains AS (
            SELECT u.id, SUM(l.amount)::bigint AS score
            FROM ledger l
            JOIN users u ON u.id = l.user_id
            WHERE u.is_bot = false
              AND l.type IN ('hand_win', 'hand_loss')
              AND l.created_at >= NOW() - ($1 || ' days')::interval
            GROUP BY u.id
            HAVING SUM(l.amount) > $2
          ),
          bot_scores AS (
            SELECT id, balance::bigint AS score FROM users
            WHERE is_bot = true AND balance > $2
          )
          SELECT
            (SELECT COUNT(*)::int FROM human_gains) +
            (SELECT COUNT(*)::int FROM bot_scores) AS above_count
        `, [days, myScore])

        myRank = { rank: (rankRows[0]?.above_count ?? 0) + 1, score: myScore }
      }

      sendJson(response, 200, { list, myRank })
      return
    }

    // ── 最新消息 (public) ──
    if (request.method === 'GET' && pathname === '/news') {
      const { rows } = await query(`
        SELECT id, title, content, category, published_at, start_at, end_at
        FROM news
        WHERE is_active = true
          AND (start_at IS NULL OR start_at <= NOW())
          AND (end_at   IS NULL OR end_at   >= NOW())
        ORDER BY published_at DESC, sort_order ASC
      `)
      sendJson(response, 200, { news: rows }, effectiveCors)
      return
    }

    // ── 跑馬燈公告 (public) ──
    if (request.method === 'GET' && pathname === '/announcements') {
      const { rows } = await query(
        `SELECT id, content FROM announcements WHERE is_active = true ORDER BY sort_order ASC, created_at ASC`
      )
      sendJson(response, 200, { announcements: rows }, effectiveCors); return
    }

    // ── 活動列表 (public) ──
    if (request.method === 'GET' && pathname === '/events') {
      const { rows } = await query(`
        SELECT id, title, description, image_url, tag, tag_color, is_hot, start_at, end_at, sort_order
        FROM events
        WHERE is_active = true
          AND (start_at IS NULL OR start_at <= NOW())
          AND (end_at   IS NULL OR end_at   >= NOW())
        ORDER BY sort_order ASC, created_at DESC
      `)
      sendJson(response, 200, { events: rows }, effectiveCors)
      return
    }

    // ── 任務中心 ──
    if (request.method === 'GET' && pathname === '/quests') {
      const user = await getSessionUser(request)
      if (!user) { sendJson(response, 401, { message: 'Unauthorized.' }, effectiveCors); return }

      const { rows: defs } = await query(
        `SELECT id,category,action_type,title,description,target,reward,tier,sort_order
         FROM quest_definitions WHERE is_active=true ORDER BY category,sort_order ASC,tier ASC`
      )
      const stats = await getUserQuestStats(user.id)
      const { rows: pkRow } = await query(`SELECT CURRENT_DATE::text AS dk, TO_CHAR(NOW(),'IYYY"-W"IW') AS wk`)
      const { dk, wk } = pkRow[0]

      const { rows: claimedRows } = await query(
        `SELECT quest_id FROM user_quests WHERE user_id=$1 AND claimed_at IS NOT NULL
         AND period_key IN ($2,$3,'all')`,
        [user.id, dk, wk]
      )
      const claimedIds = new Set(claimedRows.map(r => r.quest_id))

      const mapQuest = (cat) => (d) => {
        const progress  = calcQuestProgress(stats, d.action_type, cat)
        const claimed   = claimedIds.has(d.id)
        return { ...d, progress, claimed, claimable: !claimed && progress >= d.target }
      }

      const daily   = defs.filter(d => d.category==='daily').map(mapQuest('daily'))
      const weekly  = defs.filter(d => d.category==='weekly').map(mapQuest('weekly'))

      const achDefs = defs.filter(d => d.category==='achievement')
      const achMap  = {}
      for (const d of achDefs) {
        if (!achMap[d.action_type]) achMap[d.action_type] = []
        achMap[d.action_type].push(d)
      }
      const achievements = Object.values(achMap).map(tiers => {
        const progress = calcQuestProgress(stats, tiers[0].action_type, 'achievement')
        let prevClaimed = true
        return {
          action_type: tiers[0].action_type,
          title: tiers[0].title,
          progress,
          tiers: tiers.map(t => {
            const claimed  = claimedIds.has(t.id)
            const locked   = !prevClaimed
            const claimable = !locked && !claimed && progress >= t.target
            if (!locked) prevClaimed = claimed
            return { id: t.id, tier: t.tier, target: t.target, reward: t.reward,
                     progress, claimed, locked, claimable }
          }),
        }
      })

      sendJson(response, 200, { daily, weekly, achievements }, effectiveCors); return
    }

    const claimMatch = pathname.match(/^\/quests\/([^/]+)\/claim$/)
    if (claimMatch && request.method === 'POST') {
      const user = await getSessionUser(request)
      if (!user) { sendJson(response, 401, { message: 'Unauthorized.' }, effectiveCors); return }

      const questId = claimMatch[1]
      const { rows: defs } = await query(
        'SELECT * FROM quest_definitions WHERE id=$1 AND is_active=true', [questId]
      )
      const quest = defs[0]
      if (!quest) { sendJson(response, 404, { message: 'Quest not found.' }, effectiveCors); return }

      const { rows: pkRow } = await query(`SELECT CURRENT_DATE::text AS dk, TO_CHAR(NOW(),'IYYY"-W"IW') AS wk`)
      const periodKey = quest.category==='daily' ? pkRow[0].dk
                      : quest.category==='weekly' ? pkRow[0].wk
                      : 'all'

      const { rows: already } = await query(
        'SELECT id FROM user_quests WHERE user_id=$1 AND quest_id=$2 AND period_key=$3 AND claimed_at IS NOT NULL',
        [user.id, questId, periodKey]
      )
      if (already.length > 0) { sendJson(response, 409, { message: '已領取。' }, effectiveCors); return }

      if (quest.category==='achievement' && quest.tier > 1) {
        const { rows: prevRows } = await query(
          `SELECT id FROM quest_definitions WHERE action_type=$1 AND category='achievement' AND tier=$2`,
          [quest.action_type, quest.tier - 1]
        )
        if (prevRows.length > 0) {
          const { rows: prevClaimed } = await query(
            `SELECT id FROM user_quests WHERE user_id=$1 AND quest_id=$2 AND period_key='all' AND claimed_at IS NOT NULL`,
            [user.id, prevRows[0].id]
          )
          if (prevClaimed.length === 0) {
            sendJson(response, 400, { message: '請先完成前一階成就。' }, effectiveCors); return
          }
        }
      }

      const stats    = await getUserQuestStats(user.id)
      const progress = calcQuestProgress(stats, quest.action_type, quest.category)
      if (progress < quest.target) {
        sendJson(response, 400, { message: '尚未達成條件。' }, effectiveCors); return
      }

      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(
          `INSERT INTO user_quests (user_id,quest_id,period_key,claimed_at)
           VALUES ($1,$2,$3,NOW())
           ON CONFLICT (user_id,quest_id,period_key) DO UPDATE SET claimed_at=NOW()`,
          [user.id, questId, periodKey]
        )
        const { rows: updated } = await client.query(
          'UPDATE users SET balance=balance+$1 WHERE id=$2 RETURNING balance',
          [quest.reward, user.id]
        )
        await client.query(
          'INSERT INTO ledger (user_id,type,amount) VALUES ($1,$2,$3)',
          [user.id, 'quest_reward', quest.reward]
        )
        await client.query('COMMIT')
        sendJson(response, 200, { ok: true, reward: quest.reward, balance: updated[0].balance }, effectiveCors)
      } catch (err) { await client.query('ROLLBACK'); throw err }
      finally { client.release() }
      return
    }

    // ── Admin routes ─────────────────────────────────────────────────────────

    if (pathname === '/admin/auth/login' && request.method === 'POST') {
      const body = await getRequestBody(request)
      const username = String(body.username || '').trim()
      const password = String(body.password || '')
      const { rows } = await query('SELECT * FROM admins WHERE username = $1', [username])
      const admin = rows[0]
      if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
        sendJson(response, 401, { message: '帳號或密碼錯誤' }, effectiveCors); return
      }
      const token = randomUUID()
      await query('INSERT INTO admin_sessions (token, admin_id) VALUES ($1, $2)', [token, admin.id])
      sendJson(response, 200, { token, admin: { id: admin.id, username: admin.username } }, effectiveCors)
      return
    }

    if (pathname === '/admin/auth/logout' && request.method === 'POST') {
      const token = getTokenFromHeaders(request)
      if (token) await query('DELETE FROM admin_sessions WHERE token = $1', [token])
      sendJson(response, 200, { ok: true }, effectiveCors); return
    }

    if (pathname === '/admin/auth/me' && request.method === 'GET') {
      const admin = await getAdminFromToken(request)
      if (!admin) { sendJson(response, 401, { message: 'Unauthorized' }, effectiveCors); return }
      sendJson(response, 200, { admin: { id: admin.id, username: admin.username } }, effectiveCors); return
    }

    if (pathname.startsWith('/admin/')) {
      const admin = await getAdminFromToken(request)
      if (!admin) { sendJson(response, 401, { message: 'Unauthorized' }, effectiveCors); return }

      // ── 會員列表 ──
      if (pathname === '/admin/members' && request.method === 'GET') {
        const page   = Math.max(1, parseInt(url.searchParams.get('page')   || '1'))
        const limit  = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '20')))
        const offset = (page - 1) * limit
        const search = url.searchParams.get('search') || ''
        const status = url.searchParams.get('status') || ''
        const vals   = [HOUSE_USERNAME]
        let where    = 'WHERE is_bot = false AND username != $1'
        if (search) { vals.push(`%${search}%`); where += ` AND username ILIKE $${vals.length}` }
        if (status === 'suspended') where += ' AND suspended_at IS NOT NULL'
        if (status === 'active')    where += ' AND suspended_at IS NULL'
        const { rows: members } = await query(
          `SELECT id, username, balance, suspended_at, created_at FROM users ${where} ORDER BY created_at DESC LIMIT $${vals.length+1} OFFSET $${vals.length+2}`,
          [...vals, limit, offset]
        )
        const { rows: cnt } = await query(`SELECT COUNT(*) FROM users ${where}`, vals)
        sendJson(response, 200, { members, total: parseInt(cnt[0].count), page, limit }, effectiveCors)
        return
      }

      // ── 個別會員詳情 / 編輯 ──
      const memberMatch = pathname.match(/^\/admin\/members\/([^/]+)$/)
      if (memberMatch) {
        const memberId = memberMatch[1]

        if (request.method === 'GET') {
          const { rows } = await query(
            'SELECT id, username, balance, suspended_at, created_at FROM users WHERE id = $1 AND is_bot = false',
            [memberId]
          )
          if (!rows[0]) { sendJson(response, 404, { message: 'Not found' }, effectiveCors); return }
          sendJson(response, 200, { member: rows[0] }, effectiveCors); return
        }

        if (request.method === 'PATCH') {
          const body    = await getRequestBody(request)
          const updates = []
          const vals    = []
          if (body.balance !== undefined) {
            const b = parseInt(body.balance)
            if (!Number.isFinite(b) || b < 0) { sendJson(response, 400, { message: 'Invalid balance' }, effectiveCors); return }
            vals.push(b); updates.push(`balance = $${vals.length}`)
          }
          if (body.username !== undefined) {
            const u = String(body.username).trim()
            if (!u) { sendJson(response, 400, { message: 'Invalid username' }, effectiveCors); return }
            vals.push(u); updates.push(`username = $${vals.length}`)
          }
          if (body.suspended === true)  updates.push(`suspended_at = NOW()`)
          if (body.suspended === false) updates.push(`suspended_at = NULL`)
          if (updates.length === 0) { sendJson(response, 400, { message: 'Nothing to update' }, effectiveCors); return }
          vals.push(memberId)
          const { rows } = await query(
            `UPDATE users SET ${updates.join(', ')} WHERE id = $${vals.length} AND is_bot = false
             RETURNING id, username, balance, suspended_at, created_at`,
            vals
          )
          if (!rows[0]) { sendJson(response, 404, { message: 'Not found' }, effectiveCors); return }
          sendJson(response, 200, { member: rows[0] }, effectiveCors); return
        }
      }

      // ── 停權 / 解除停權 ──
      const suspendMatch = pathname.match(/^\/admin\/members\/([^/]+)\/(suspend|unsuspend)$/)
      if (suspendMatch && request.method === 'POST') {
        const memberId = suspendMatch[1]
        const action   = suspendMatch[2]
        const { rows } = await query(
          `UPDATE users SET suspended_at = ${action === 'suspend' ? 'NOW()' : 'NULL'}
           WHERE id = $1 AND is_bot = false
           RETURNING id, username, balance, suspended_at, created_at`,
          [memberId]
        )
        if (!rows[0]) { sendJson(response, 404, { message: 'Not found' }, effectiveCors); return }
        sendJson(response, 200, { member: rows[0] }, effectiveCors); return
      }

      // ── 會員帳務 (分頁 + 篩選) ──
      const memberLedgerMatch = pathname.match(/^\/admin\/members\/([^/]+)\/ledger$/)
      if (memberLedgerMatch && request.method === 'GET') {
        const memberId = memberLedgerMatch[1]
        const limit    = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit')  || '50')))
        const offset   = Math.max(0, parseInt(url.searchParams.get('offset') || '0'))
        const dateFrom = url.searchParams.get('dateFrom')
        const dateTo   = url.searchParams.get('dateTo')
        const type     = url.searchParams.get('type') || ''
        const vals     = [memberId]
        let where      = 'WHERE user_id = $1'
        if (dateFrom) { vals.push(dateFrom); where += ` AND created_at >= $${vals.length}` }
        if (dateTo)   { vals.push(dateTo);   where += ` AND created_at <  $${vals.length}` }
        if (type)     { vals.push(type);     where += ` AND type = $${vals.length}` }
        const { rows: ledger } = await query(
          `SELECT id, type, amount, game, room_id, bet, detail, created_at FROM ledger
           ${where} ORDER BY created_at DESC LIMIT $${vals.length+1} OFFSET $${vals.length+2}`,
          [...vals, limit, offset]
        )
        const { rows: cnt }    = await query(`SELECT COUNT(*) FROM ledger ${where}`, vals)
        const { rows: netRows } = await query(
          `SELECT SUM(CASE WHEN type IN ('buy_in','cash_out') THEN amount ELSE 0 END) AS net,
             SUM(CASE WHEN type = 'cash_out' THEN amount        ELSE 0 END) AS total_wins,
             SUM(CASE WHEN type = 'buy_in'   THEN ABS(amount)   ELSE 0 END) AS total_losses,
             COUNT(*)::int AS count
           FROM ledger ${where}`,
          vals
        )
        sendJson(response, 200, {
          ledger, total: parseInt(cnt[0].count), summary: netRows[0],
        }, effectiveCors); return
      }

      // ── 遊戲報表 ──
      if (pathname === '/admin/reports' && request.method === 'GET') {
        const dateFrom    = url.searchParams.get('dateFrom')
        const dateTo      = url.searchParams.get('dateTo')
        const game        = url.searchParams.get('game') || ''
        const userSearch  = url.searchParams.get('userSearch') || url.searchParams.get('userId') || ''
        const vals = []
        let where = 'u.is_bot = false'
        if (userSearch) { vals.push(userSearch); where += ` AND (u.username = $${vals.length} OR l.user_id::text = $${vals.length})` }
        if (dateFrom) { vals.push(dateFrom); where += ` AND l.created_at >= $${vals.length}` }
        if (dateTo)   { vals.push(dateTo);   where += ` AND l.created_at <  $${vals.length}` }
        if (game)     { vals.push(game);     where += ` AND l.game = $${vals.length}` }
        const { rows } = await query(
          `SELECT l.game, l.type,
             COUNT(*)::int                                               AS count,
             SUM(l.amount)                                              AS total_amount,
             SUM(CASE WHEN l.amount > 0 THEN  l.amount ELSE 0 END)     AS total_positive,
             SUM(CASE WHEN l.amount < 0 THEN -l.amount ELSE 0 END)     AS total_negative
           FROM ledger l JOIN users u ON u.id = l.user_id
           WHERE ${where}
           GROUP BY l.game, l.type ORDER BY l.game, l.type`,
          vals
        )
        // Summary by game
        const { rows: summary } = await query(
          `SELECT l.game,
             COUNT(DISTINCT l.user_id)::int                             AS unique_players,
             COUNT(*)::int                                              AS total_tx,
             SUM(l.amount)                                              AS net
           FROM ledger l JOIN users u ON u.id = l.user_id
           WHERE ${where}
           GROUP BY l.game ORDER BY l.game`,
          vals
        )
        sendJson(response, 200, { rows, summary }, effectiveCors); return
      }

      // ── Admin 任務管理 ──
      if (pathname === '/admin/quests' && request.method === 'GET') {
        const { rows } = await query(
          `SELECT id,category,action_type,title,description,target,reward,tier,sort_order,is_active,created_at
           FROM quest_definitions ORDER BY category,sort_order ASC,tier ASC`
        )
        sendJson(response, 200, { quests: rows }, effectiveCors); return
      }

      if (pathname === '/admin/quests' && request.method === 'POST') {
        const body = await getRequestBody(request)
        const { category, action_type, title, description, target, reward, tier, sort_order, is_active } = body
        if (!title?.trim() || !category || !action_type || !target || !reward) {
          sendJson(response, 400, { message: '必填欄位不完整' }, effectiveCors); return
        }
        const { rows } = await query(
          `INSERT INTO quest_definitions (category,action_type,title,description,target,reward,tier,sort_order,is_active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [category, action_type, title.trim(), description||null, Number(target), Number(reward),
           Number(tier||1), Number(sort_order||0), is_active!==false]
        )
        sendJson(response, 201, { quest: rows[0] }, effectiveCors); return
      }

      if (pathname === '/admin/quests/reorder' && request.method === 'PATCH') {
        const { orders } = await getRequestBody(request)
        if (!Array.isArray(orders)) { sendJson(response, 400, { message: 'Invalid' }, effectiveCors); return }
        const client = await pool.connect()
        try {
          await client.query('BEGIN')
          for (const { id, sort_order } of orders) {
            await client.query('UPDATE quest_definitions SET sort_order=$1 WHERE id=$2', [sort_order, id])
          }
          await client.query('COMMIT')
        } catch (err) { await client.query('ROLLBACK'); throw err }
        finally { client.release() }
        sendJson(response, 200, { ok: true }, effectiveCors); return
      }

      const qMatch = pathname.match(/^\/admin\/quests\/([^/]+)$/)
      if (qMatch) {
        const qId = qMatch[1]
        if (request.method === 'PUT') {
          const body = await getRequestBody(request)
          const { category, action_type, title, description, target, reward, tier, sort_order, is_active } = body
          if (!title?.trim()) { sendJson(response, 400, { message: '標題為必填' }, effectiveCors); return }
          const { rows } = await query(
            `UPDATE quest_definitions SET category=$1,action_type=$2,title=$3,description=$4,
             target=$5,reward=$6,tier=$7,sort_order=$8,is_active=$9 WHERE id=$10 RETURNING *`,
            [category, action_type, title.trim(), description||null, Number(target), Number(reward),
             Number(tier||1), Number(sort_order||0), Boolean(is_active), qId]
          )
          if (!rows[0]) { sendJson(response, 404, { message: 'Not found' }, effectiveCors); return }
          sendJson(response, 200, { quest: rows[0] }, effectiveCors); return
        }
        if (request.method === 'DELETE') {
          await query('DELETE FROM user_quests WHERE quest_id=$1', [qId])
          const { rows } = await query('DELETE FROM quest_definitions WHERE id=$1 RETURNING id', [qId])
          if (!rows[0]) { sendJson(response, 404, { message: 'Not found' }, effectiveCors); return }
          sendJson(response, 200, { ok: true }, effectiveCors); return
        }
      }

      const qToggleMatch = pathname.match(/^\/admin\/quests\/([^/]+)\/toggle$/)
      if (qToggleMatch && request.method === 'PATCH') {
        const { rows } = await query(
          'UPDATE quest_definitions SET is_active=NOT is_active WHERE id=$1 RETURNING *',
          [qToggleMatch[1]]
        )
        if (!rows[0]) { sendJson(response, 404, { message: 'Not found' }, effectiveCors); return }
        sendJson(response, 200, { quest: rows[0] }, effectiveCors); return
      }

      // ── Admin 活動管理 ──
      if (pathname === '/admin/events' && request.method === 'GET') {
        const { rows } = await query(
          `SELECT id, title, description, image_url, tag, tag_color, is_hot, is_active, start_at, end_at, sort_order, created_at
           FROM events ORDER BY sort_order ASC, created_at DESC`
        )
        sendJson(response, 200, { events: rows }, effectiveCors); return
      }

      if (pathname === '/admin/events' && request.method === 'POST') {
        const body = await getRequestBody(request)
        const { title, description, image_url, tag, tag_color, is_hot, is_active, start_at, end_at, sort_order } = body
        if (!title?.trim()) { sendJson(response, 400, { message: '標題為必填' }, effectiveCors); return }
        const { rows } = await query(
          `INSERT INTO events (title, description, image_url, tag, tag_color, is_hot, is_active, start_at, end_at, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [title.trim(), description || null, image_url || null, tag || '限時', tag_color || '#57d46f',
           Boolean(is_hot), is_active !== false, start_at || null, end_at || null, sort_order ?? 0]
        )
        sendJson(response, 201, { event: rows[0] }, effectiveCors); return
      }

      if (pathname === '/admin/events/reorder' && request.method === 'PATCH') {
        const body = await getRequestBody(request)
        const { orders } = body
        if (!Array.isArray(orders)) { sendJson(response, 400, { message: 'Invalid' }, effectiveCors); return }
        const client = await pool.connect()
        try {
          await client.query('BEGIN')
          for (const { id, sort_order } of orders) {
            await client.query('UPDATE events SET sort_order=$1 WHERE id=$2', [sort_order, id])
          }
          await client.query('COMMIT')
        } catch (err) { await client.query('ROLLBACK'); throw err }
        finally { client.release() }
        sendJson(response, 200, { ok: true }, effectiveCors); return
      }

      const evtMatch = pathname.match(/^\/admin\/events\/([^/]+)$/)
      if (evtMatch) {
        const evtId = evtMatch[1]
        if (request.method === 'PUT') {
          const body = await getRequestBody(request)
          const { title, description, image_url, tag, tag_color, is_hot, is_active, start_at, end_at, sort_order } = body
          if (!title?.trim()) { sendJson(response, 400, { message: '標題為必填' }, effectiveCors); return }
          const { rows } = await query(
            `UPDATE events SET title=$1,description=$2,image_url=$3,tag=$4,tag_color=$5,is_hot=$6,
             is_active=$7,start_at=$8,end_at=$9,sort_order=$10 WHERE id=$11 RETURNING *`,
            [title.trim(), description || null, image_url || null, tag || '限時', tag_color || '#57d46f',
             Boolean(is_hot), Boolean(is_active), start_at || null, end_at || null, sort_order ?? 0, evtId]
          )
          if (!rows[0]) { sendJson(response, 404, { message: 'Not found' }, effectiveCors); return }
          sendJson(response, 200, { event: rows[0] }, effectiveCors); return
        }
        if (request.method === 'DELETE') {
          const { rows } = await query('DELETE FROM events WHERE id=$1 RETURNING id', [evtId])
          if (!rows[0]) { sendJson(response, 404, { message: 'Not found' }, effectiveCors); return }
          sendJson(response, 200, { ok: true }, effectiveCors); return
        }
      }

      const evtToggleMatch = pathname.match(/^\/admin\/events\/([^/]+)\/toggle$/)
      if (evtToggleMatch && request.method === 'PATCH') {
        const { rows } = await query(
          'UPDATE events SET is_active = NOT is_active WHERE id=$1 RETURNING *',
          [evtToggleMatch[1]]
        )
        if (!rows[0]) { sendJson(response, 404, { message: 'Not found' }, effectiveCors); return }
        sendJson(response, 200, { event: rows[0] }, effectiveCors); return
      }

      // ── Admin 消息管理 ──
      if (pathname === '/admin/news' && request.method === 'GET') {
        const { rows } = await query(
          `SELECT id, title, content, category, published_at, start_at, end_at, is_active, sort_order, created_at
           FROM news ORDER BY published_at DESC, sort_order ASC`
        )
        sendJson(response, 200, { news: rows }, effectiveCors); return
      }

      if (pathname === '/admin/news' && request.method === 'POST') {
        const body = await getRequestBody(request)
        const { title, content, category, published_at, start_at, end_at, sort_order, is_active } = body
        if (!title?.trim()) { sendJson(response, 400, { message: '標題為必填' }, effectiveCors); return }
        const { rows } = await query(
          `INSERT INTO news (title,content,category,published_at,start_at,end_at,sort_order,is_active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [title.trim(), content || null, category || '公告',
           published_at ? new Date(published_at) : new Date(),
           start_at ? new Date(start_at) : null,
           end_at   ? new Date(end_at)   : null,
           sort_order ?? 0, is_active !== false]
        )
        sendJson(response, 201, { news: rows[0] }, effectiveCors); return
      }

      const newsIdMatch = pathname.match(/^\/admin\/news\/([^/]+)$/)
      if (newsIdMatch) {
        const nId = newsIdMatch[1]
        if (request.method === 'PUT') {
          const body = await getRequestBody(request)
          const { title, content, category, published_at, start_at, end_at, sort_order, is_active } = body
          if (!title?.trim()) { sendJson(response, 400, { message: '標題為必填' }, effectiveCors); return }
          const { rows } = await query(
            `UPDATE news SET title=$1,content=$2,category=$3,published_at=$4,start_at=$5,end_at=$6,sort_order=$7,is_active=$8
             WHERE id=$9 RETURNING *`,
            [title.trim(), content || null, category || '公告',
             published_at ? new Date(published_at) : new Date(),
             start_at ? new Date(start_at) : null,
             end_at   ? new Date(end_at)   : null,
             sort_order ?? 0, is_active !== false, nId]
          )
          if (!rows[0]) { sendJson(response, 404, { message: 'Not found' }, effectiveCors); return }
          sendJson(response, 200, { news: rows[0] }, effectiveCors); return
        }
        if (request.method === 'DELETE') {
          await query('DELETE FROM news WHERE id=$1', [nId])
          sendJson(response, 200, { ok: true }, effectiveCors); return
        }
      }

      const newsToggleMatch = pathname.match(/^\/admin\/news\/([^/]+)\/toggle$/)
      if (newsToggleMatch && request.method === 'PATCH') {
        const { rows } = await query(
          'UPDATE news SET is_active=NOT is_active WHERE id=$1 RETURNING *',
          [newsToggleMatch[1]]
        )
        if (!rows[0]) { sendJson(response, 404, { message: 'Not found' }, effectiveCors); return }
        sendJson(response, 200, { news: rows[0] }, effectiveCors); return
      }

      // ── Admin 跑馬燈公告管理 ──
      if (pathname === '/admin/announcements' && request.method === 'GET') {
        const { rows } = await query(
          `SELECT id, content, is_active, sort_order, created_at FROM announcements ORDER BY sort_order ASC, created_at ASC`
        )
        sendJson(response, 200, { announcements: rows }, effectiveCors); return
      }

      if (pathname === '/admin/announcements' && request.method === 'POST') {
        const body = await getRequestBody(request)
        const { content, sort_order, is_active } = body
        if (!content?.trim()) { sendJson(response, 400, { message: '內容為必填' }, effectiveCors); return }
        const { rows } = await query(
          `INSERT INTO announcements (content, sort_order, is_active) VALUES ($1,$2,$3) RETURNING *`,
          [content.trim(), sort_order ?? 0, is_active !== false]
        )
        sendJson(response, 201, { announcement: rows[0] }, effectiveCors); return
      }

      const annIdMatch = pathname.match(/^\/admin\/announcements\/([^/]+)$/)
      if (annIdMatch) {
        const aId = annIdMatch[1]
        if (request.method === 'PUT') {
          const body = await getRequestBody(request)
          const { content, sort_order, is_active } = body
          if (!content?.trim()) { sendJson(response, 400, { message: '內容為必填' }, effectiveCors); return }
          const { rows } = await query(
            `UPDATE announcements SET content=$1, sort_order=$2, is_active=$3 WHERE id=$4 RETURNING *`,
            [content.trim(), sort_order ?? 0, is_active !== false, aId]
          )
          if (!rows[0]) { sendJson(response, 404, { message: 'Not found' }, effectiveCors); return }
          sendJson(response, 200, { announcement: rows[0] }, effectiveCors); return
        }
        if (request.method === 'DELETE') {
          await query('DELETE FROM announcements WHERE id=$1', [aId])
          sendJson(response, 200, { ok: true }, effectiveCors); return
        }
      }

      const annToggleMatch = pathname.match(/^\/admin\/announcements\/([^/]+)\/toggle$/)
      if (annToggleMatch && request.method === 'PATCH') {
        const { rows } = await query(
          'UPDATE announcements SET is_active=NOT is_active WHERE id=$1 RETURNING *',
          [annToggleMatch[1]]
        )
        if (!rows[0]) { sendJson(response, 404, { message: 'Not found' }, effectiveCors); return }
        sendJson(response, 200, { announcement: rows[0] }, effectiveCors); return
      }

      // ── Admin Support ────────────────────────────────────────────────────────
      if (pathname === '/admin/support/unread' && request.method === 'GET') {
        const { rows } = await query(
          `SELECT COUNT(*) FROM support_messages WHERE sender_type = 'user' AND is_read = FALSE`
        )
        sendJson(response, 200, { count: parseInt(rows[0].count) }, effectiveCors); return
      }

      if (pathname === '/admin/support/config' && request.method === 'GET') {
        const { rows } = await query(`SELECT value FROM support_config WHERE key = 'auto_close_days'`)
        sendJson(response, 200, { auto_close_days: parseInt(rows[0]?.value ?? '7') }, effectiveCors); return
      }

      if (pathname === '/admin/support/config' && request.method === 'PATCH') {
        const { auto_close_days } = await getRequestBody(request)
        const days = parseInt(auto_close_days)
        if (!Number.isFinite(days) || days < 0) { sendJson(response, 400, { message: 'Invalid' }, effectiveCors); return }
        await query(
          `INSERT INTO support_config (key, value) VALUES ('auto_close_days', $1) ON CONFLICT (key) DO UPDATE SET value = $1`,
          [String(days)]
        )
        sendJson(response, 200, { auto_close_days: days }, effectiveCors); return
      }

      if (pathname === '/admin/support/tickets' && request.method === 'GET') {
        const status    = url.searchParams.get('status')        || null
        const ticketNum = url.searchParams.get('ticket_number') || null
        const conditions = []
        const params     = []
        if (status)    { params.push(status);              conditions.push(`t.status = $${params.length}`) }
        if (ticketNum) { params.push(parseInt(ticketNum)); conditions.push(`t.ticket_number = $${params.length}`) }
        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
        const { rows } = await query(
          `SELECT t.*, u.username,
            (SELECT content FROM support_messages WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1) AS last_message,
            (SELECT COUNT(*) FROM support_messages WHERE ticket_id = t.id AND sender_type = 'user' AND is_read = FALSE) AS unread_count
           FROM support_tickets t
           JOIN users u ON t.user_id = u.id
           ${where}
           ORDER BY t.updated_at DESC LIMIT 100`,
          params
        )
        sendJson(response, 200, { tickets: rows }, effectiveCors); return
      }

      const adminTicketMsg = pathname.match(/^\/admin\/support\/tickets\/([^/]+)\/messages$/)
      if (adminTicketMsg) {
        const ticketId = adminTicketMsg[1]

        if (request.method === 'GET') {
          await query(
            `UPDATE support_messages SET is_read = TRUE
             WHERE ticket_id = $1 AND sender_type = 'user' AND is_read = FALSE`,
            [ticketId]
          )
          const { rows: msgs } = await query(
            `SELECT * FROM support_messages WHERE ticket_id = $1 ORDER BY created_at ASC`, [ticketId]
          )
          const { rows: [ticket] } = await query(
            `SELECT t.*, u.username FROM support_tickets t JOIN users u ON t.user_id = u.id WHERE t.id = $1`,
            [ticketId]
          )
          sendJson(response, 200, { messages: msgs, ticket }, effectiveCors); return
        }

        if (request.method === 'POST') {
          const body = await getRequestBody(request)
          const { content } = body
          if (!content?.trim()) { sendJson(response, 400, { message: 'Missing content' }, effectiveCors); return }
          const { rows: [ticket] } = await query(`SELECT * FROM support_tickets WHERE id = $1`, [ticketId])
          if (!ticket) { sendJson(response, 404, { message: 'Not found' }, effectiveCors); return }
          const { rows: [msg] } = await query(
            `INSERT INTO support_messages (ticket_id, sender_type, content) VALUES ($1, 'admin', $2) RETURNING *`,
            [ticketId, content.trim()]
          )
          await query(`UPDATE support_tickets SET updated_at = NOW() WHERE id = $1`, [ticketId])
          notifySupportUser(ticket.user_id, { type: 'new_message', ticketId, message: msg })
          sendJson(response, 201, { message: msg }, effectiveCors); return
        }
      }

      const adminTicketStatus = pathname.match(/^\/admin\/support\/tickets\/([^/]+)\/status$/)
      if (adminTicketStatus && request.method === 'PATCH') {
        const ticketId = adminTicketStatus[1]
        const { status } = await getRequestBody(request)
        const { rows: [ticket] } = await query(
          `UPDATE support_tickets SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
          [status, ticketId]
        )
        sendJson(response, 200, { ticket }, effectiveCors); return
      }

      // ── 房間管理 ──
      if (pathname === '/admin/rooms' && request.method === 'GET') {
        const rooms = [...roomManager.rooms.entries()].map(([id, game]) => ({
          id,
          gameType:    game.gameSlug ?? 'texas-holdem',
          phase:       game.phase,
          playerCount: game.players.length,
          maxPlayers:  game.maxPlayers,
          smallBlind:  game.smallBlind  ?? null,
          bigBlind:    game.bigBlind    ?? null,
          betUnit:     game.betUnit     ?? null,
          maxBet:      game.maxBet      ?? null,
          players: game.players.map(p => ({
            id:       p.id,
            username: p.username,
            balance:  p.balance,
            status:   p.status,
            isBot:    roomManager.botManager?.isBot(p.id) ?? false,
          })),
        }))
        sendJson(response, 200, { rooms }, effectiveCors); return
      }

      const roomCloseMatch = pathname.match(/^\/admin\/rooms\/([^/]+)$/)
      if (roomCloseMatch && request.method === 'DELETE') {
        const roomId = roomCloseMatch[1]
        const game = roomManager.rooms.get(roomId)
        if (!game) { sendJson(response, 404, { message: '房間不存在' }, effectiveCors); return }
        // Remove all players then delete room
        const playerIds = game.players.map(p => p.id)
        for (const pid of playerIds) {
          try { roomManager._leaveRoomById(pid, roomId) } catch {}
        }
        roomManager.rooms.delete(roomId)
        roomManager.botManager?.notifyRoomClosed(roomId)
        roomManager._broadcastRoomList()
        sendJson(response, 200, { ok: true }, effectiveCors); return
      }

      const kickMatch = pathname.match(/^\/admin\/rooms\/([^/]+)\/kick\/([^/]+)$/)
      if (kickMatch && request.method === 'POST') {
        const [, roomId, playerId] = kickMatch
        const game = roomManager.rooms.get(roomId)
        if (!game) { sendJson(response, 404, { message: '房間不存在' }, effectiveCors); return }
        try { roomManager._leaveRoomById(playerId, roomId) } catch {}
        sendJson(response, 200, { ok: true }, effectiveCors); return
      }

      // ── 遊戲設定 ──
      if (pathname === '/admin/games' && request.method === 'GET') {
        const { rows } = await query('SELECT slug, status, notice, display_name, image_url, badge, category, is_hot FROM game_configs ORDER BY slug')
        sendJson(response, 200, { games: rows }, effectiveCors); return
      }

      const gameSlugMatch = pathname.match(/^\/admin\/games\/([^/]+)$/)
      if (gameSlugMatch && request.method === 'PATCH') {
        const slug = gameSlugMatch[1]
        const { status, notice, display_name, image_url, badge, category, is_hot } = await getRequestBody(request)
        const VALID_STATUS   = ['open', 'maintenance', 'updating']
        const VALID_CATEGORY = ['poker', 'electronic', 'chess', 'other']
        if (status   && !VALID_STATUS.includes(status))     { sendJson(response, 400, { message: '無效的狀態' }, effectiveCors); return }
        if (category && !VALID_CATEGORY.includes(category)) { sendJson(response, 400, { message: '無效的分類' }, effectiveCors); return }
        const sets = []; const vals = []
        if (status       !== undefined) { vals.push(status);            sets.push(`status = $${vals.length}`) }
        if (notice       !== undefined) { vals.push(notice);            sets.push(`notice = $${vals.length}`) }
        if (display_name !== undefined) { vals.push(display_name || null); sets.push(`display_name = $${vals.length}`) }
        if (image_url    !== undefined) { vals.push(image_url    || null); sets.push(`image_url = $${vals.length}`) }
        if (badge        !== undefined) { vals.push(badge        || null); sets.push(`badge = $${vals.length}`) }
        if (category     !== undefined) { vals.push(category     || null); sets.push(`category = $${vals.length}`) }
        if (is_hot       !== undefined) { vals.push(is_hot === true || is_hot === 'true'); sets.push(`is_hot = $${vals.length}`) }
        if (!sets.length) { sendJson(response, 400, { message: '無變更' }, effectiveCors); return }
        vals.push(slug)
        const { rows } = await query(
          `UPDATE game_configs SET ${sets.join(', ')}, updated_at = NOW() WHERE slug = $${vals.length} RETURNING slug, status, notice, display_name, image_url, badge, category, is_hot`,
          vals
        )
        if (!rows.length) { sendJson(response, 404, { message: '遊戲不存在' }, effectiveCors); return }
        sendJson(response, 200, rows[0], effectiveCors); return
      }

      sendJson(response, 404, { message: 'Admin route not found.' }, effectiveCors); return
    }

    // ── Support (user) ───────────────────────────────────────────────────────
    if (pathname === '/support/unread') {
      const user = await getSessionUser(request)
      if (!user) { sendJson(response, 401, { message: 'Unauthorized' }); return }
      const { rows } = await query(
        `SELECT COUNT(*) FROM support_messages sm
         JOIN support_tickets st ON sm.ticket_id = st.id
         WHERE st.user_id = $1 AND sm.sender_type = 'admin' AND sm.is_read = FALSE`,
        [user.id]
      )
      sendJson(response, 200, { count: parseInt(rows[0].count) }); return
    }

    if (pathname === '/support/tickets' && request.method === 'GET') {
      const user = await getSessionUser(request)
      if (!user) { sendJson(response, 401, { message: 'Unauthorized' }); return }
      const { rows } = await query(
        `SELECT t.*, (
           SELECT content FROM support_messages WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1
         ) AS last_message,
         (SELECT COUNT(*) FROM support_messages WHERE ticket_id = t.id AND sender_type = 'admin' AND is_read = FALSE) AS unread_count
         FROM support_tickets t WHERE t.user_id = $1 AND t.is_deleted_by_user = FALSE ORDER BY t.updated_at DESC`,
        [user.id]
      )
      sendJson(response, 200, { tickets: rows }); return
    }

    if (pathname === '/support/tickets' && request.method === 'POST') {
      const user = await getSessionUser(request)
      if (!user) { sendJson(response, 401, { message: 'Unauthorized' }); return }
      const body = await getRequestBody(request)
      const { category, subject, content } = body
      if (!category || !content?.trim()) { sendJson(response, 400, { message: 'Missing fields' }); return }
      const { rows: [ticket] } = await query(
        `INSERT INTO support_tickets (user_id, category, subject, status, ticket_number)
         VALUES ($1, $2, $3, 'open', nextval('support_ticket_seq')) RETURNING *`,
        [user.id, category, subject || category]
      )
      await query(
        `INSERT INTO support_messages (ticket_id, sender_type, content) VALUES ($1, 'user', $2)`,
        [ticket.id, content.trim()]
      )
      sendJson(response, 201, { ticket }); return
    }

    const supportTicketDel = pathname.match(/^\/support\/tickets\/([^/]+)$/)
    if (supportTicketDel && request.method === 'DELETE') {
      const ticketId = supportTicketDel[1]
      const user = await getSessionUser(request)
      if (!user) { sendJson(response, 401, { message: 'Unauthorized' }); return }
      const { rows: [ticket] } = await query(
        `UPDATE support_tickets SET is_deleted_by_user = TRUE
         WHERE id = $1 AND user_id = $2 RETURNING id`,
        [ticketId, user.id]
      )
      if (!ticket) { sendJson(response, 404, { message: 'Not found' }); return }
      sendJson(response, 200, { ok: true }); return
    }

    const supportTicketMsg = pathname.match(/^\/support\/tickets\/([^/]+)\/messages$/)
    if (supportTicketMsg) {
      const ticketId = supportTicketMsg[1]
      const user = await getSessionUser(request)
      if (!user) { sendJson(response, 401, { message: 'Unauthorized' }); return }
      // Verify ownership
      const { rows: [ticket] } = await query(
        `SELECT * FROM support_tickets WHERE id = $1 AND user_id = $2`, [ticketId, user.id]
      )
      if (!ticket) { sendJson(response, 404, { message: 'Not found' }); return }

      if (request.method === 'GET') {
        // Mark admin messages as read
        await query(
          `UPDATE support_messages SET is_read = TRUE
           WHERE ticket_id = $1 AND sender_type = 'admin' AND is_read = FALSE`,
          [ticketId]
        )
        const { rows } = await query(
          `SELECT * FROM support_messages WHERE ticket_id = $1 ORDER BY created_at ASC`, [ticketId]
        )
        sendJson(response, 200, { messages: rows, ticket }); return
      }

      if (request.method === 'POST') {
        if (ticket.status === 'closed') { sendJson(response, 400, { message: 'Ticket is closed' }); return }
        const body = await getRequestBody(request)
        const { content } = body
        if (!content?.trim()) { sendJson(response, 400, { message: 'Missing content' }); return }
        const { rows: [msg] } = await query(
          `INSERT INTO support_messages (ticket_id, sender_type, content) VALUES ($1, 'user', $2) RETURNING *`,
          [ticketId, content.trim()]
        )
        await query(`UPDATE support_tickets SET updated_at = NOW() WHERE id = $1`, [ticketId])
        sendJson(response, 201, { message: msg }); return
      }
    }

    // ── Lottery ────────────────────────────────────────────────────────────────

    if (pathname.startsWith('/lottery')) {

      // GET /lottery/games — list game configs
      if (request.method === 'GET' && pathname === '/lottery/games') {
        sendJson(response, 200, { games: GAME_LIST.map(g => ({
          slug: g.slug, name: g.name,
          pickCount: g.pickCount, poolSize: g.poolSize,
          hasBonus: g.hasBonus, hasExtra: g.hasExtra,
          extraPoolSize: g.extraPoolSize ?? null,
          betAmount: g.betAmount, drawDays: g.drawDays,
          tiers: g.tiers.map(t => ({ tier: t.tier, name: t.name, matchMain: t.matchMain,
            matchBonus: t.matchBonus, matchExtra: t.matchExtra, poolShare: t.poolShare }))
        }))})
        return
      }

      // GET /lottery/draws?slug=lotto539 — latest draws per game
      if (request.method === 'GET' && pathname === '/lottery/draws') {
        const slug = url.searchParams.get('slug')
        const { rows } = slug
          ? await query(`SELECT * FROM lottery_draws WHERE game_slug=$1 ORDER BY draw_date DESC LIMIT 10`, [slug])
          : await query(`SELECT DISTINCT ON (game_slug) * FROM lottery_draws ORDER BY game_slug, draw_date DESC`)
        sendJson(response, 200, { draws: rows })
        return
      }

      // GET /lottery/current?slug=lotto539 — current open draw for betting
      if (request.method === 'GET' && pathname === '/lottery/current') {
        const slug = url.searchParams.get('slug')
        if (!slug || !GAMES[slug]) { sendJson(response, 400, { message: 'Invalid slug' }); return }
        const { rows: [draw] } = await query(
          `SELECT * FROM lottery_draws WHERE game_slug=$1 AND status='open' ORDER BY draw_date DESC LIMIT 1`,
          [slug]
        )
        sendJson(response, 200, { draw: draw ?? null })
        return
      }

      // GET /lottery/bets — user's lottery bet history
      if (request.method === 'GET' && pathname === '/lottery/bets') {
        const user = await getSessionUser(request)
        if (!user) { sendJson(response, 401, { message: 'Unauthorized.' }); return }
        const { rows } = await query(`
          SELECT lb.*, ld.draw_date, ld.numbers AS draw_numbers,
                 ld.bonus_number AS draw_bonus, ld.extra_number AS draw_extra,
                 ld.status AS draw_status
          FROM lottery_bets lb
          JOIN lottery_draws ld ON ld.id = lb.draw_id
          WHERE lb.user_id = $1
          ORDER BY lb.placed_at DESC
          LIMIT 50
        `, [user.id])
        sendJson(response, 200, { bets: rows })
        return
      }

      // POST /lottery/bet — place a bet
      if (request.method === 'POST' && pathname === '/lottery/bet') {
        const user = await getSessionUser(request)
        if (!user) { sendJson(response, 401, { message: 'Unauthorized.' }); return }
        const body = await getRequestBody(request)
        const { slug, numbers, extraNumber } = body

        const game = GAMES[slug]
        if (!game) { sendJson(response, 400, { message: '無效彩種' }); return }

        const nums = Array.isArray(numbers) ? numbers.map(Number) : []
        if (nums.length !== game.pickCount) {
          sendJson(response, 400, { message: `請選 ${game.pickCount} 個號碼` }); return
        }
        if (nums.some(n => n < 1 || n > game.poolSize)) {
          sendJson(response, 400, { message: `號碼超出範圍 1-${game.poolSize}` }); return
        }
        if (new Set(nums).size !== nums.length) {
          sendJson(response, 400, { message: '號碼不能重複' }); return
        }
        if (game.hasExtra) {
          const en = Number(extraNumber)
          if (!en || en < 1 || en > game.extraPoolSize) {
            sendJson(response, 400, { message: `第二區號碼需在 1-${game.extraPoolSize}` }); return
          }
        }

        const { rows: [draw] } = await query(
          `SELECT * FROM lottery_draws WHERE game_slug=$1 AND status='open' ORDER BY draw_date DESC LIMIT 1`,
          [slug]
        )
        if (!draw) { sendJson(response, 400, { message: '目前沒有開放投注的期數' }); return }

        if (user.balance < game.betAmount) {
          sendJson(response, 400, { message: '餘額不足' }); return
        }

        const client = await pool.connect()
        try {
          await client.query('BEGIN')
          await client.query(`UPDATE users SET balance = balance - $1 WHERE id = $2`, [game.betAmount, user.id])
          await client.query(`UPDATE lottery_draws SET prize_pool = prize_pool + $1 WHERE id = $2`, [game.betAmount * game.poolRate, draw.id])
          await client.query(`
            INSERT INTO lottery_bets (user_id, draw_id, game_slug, numbers, extra_number, amount)
            VALUES ($1,$2,$3,$4,$5,$6)
          `, [user.id, draw.id, slug, nums, game.hasExtra ? Number(extraNumber) : null, game.betAmount])
          await client.query(`
            INSERT INTO ledger (user_id, type, amount, game, detail)
            VALUES ($1,'lottery_bet',$2,$3,$4)
          `, [user.id, -game.betAmount, slug, JSON.stringify({ drawId: draw.id, drawDate: draw.draw_date })])
          await client.query('COMMIT')
        } catch (err) {
          await client.query('ROLLBACK'); throw err
        } finally {
          client.release()
        }

        const { rows: [updated] } = await query(`SELECT balance FROM users WHERE id=$1`, [user.id])
        sendJson(response, 201, { ok: true, balance: updated.balance })
        return
      }

      // GET /lottery/results?slug=lotto539&limit=10 — recent draw results
      if (request.method === 'GET' && pathname === '/lottery/results') {
        const slug  = url.searchParams.get('slug')
        const limit = Math.min(Number(url.searchParams.get('limit') ?? 10), 30)
        if (!slug || !GAMES[slug]) { sendJson(response, 400, { message: 'Invalid slug' }); return }
        const { rows } = await query(`
          SELECT ld.*, ltp.tier, ltp.winner_count, ltp.prize_each
          FROM lottery_draws ld
          LEFT JOIN lottery_tier_pools ltp ON ltp.draw_id = ld.id
          WHERE ld.game_slug=$1 AND ld.status IN ('drawn','settled')
          ORDER BY ld.draw_date DESC, ltp.tier ASC
          LIMIT $2
        `, [slug, limit * 10])
        // Group by draw
        const drawMap = new Map()
        for (const r of rows) {
          if (!drawMap.has(r.id)) {
            drawMap.set(r.id, { id: r.id, period: r.period, drawDate: r.draw_date,
              numbers: r.numbers, bonusNumber: r.bonus_number, extraNumber: r.extra_number,
              status: r.status, tiers: [] })
          }
          if (r.tier != null) {
            drawMap.get(r.id).tiers.push({ tier: r.tier, winnerCount: r.winner_count, prizeEach: r.prize_each })
          }
        }
        sendJson(response, 200, { results: [...drawMap.values()].slice(0, limit) })
        return
      }

    }

    sendJson(response, 404, { message: 'Not found.' })
  } catch (error) {
    sendJson(response, 500, {
      message: 'Internal server error.',
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

// ── WebSocket (poker tables) ──────────────────────────────────────────────────

const roomManager = new RoomManager(pool)
const botManager  = new BotManager(pool)
roomManager.botManager = botManager

const wss = new WebSocketServer({ noServer: true })

// ── WebSocket (support chat) ──────────────────────────────────────────────────

const supportClients = new Map()  // userId → ws
const supportWss = new WebSocketServer({ noServer: true })

function notifySupportUser(userId, data) {
  const ws = supportClients.get(userId)
  if (ws?.readyState === 1) ws.send(JSON.stringify(data))
}

supportWss.on('connection', async (ws, _request, user) => {
  ws.isAlive = true
  ws.on('pong', () => { ws.isAlive = true })
  supportClients.set(user.id, ws)
  try {
    const { rows } = await query(
      `SELECT COUNT(*) FROM support_messages sm
       JOIN support_tickets st ON sm.ticket_id = st.id
       WHERE st.user_id = $1 AND sm.sender_type = 'admin' AND sm.is_read = FALSE`,
      [user.id]
    )
    ws.send(JSON.stringify({ type: 'unread_count', count: parseInt(rows[0].count) }))
  } catch {}
  ws.on('close', () => supportClients.delete(user.id))
  ws.on('error', () => supportClients.delete(user.id))
})

wss.on('connection', async (ws, request, user) => {
  ws.isAlive = true
  ws.on('pong', () => { ws.isAlive = true })

  roomManager.registerClient(ws, { userId: user.id, username: user.username })

  ws.on('message', async (raw) => {
    let msg
    try { msg = JSON.parse(raw) } catch { return }
    try { await roomManager.handleMessage(ws, msg) } catch (err) {
      console.error('[ws message]', err)
    }
  })

  ws.on('close', () => {
    try { roomManager.unregisterClient(ws) } catch (err) { console.error('[ws close]', err) }
  })
  ws.on('error', () => {
    try { roomManager.unregisterClient(ws) } catch (err) { console.error('[ws error]', err) }
  })

  // Send current room list on connect
  ws.send(JSON.stringify({ type: 'room_list', rooms: roomManager.listRooms() }))
})

// Ping every 30s — keeps connections alive through proxies and cleans up dead clients
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) { ws.terminate(); return }
    ws.isAlive = false
    ws.ping()
  })
  supportWss.clients.forEach((ws) => {
    if (ws.isAlive === false) { ws.terminate(); return }
    ws.isAlive = false
    ws.ping()
  })
}, 30_000)

server.on('upgrade', async (request, socket, head) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`)
    const token = url.searchParams.get('token')
    if (!token) { socket.destroy(); return }

    const { rows } = await query(
      `SELECT u.* FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.token = $1`,
      [token],
    )
    const user = rows[0]
    if (!user) { socket.destroy(); return }

    if (url.pathname === '/support') {
      supportWss.handleUpgrade(request, socket, head, (ws) => {
        supportWss.emit('connection', ws, request, user)
      })
    } else {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request, user)
      })
    }
  } catch {
    socket.destroy()
  }
})

// ── Boot ──────────────────────────────────────────────────────────────────────

let dbReady = false

// Start listening immediately so /games (no DB) works right away
server.listen(port, "0.0.0.0", () => {
  console.log(`Backend listening on http://0.0.0.0:${port}`)
  console.log(`WebSocket available at ws://0.0.0.0:${port}/poker?token=<your_token>`)
})

async function initDbWithRetry(attemptsLeft = 10) {
  try {
    await initDb()
  } catch (err) {
    if (attemptsLeft > 0) {
      console.log(`DB not ready yet, retrying in 3s… (${attemptsLeft} left)`)
      await new Promise(r => setTimeout(r, 3000))
      return initDbWithRetry(attemptsLeft - 1)
    }
    throw err
  }
}

initDbWithRetry()
  .then(() => botManager.seedBots())
  .then(() => roomManager.ensureHouseAccount())
  .then(async () => {
    const { rows: existing } = await query('SELECT 1 FROM admins WHERE username = $1', ['admin'])
    if (existing.length === 0) {
      const hash = await bcrypt.hash('aaa123', 12)
      await query('INSERT INTO admins (username, password_hash) VALUES ($1, $2)', ['admin', hash])
      console.log('Admin seeded: admin / aaa123')
    }
  })
  .then(async () => {
    const { rows: qCount } = await query('SELECT COUNT(*) FROM quest_definitions')
    if (Number(qCount[0].count) > 0) return
    const seeds = [
      ['daily','login',       '登入大廳',         '每天登入即可領取獎勵', 1,    200,  1, 0],
      ['daily','games_played','完成一局遊戲',      null,                  1,    500,  1, 1],
      ['daily','chips_wagered','累計下注 10,000 籌碼', null,             10000,1000, 1, 2],
      ['daily','add_favorite','收藏一款遊戲',      null,                  1,    300,  1, 3],
      ['weekly','games_played','完成 20 局遊戲',   null,                 20,   5000, 1, 0],
      ['weekly','chips_won',  '累計贏得 50,000 籌碼', null,             50000,8000, 1, 1],
      ['weekly','checkin_streak','連續簽到 7 天',  null,                  7,  10000, 1, 2],
      ['achievement','games_played','遊戲達人', '累計完成局數',  10,    500, 1, 0],
      ['achievement','games_played','遊戲達人', '累計完成局數',  50,   2000, 2, 0],
      ['achievement','games_played','遊戲達人', '累計完成局數', 200,   8000, 3, 0],
      ['achievement','games_played','遊戲達人', '累計完成局數', 500,  20000, 4, 0],
      ['achievement','chips_won',   '籌碼大師', '累計贏得籌碼',  10000,  500, 1, 1],
      ['achievement','chips_won',   '籌碼大師', '累計贏得籌碼', 100000, 3000, 2, 1],
      ['achievement','chips_won',   '籌碼大師', '累計贏得籌碼', 500000,15000, 3, 1],
      ['achievement','checkin_streak','簽到達人','連續簽到天數',  7,   1000, 1, 2],
      ['achievement','checkin_streak','簽到達人','連續簽到天數', 30,   5000, 2, 2],
      ['achievement','checkin_streak','簽到達人','連續簽到天數',100,  20000, 3, 2],
    ]
    for (const [cat, act, title, desc, target, reward, tier, sort] of seeds) {
      await query(
        `INSERT INTO quest_definitions (category,action_type,title,description,target,reward,tier,sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [cat, act, title, desc, target, reward, tier, sort]
      )
    }
    console.log('Default quests seeded.')
  })
  .then(() => {
    dbReady = true
    console.log('Database ready.')

    // Keep Neon from autosuspending (free tier sleeps after 5 min of no queries)
    setInterval(() => query('SELECT 1').catch(() => {}), 4 * 60 * 1000)

    // Auto-close inactive support tickets
    async function autoCloseTickets() {
      try {
        const { rows } = await query(`SELECT value FROM support_config WHERE key = 'auto_close_days'`)
        const days = parseInt(rows[0]?.value ?? '7')
        if (days <= 0) return
        const { rowCount } = await query(
          `UPDATE support_tickets SET status = 'closed', updated_at = NOW()
           WHERE status = 'open' AND updated_at < NOW() - ($1 || ' days')::INTERVAL`,
          [String(days)]
        )
        if (rowCount > 0) console.log(`Auto-closed ${rowCount} inactive ticket(s).`)
      } catch (err) { console.error('Auto-close error:', err.message) }
    }
    autoCloseTickets()
    setInterval(autoCloseTickets, 60 * 60 * 1000)

    // Lottery scheduler
    initLotteryScheduler()

    // Seed pre-existing rooms so the lobby looks active on startup
    // DIAGNOSTIC: set SEED_AMBIENT_ROOMS=0 to skip this — used to isolate
    // bot-runner.js's zero-sum check from chip noise injected by these
    // always-on bot tables. Dragon Tiger in particular is house-banked: bots
    // win/lose against the house account (_house_bank), not each other, so
    // the bot-only SUM(balance) bot-runner.js checks will drift even though
    // the full economy (bots + house) is still conserved. Not a bug — just
    // outside that check's scope.
    if (process.env.SEED_AMBIENT_ROOMS !== '0') {
      const r1 = roomManager.createRoom({ smallBlind: 10, bigBlind: 20, maxPlayers: 6 })
      const g1 = roomManager.getRoom(r1)
      if (g1) botManager.fillRoom(g1, r1, 2)

      const r2 = roomManager.createRoom({ smallBlind: 25, bigBlind: 50, maxPlayers: 6 })
      const g2 = roomManager.getRoom(r2)
      if (g2) botManager.fillRoom(g2, r2, 2)

      const bt3BotCount = 2 + Math.floor(Math.random() * 2)  // 2 or 3 bots → 3 or 4 players total
      const r3 = roomManager.createRoom({ gameType: 'big-two', gameSlug: 'big-two', betUnit: 10, maxPlayers: 4 })
      const g3 = roomManager.getRoom(r3)
      if (g3) botManager.fillRoom(g3, r3, bt3BotCount)

      const r4 = roomManager.createRoom({ gameType: 'dragon-tiger', gameSlug: 'dragon-tiger', maxPlayers: 6, minBet: 20, maxBet: 10000 })
      const g4 = roomManager.getRoom(r4)
      if (g4) botManager.fillRoom(g4, r4, 3)
    }
  })
  .catch((error) => {
    console.error('Failed to initialize:', error)
    process.exit(1)
  })
