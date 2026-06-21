import 'dotenv/config'
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { WebSocketServer } from 'ws'
import bcrypt from 'bcryptjs'
import { query, initDb } from './core/db.js'
import { getConfig, getVersionId, loadConfig, configBus } from './core/config.js'
import { DragonTigerGame } from './game/DragonTigerGame.js'

process.on('uncaughtException',  (err) => console.error('[uncaughtException]',  err))
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err))

const PORT        = Number(process.env.PORT        || 4000)
const CORS_ORIGIN = process.env.CORS_ORIGIN        || 'http://localhost:5173'

// ── Auth helpers ──────────────────────────────────────────────────────────────

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

// ── Game instance ─────────────────────────────────────────────────────────────

let game = null
const clients = new Map()   // ws → { userId, username }

// ── Bot system ────────────────────────────────────────────────────────────────

const BOT_DEFS = [
  { username: 'dt_阿龍', balance: 10000 },
  { username: 'dt_小虎', balance: 10000 },
  { username: 'dt_大財', balance: 10000 },
]
const ZONES   = ['dragon', 'dragon', 'tiger', 'tiger', 'tie']
const AMOUNTS = [20, 50, 100, 500, 1000]

let bots = []                      // [{ id, username, balance }]
const botBetScheduled = new Set()  // bot IDs that have a bet timer this round

async function seedBots() {
  bots = []
  for (const def of BOT_DEFS) {
    const { rows } = await query(
      `INSERT INTO users (username, password_hash, balance, is_bot)
       VALUES ($1, 'BOT_RESERVED', $2, true)
       ON CONFLICT (username) DO UPDATE SET is_bot = true
       RETURNING id, username, balance`,
      [def.username, def.balance]
    )
    bots.push({ id: rows[0].id, username: rows[0].username, balance: Number(rows[0].balance) })
  }
}

function scheduleBotBets() {
  if (!game || game.phase !== 'betting') return
  for (const bot of bots) {
    // Re-add bot if it was removed (balance hit 0 last round)
    if (!game.players.find(p => p.id === bot.id)) {
      query('UPDATE users SET balance = 10000 WHERE id = $1', [bot.id]).catch(() => {})
      try { game.addPlayer({ id: bot.id, username: bot.username, balance: 10000 }) } catch {}
    }
    if (botBetScheduled.has(bot.id)) continue
    const p = game.players.find(pl => pl.id === bot.id)
    if (!p || p.balance <= 0) continue
    if (Object.values(p.bets || {}).some(v => v > 0)) continue

    botBetScheduled.add(bot.id)
    setTimeout(() => {
      if (!game || game.phase !== 'betting') return
      const player = game.players.find(pl => pl.id === bot.id)
      if (!player || player.balance <= 0) return
      const zone   = ZONES[Math.floor(Math.random() * ZONES.length)]
      const amount = Math.min(AMOUNTS[Math.floor(Math.random() * AMOUNTS.length)], player.balance)
      try { game.placeBet(bot.id, zone, amount) } catch {}
    }, 1500 + Math.random() * 5000)
  }
}

function broadcastState() {
  const state = game?.stateForPlayer(null)
  for (const [ws] of clients) {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'state_update', state }))
  }
}

function broadcastToAll(msg) {
  const data = JSON.stringify(msg)
  for (const [ws] of clients) {
    if (ws.readyState === 1) ws.send(data)
  }
}

function startGame() {
  game = new DragonTigerGame({
    roomId:    'dt-main',
    getConfig: () => getConfig(),
  })
  game.onEvent = async ({ type, state, results }) => {
    if (type === 'state_update') {
      broadcastToAll({ type, state })
      if (state?.phase === 'betting') scheduleBotBets()
    }
    if (type === 'round_result') {
      botBetScheduled.clear()
      broadcastToAll({ type, state, results })
      await saveRoundResult(results)
    }
  }
  game.start()
  // Add pre-seeded bots to the game
  for (const bot of bots) {
    try { game.addPlayer({ id: bot.id, username: bot.username, balance: bot.balance }) } catch {}
  }
}

