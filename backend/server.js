import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { existsSync, readFileSync } from 'node:fs'
import http from 'node:http'
import { randomUUID, randomInt } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import pool, { initDb, query } from './db.js'
import { RoomManager } from './game/RoomManager.js'
import { BotManager } from './game/BotManager.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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
  ...Array(10).fill('10'), ...Array(8).fill('J'), ...Array(8).fill('Q'),
  ...Array(7).fill('K'), ...Array(7).fill('A'), ...Array(5).fill('clownhat-blue'),
  ...Array(5).fill('clownhat-golden'), ...Array(4).fill('clownhat-purple'), ...Array(4).fill('clownhat-red'),
  ...Array(3).fill('bell'), ...Array(3).fill('joker'),
  ...Array(1).fill('wild'), ...Array(1).fill('scatter'),
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
          `SELECT id, type, amount, bet, room_id, game, created_at
           FROM ledger WHERE ${whereStr}
           ORDER BY created_at DESC
           LIMIT $${fp.length + 1} OFFSET $${fp.length + 2}`,
          [...fp, limit, offset],
        ),
        query(
          `SELECT COUNT(*) AS total,
                  COALESCE(SUM(amount), 0) AS net,
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

    if (request.method === 'GET' && pathname === '/slots/session') {
      const user = await getSessionUser(request)
      if (!user) { sendJson(response, 401, { message: 'Unauthorized.' }); return }
      const { rows } = await query(
        'SELECT free_spins_left, joker_mult FROM slot_sessions WHERE user_id = $1',
        [user.id]
      )
      const freeSpinsLeft = rows.length > 0 ? rows[0].free_spins_left : 0
      const jokerMult     = rows.length > 0 ? rows[0].joker_mult      : 1
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
          if (scatters >= 3) {
            const extra = scatters === 3 ? 4 : scatters === 4 ? 6 : 8
            session.freeSpinsLeft += extra
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
        const vals   = []
        let where    = 'WHERE is_bot = false'
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
          `SELECT id, type, amount, game, room_id, bet, created_at FROM ledger
           ${where} ORDER BY created_at DESC LIMIT $${vals.length+1} OFFSET $${vals.length+2}`,
          [...vals, limit, offset]
        )
        const { rows: cnt }    = await query(`SELECT COUNT(*) FROM ledger ${where}`, vals)
        const { rows: netRows } = await query(
          `SELECT SUM(amount) AS net,
             SUM(CASE WHEN amount > 0 THEN  amount ELSE 0 END) AS total_wins,
             SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS total_losses,
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

      sendJson(response, 404, { message: 'Admin route not found.' }, effectiveCors); return
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

wss.on('connection', async (ws, request, user) => {
  roomManager.registerClient(ws, { userId: user.id, username: user.username })

  ws.on('message', async (raw) => {
    let msg
    try { msg = JSON.parse(raw) } catch { return }
    try { await roomManager.handleMessage(ws, msg) } catch (err) {
      console.error('[ws message]', err)
    }
  })

  ws.on('close', () => roomManager.unregisterClient(ws))
  ws.on('error', () => roomManager.unregisterClient(ws))

  // Send current room list on connect
  ws.send(JSON.stringify({ type: 'room_list', rooms: roomManager.listRooms() }))
})

server.on('upgrade', async (request, socket, head) => {
  // Authenticate via token in query string: ws://host/poker?token=xxx
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

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, user)
    })
  } catch {
    socket.destroy()
  }
})

// ── Boot ──────────────────────────────────────────────────────────────────────

let dbReady = false

// Start listening immediately so /games (no DB) works right away
server.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`)
  console.log(`WebSocket available at ws://localhost:${port}/poker?token=<your_token>`)
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
  .then(async () => {
    const { rows: existing } = await query('SELECT 1 FROM admins WHERE username = $1', ['admin'])
    if (existing.length === 0) {
      const hash = await bcrypt.hash('aaa123', 12)
      await query('INSERT INTO admins (username, password_hash) VALUES ($1, $2)', ['admin', hash])
      console.log('Admin seeded: admin / aaa123')
    }
  })
  .then(() => {
    dbReady = true
    console.log('Database ready.')

    // Keep Neon from autosuspending (free tier sleeps after 5 min of no queries)
    setInterval(() => query('SELECT 1').catch(() => {}), 4 * 60 * 1000)

    // Seed pre-existing rooms so the lobby looks active on startup
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
  })
  .catch((error) => {
    console.error('Failed to initialize:', error)
    process.exit(1)
  })
