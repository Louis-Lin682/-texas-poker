import 'dotenv/config'
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { WebSocketServer } from 'ws'
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
    if (type === 'state_update')  broadcastToAll({ type, state })
    if (type === 'round_result') {
      broadcastToAll({ type, state, results })
      // Persist round result to DB
      await saveRoundResult(results)
    }
  }
  game.start()
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
    for (const r of (results ?? [])) {
      if (!r.id) continue
      const net = r.payout - r.totalBet
      await query(
        `INSERT INTO ledger (user_id, type, amount, meta)
         VALUES ($1, 'dt_round', $2, $3)`,
        [r.id, net, JSON.stringify({ roundId, payout: r.payout, totalBet: r.totalBet })]
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

  // Current game config (frontend reads to show payout labels)
  if (req.method === 'GET' && url.pathname === '/config') {
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

  // Send current state immediately
  if (game) {
    ws.send(JSON.stringify({ type: 'state_update', state: game.stateForPlayer(user.id) }))
  }

  // Add player to game
  game?.addPlayer({ id: user.id, username: user.username, balance: user.balance })

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw)
      const info = clients.get(ws)
      if (!info || !game) return

      if (msg.type === 'dt_place_bet') {
        game.placeBet(info.userId, msg.zone, msg.amount ?? 0)
      } else if (msg.type === 'dt_cancel_last_bet') {
        game.cancelLastBet(info.userId)
      } else if (msg.type === 'dt_cancel_bets') {
        game.cancelBets(info.userId)
      }
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }))
    }
  })

  ws.on('close', () => {
    const info = clients.get(ws)
    if (info) game?.removePlayer(info.userId)
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
  .then(() => {
    startGame()
    // Hot reload: restart game with new config on next round (already handled in _startBetting)
    configBus.on('updated', () => {
      console.log('[config] updated — takes effect next round')
    })
    server.listen(PORT, () => console.log(`Dragon Tiger server listening on :${PORT}`))
  })
  .catch((err) => { console.error('Boot failed:', err); process.exit(1) })