async function saveRoundResult(results) {
  const roundId   = randomUUID()
  const versionId = getVersionId()
  const snapshot  = getConfig()

  try {
    await query(
      `INSERT INTO dt_rounds (round_id, config_version_id, config_snapshot, started_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT DO NOTHING`,
      [roundId, versionId, JSON.stringify(snapshot)]
    )

    // Record round cards in history (use first result's detail — cards are same for all)
    const firstDetail = results?.[0]?.detail
    if (firstDetail) {
      const { result, dragonCard, tigerCard } = firstDetail
      await query(
        `INSERT INTO dt_round_history (result, dragon_rank, dragon_suit, tiger_rank, tiger_suit)
         VALUES ($1, $2, $3, $4, $5)`,
        [result, dragonCard.rank, dragonCard.suit, tigerCard.rank, tigerCard.suit]
      )
    }

    for (const r of (results ?? [])) {
      if (!r.id) continue
      const net = r.payout - r.totalBet
      await query(
        `INSERT INTO ledger (user_id, type, amount, detail)
         VALUES ($1, 'dt_round', $2, $3)`,
        [r.id, net, JSON.stringify({
          roundId,
          payout:     r.payout,
          totalBet:   r.totalBet,
          result:     r.detail?.result,
          dragonCard: r.detail?.dragonCard,
          tigerCard:  r.detail?.tigerCard,
          bets:       r.detail?.bets,
        })]
      )
      await query(
        'UPDATE users SET balance = balance + $1 WHERE id = $2',
        [net, r.id]
      )
    }
  } catch (err) {
    console.error('[saveRoundResult]', err.message)
  }
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || CORS_ORIGIN
  const url    = new URL(req.url, `http://localhost`)

  if (req.method === 'OPTIONS') { cors(res, origin); res.writeHead(204); res.end(); return }

  // ── Auth ──────────────────────────────────────────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/auth/login') {
    const { username, password } = await readBody(req)
    const { rows } = await query(
      'SELECT * FROM users WHERE username = $1 AND is_bot = false AND suspended_at IS NULL',
      [username]
    )
    const user = rows[0]
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return sendJson(res, 401, { message: '帳號或密碼錯誤' }, origin)
    }
    const token = randomUUID()
    await query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, user.id])
    return sendJson(res, 200, { token, userId: user.id, username: user.username, balance: user.balance }, origin)
  }

  if (req.method === 'POST' && url.pathname === '/auth/register') {
    const { username, password } = await readBody(req)
    if (!username || !password || username.length < 2 || password.length < 4) {
      return sendJson(res, 400, { message: '帳號至少 2 字，密碼至少 4 字' }, origin)
    }
    const hash = await bcrypt.hash(password, 12)
    try {
      const { rows } = await query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, balance',
        [username, hash]
      )
      const user  = rows[0]
      const token = randomUUID()
      await query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, user.id])
      return sendJson(res, 201, { token, userId: user.id, username: user.username, balance: user.balance }, origin)
    } catch (err) {
      if (err.code === '23505') return sendJson(res, 409, { message: '帳號已存在' }, origin)
      throw err
    }
  }

  // Internal: admin-server calls this after saving config
  if (req.method === 'POST' && url.pathname === '/internal/reload-config') {
    await loadConfig()
    console.log('[config] reloaded by admin — takes effect next round')
    broadcastToAll({ type: 'config_update', config: getConfig() })
    return sendJson(res, 200, { ok: true }, origin)
  }

  // Current game config (frontend reads to show payout labels)
  if (req.method === 'GET' && (url.pathname === '/config' || url.pathname === '/dt-config')) {
    return sendJson(res, 200, { config: getConfig() }, origin)
  }

  // DT round history
  if (req.method === 'GET' && url.pathname === '/dt-history') {
    const limit  = Math.min(Number(url.searchParams.get('limit')  || 60), 120)
    const offset = Math.max(Number(url.searchParams.get('offset') || 0),   0)
    const { rows } = await query(
      `SELECT id, result, dragon_rank, dragon_suit, tiger_rank, tiger_suit
       FROM dt_round_history ORDER BY id DESC LIMIT $1 OFFSET $2`,
      [limit + 1, offset]
    )
    const hasMore = rows.length > limit
    return sendJson(res, 200, {
      rounds:  rows.slice(0, limit).map(r => ({
        dbId: Number(r.id), result: r.result,
        dragonRank: r.dragon_rank, dragonSuit: r.dragon_suit,
        tigerRank:  r.tiger_rank,  tigerSuit:  r.tiger_suit,
      })),
      hasMore,
    }, origin)
  }

  sendJson(res, 404, { message: 'Not found' }, origin)
})

// ── WebSocket ─────────────────────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true })

wss.on('connection', async (ws, req) => {
  // Verify token from query string or Authorization header
  const url    = new URL(req.url, 'http://localhost')
  const token  = url.searchParams.get('token') || ''
  const { rows } = await query(
    'SELECT u.* FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.token = $1',
    [token]
  )
  const user = rows[0]
  if (!user) { ws.close(4001, 'Unauthorized'); return }

  clients.set(ws, { userId: user.id, username: user.username })

  // Add player to game (use fresh DB balance)
  game?.addPlayer({ id: user.id, username: user.username, balance: Number(user.balance) })

  // Notify client it has joined (compatible with main hook interface)
  ws.send(JSON.stringify({
    type:   'room_joined',
    roomId: 'dt-main',
    myId:   user.id,
    state:  game?.stateForPlayer(user.id) ?? null,
  }))

  ws.on('message', (raw) => {
    try {
      const msg  = JSON.parse(raw)
      const info = clients.get(ws)
      if (!info || !game) return

      if (msg.type === 'dt_place_bet') {
        game.placeBet(info.userId, msg.zone, msg.amount ?? 0)
      } else if (msg.type === 'dt_cancel_last_bet') {
        game.cancelLastBet(info.userId)
      } else if (msg.type === 'dt_cancel_bets') {
        game.cancelBets(info.userId)
      } else if (msg.type === 'cashout' || msg.type === 'leave_room') {
        const p       = game.players.find(p => p.id === info.userId)
        const balance = p?.balance ?? 0
        game.removePlayer(info.userId)
        clients.delete(ws)
        ws.send(JSON.stringify({ type: 'cashout_done', balance }))
        ws.close()
      }
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }))
    }
  })

  ws.on('close', () => {
    const info = clients.get(ws)
    if (info) {
      const p = game?.players.find(p => p.id === info.userId)
      if (p) {
        // Sync in-memory balance back to DB on disconnect so no chips are lost
        query('UPDATE users SET balance = $1 WHERE id = $2', [p.balance, info.userId]).catch(() => {})
      }
      game?.removePlayer(info.userId)
    }
    clients.delete(ws)
  })
})

server.on('upgrade', async (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  } else {
    socket.destroy()
  }
})

// ── Boot ──────────────────────────────────────────────────────────────────────

initDb()
  .then(() => loadConfig())
  .then(() => seedBots())
  .then(() => {
    startGame()
    // Hot reload: restart game with new config on next round (already handled in _startBetting)
    configBus.on('updated', () => {
      console.log('[config] updated — takes effect next round')
    })
    server.listen(PORT, () => console.log(`Dragon Tiger server listening on :${PORT}`))
  })
  .catch((err) => { console.error('Boot failed:', err); process.exit(1) })
