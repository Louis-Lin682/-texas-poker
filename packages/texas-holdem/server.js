import 'dotenv/config'
import http from 'node:http'
import { WebSocketServer } from 'ws'
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import pool, { query, initDb } from './core/db.js'
import { PokerGame } from './game/PokerGame.js'
import { decide } from './game/BotPlayer.js'

process.on('uncaughtException',  (err) => console.error('[uncaughtException]',  err))
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err))

const PORT        = Number(process.env.PORT        || 4300)
const CORS_ORIGIN = process.env.CORS_ORIGIN        || 'http://localhost:5275'

// ── Bot definitions ───────────────────────────────────────────────────────────

const BOT_DEFS = [
  'th_阿明','th_小龍','th_大寶','th_阿文','th_小慧','th_大山',
  'th_阿偉','th_小花','th_大強','th_阿珍','th_小明','th_大海',
].map(username => ({ username, balance: 10000 }))

const THINK_MIN = 350
const THINK_MAX = 800

// ── Runtime state ─────────────────────────────────────────────────────────────

const rooms      = new Map()  // roomId → PokerGame
const clients    = new Map()  // ws → { userId, username, roomId }
const bots       = new Map()  // botId → { username, roomId, inGameBalance }
const botTimers  = new Map()  // botId → timer handle
const botActSet  = new Set()  // botIds currently pending an action timer
const joinTimers = new Map()  // roomId → [timer handles]
const graceTimers = new Map() // userId → { timer, roomId }

// ── HTTP helpers ──────────────────────────────────────────────────────────────

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

// ── WS helpers ────────────────────────────────────────────────────────────────

function wsSend(ws, data) {
  if (ws?.readyState === 1) ws.send(JSON.stringify(data))
}

function sendError(ws, message) {
  wsSend(ws, { type: 'error', message })
}

function broadcastRoomList() {
  const list = [...rooms.entries()].map(([id, game]) => ({
    id,
    gameType:    'texas-holdem',
    phase:       game.phase,
    playerCount: game.players.length,
    maxPlayers:  game.maxPlayers,
    smallBlind:  game.smallBlind,
    bigBlind:    game.bigBlind,
  }))
  for (const [ws, info] of clients) {
    if (!info.roomId) wsSend(ws, { type: 'room_list', rooms: list })
  }
  // Also push to clients inside rooms (room list shown in lobby when not in room)
  for (const [ws] of clients) {
    const info = clients.get(ws)
    if (!info?.roomId) continue
  }
}

function broadcastRoomListAll() {
  const list = [...rooms.entries()].map(([id, game]) => ({
    id,
    gameType:    'texas-holdem',
    phase:       game.phase,
    playerCount: game.players.length,
    maxPlayers:  game.maxPlayers,
    smallBlind:  game.smallBlind,
    bigBlind:    game.bigBlind,
  }))
  for (const [ws] of clients) {
    wsSend(ws, { type: 'room_list', rooms: list })
  }
}

// ── Bot management ────────────────────────────────────────────────────────────

function isBot(userId) { return bots.has(userId) }

async function seedBots() {
  for (const b of BOT_DEFS) {
    const { rows } = await query(
      `INSERT INTO users (username, password_hash, balance, is_bot)
       VALUES ($1, 'BOT_RESERVED', $2, true)
       ON CONFLICT (username) DO UPDATE SET is_bot = true
       RETURNING id, username, balance`,
      [b.username, b.balance]
    )
    bots.set(rows[0].id, { username: rows[0].username, roomId: null, inGameBalance: 0 })
  }
  console.log(`[bots] seeded ${bots.size} bots`)
}

function cancelBotTimer(botId) {
  const t = botTimers.get(botId)
  if (t) { clearTimeout(t); botTimers.delete(botId) }
}

function fillRoom(game, roomId, count = 3) {
  let added = 0
  let delay = 800
  for (const [id, info] of bots) {
    if (added >= count) break
    if (info.roomId !== null) continue
    info.roomId = roomId
    const botId = id
    const botInfo = info
    const buyIn = 2000

    const t = setTimeout(() => {
      const list = joinTimers.get(roomId)
      if (list) list.splice(list.indexOf(t), 1)
      try {
        game.addPlayer({ id: botId, username: botInfo.username, balance: buyIn })
        botInfo.roomId        = roomId
        botInfo.inGameBalance = buyIn
        const rt = setTimeout(() => {
          try { game.setReady(botId) } catch {}
        }, 400 + Math.random() * 600)
        joinTimers.get(roomId)?.push(rt)
      } catch {
        botInfo.roomId = null
      }
    }, delay)

    const handles = joinTimers.get(roomId) ?? []
    handles.push(t)
    joinTimers.set(roomId, handles)
    delay += 1000 + Math.floor(Math.random() * 800)
    added++
  }
}

function notifyRoomClosed(roomId) {
  const handles = joinTimers.get(roomId) ?? []
  handles.forEach(t => clearTimeout(t))
  joinTimers.delete(roomId)
  for (const [id, info] of bots) {
    if (info.roomId === roomId) {
      cancelBotTimer(id)
      botActSet.delete(id)
      info.roomId = null
    }
  }
}

function notifyBotLeft(userId) {
  const info = bots.get(userId)
  if (info) { cancelBotTimer(userId); botActSet.delete(userId); info.roomId = null }
}

async function syncBotBalances(game) {
  for (const p of game.players) {
    const info = bots.get(p.id)
    if (!info || info.roomId !== game.roomId) continue
    const delta = p.balance - (info.inGameBalance ?? p.balance)
    if (delta !== 0) {
      await query('UPDATE users SET balance = balance + $1 WHERE id = $2', [delta, p.id]).catch(() => {})
    }
    info.inGameBalance = p.balance
  }
}

function onBotStateUpdate(game, publicState) {
  if (publicState.phase === 'waiting') {
    for (const p of publicState.players) {
      if (isBot(p.id)) botActSet.delete(p.id)
    }
    for (const [id, info] of bots) {
      if (info.roomId === game.roomId && !game.players.some(p => p.id === id)) {
        cancelBotTimer(id)
        info.roomId = null
      }
    }
    const hasHuman = publicState.players.some(p => !isBot(p.id))
    if (!hasHuman) return
    for (const p of publicState.players) {
      if (!isBot(p.id) || p.ready) continue
      cancelBotTimer(p.id)
      const delay = 600 + Math.random() * 800
      const t = setTimeout(() => {
        botTimers.delete(p.id)
        try { game.setReady(p.id) } catch {}
      }, delay)
      botTimers.set(p.id, t)
    }
    return
  }

  const actingId = publicState.actingPlayerId
  if (!actingId || !isBot(actingId)) return
  if (botActSet.has(actingId)) return
  cancelBotTimer(actingId)

  const me = publicState.players.find(p => p.id === actingId)
  if (!me) return
  botActSet.add(actingId)

  const delay = THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN)
  const timer = setTimeout(() => {
    botActSet.delete(actingId)
    botTimers.delete(actingId)
    const acting = game._actingPlayer()
    if (!acting || acting.id !== actingId) return
    const botPlayer = game.players.find(p => p.id === actingId)
    if (!botPlayer || botPlayer.status !== 'active') return
    const cur = game.publicState()
    const meNow = cur.players.find(p => p.id === actingId) ?? me
    const dec = decide({
      holeCards:      botPlayer.holeCards ?? [],
      communityCards: cur.communityCards,
      phase:          cur.phase,
      currentBet:     cur.currentBet,
      myRoundBet:     meNow.roundBet,
      myBalance:      meNow.balance,
      pot:            cur.pot,
      minRaise:       cur.minRaise ?? cur.bigBlind ?? 20,
    })
    try {
      game.processAction(actingId, dec.action, dec.amount ?? 0)
    } catch {
      try { game.processAction(actingId, 'fold') } catch {}
    }
  }, delay)

  botTimers.set(actingId, timer)
}

// ── Room management ───────────────────────────────────────────────────────────

function createRoom(opts = {}) {
  const roomId = randomUUID().slice(0, 8).toUpperCase()
  const game = new PokerGame({
    roomId,
    smallBlind: opts.smallBlind ?? 10,
    bigBlind:   opts.bigBlind   ?? 20,
    maxPlayers: opts.maxPlayers ?? 6,
    gameSlug:   'texas-holdem',
  })
  game.onEvent = (event) => handleGameEvent(event)
  rooms.set(roomId, game)
  broadcastRoomListAll()
  return roomId
}

function closeRoomIfEmpty(roomId, game, cashoutCtx) {
  const humansLeft = [...clients.values()].filter(c => c.roomId === roomId).length
  const graceLeft  = [...graceTimers.values()].filter(g => g.roomId === roomId).length
  if (humansLeft > 0 || graceLeft > 0) return false

  if (game.pot > 0) {
    for (const p of game.players) p.balance += (p.totalBet ?? 0)
    game.pot = 0
  }
  syncBotBalances(game).catch(() => {})
  game.destroy()
  rooms.delete(roomId)
  notifyRoomClosed(roomId)
  broadcastRoomListAll()
  return true
}

async function joinRoom(ws, info, roomId, buyIn) {
  if (info.roomId) leaveRoom(ws, info)

  // Grace-period reconnect
  const grace = graceTimers.get(info.userId)
  if (grace) {
    clearTimeout(grace.timer)
    graceTimers.delete(info.userId)
    if (grace.roomId === roomId) {
      const game = rooms.get(roomId)
      if (game) {
        info.roomId = roomId
        wsSend(ws, {
          type:  'room_joined',
          roomId,
          myId:  info.userId,
          state: game.stateForPlayer(info.userId),
        })
        broadcastRoomListAll()
        return
      }
    } else {
      expireGrace(info.userId, grace.roomId)
    }
  }

  const { rows: susp } = await query('SELECT suspended_at FROM users WHERE id = $1', [info.userId])
  if (susp[0]?.suspended_at) return sendError(ws, '您已被停權，如有疑問，請聯繫客服')

  const game = rooms.get(roomId)
  if (!game) return sendError(ws, '房間不存在')
  if (game.phase !== 'waiting') return sendError(ws, '遊戲進行中，無法加入')
  if (game.players.length >= game.maxPlayers) return sendError(ws, '房間已滿')

  const { rows: [balRow] } = await query('SELECT balance FROM users WHERE id = $1', [info.userId])
  buyIn = Number(balRow?.balance ?? 0)
  if (buyIn <= 0) return sendError(ws, '餘額不足，無法進場')
  await query('UPDATE users SET balance = 0 WHERE id = $1', [info.userId])

  query(
    'INSERT INTO ledger (user_id, type, amount, room_id, game) VALUES ($1, $2, $3, $4, $5)',
    [info.userId, 'buy_in', -buyIn, roomId, 'texas-holdem']
  ).catch(err => console.error('[ledger buy_in]', err))

  game.addPlayer({ id: info.userId, username: info.username, balance: buyIn })
  info.roomId = roomId

  wsSend(ws, {
    type:  'room_joined',
    roomId,
    myId:  info.userId,
    state: game.stateForPlayer(info.userId),
  })
  broadcastRoomListAll()
}

function leaveRoom(ws, info) {
  const roomId = info.roomId
  if (!roomId) return
  const game = rooms.get(roomId)
  info.roomId = null
  if (!game) return

  const player = game.players.find(p => p.id === info.userId)
  const midHandRefund = game.pot > 0 ? (player?.totalBet ?? 0) : 0
  const cashout = (player?.balance ?? 0) + midHandRefund

  game.removePlayer(info.userId)

  if (midHandRefund > 0) {
    query(
      'INSERT INTO ledger (user_id, type, amount, bet, room_id, game, detail) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [info.userId, 'bet_void', midHandRefund, midHandRefund, roomId, 'texas-holdem', JSON.stringify({ reason: 'left_mid_hand' })]
    ).catch(() => {})
  }

  const doLedger = (bal) => {
    if (bal !== null) wsSend(ws, { type: 'balance_update', balance: bal })
    query(
      'INSERT INTO ledger (user_id, type, amount, room_id, game) VALUES ($1,$2,$3,$4,$5)',
      [info.userId, 'cash_out', cashout, roomId, 'texas-holdem']
    ).catch(() => {})
  }

  if (cashout > 0) {
    query(
      'UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance',
      [cashout, info.userId]
    ).then(({ rows }) => doLedger(rows[0]?.balance ?? null)).catch(() => {})
  } else {
    doLedger(null)
  }

  closeRoomIfEmpty(roomId, game, 'leave')
  broadcastRoomListAll()
}

function startGracePeriod(userId, roomId) {
  const existing = graceTimers.get(userId)
  if (existing) clearTimeout(existing.timer)
  const timer = setTimeout(() => {
    graceTimers.delete(userId)
    try { expireGrace(userId, roomId) } catch (err) { console.error('[expireGrace]', err) }
  }, 30_000)
  graceTimers.set(userId, { timer, roomId })
}

function expireGrace(userId, roomId) {
  const game = rooms.get(roomId)
  if (!game) return
  const player = game.players.find(p => p.id === userId)
  const midHandRefund = game.pot > 0 ? (player?.totalBet ?? 0) : 0
  const cashout = (player?.balance ?? 0) + midHandRefund
  game.removePlayer(userId)
  if (cashout > 0) {
    query('UPDATE users SET balance = balance + $1 WHERE id = $2', [cashout, userId]).catch(() => {})
  }
  if (midHandRefund > 0) {
    query(
      'INSERT INTO ledger (user_id, type, amount, bet, room_id, game, detail) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [userId, 'bet_void', midHandRefund, midHandRefund, roomId, 'texas-holdem', JSON.stringify({ reason: 'disconnect_mid_hand' })]
    ).catch(() => {})
  }
  query(
    'INSERT INTO ledger (user_id, type, amount, room_id, game) VALUES ($1,$2,$3,$4,$5)',
    [userId, 'cash_out', cashout, roomId, 'texas-holdem']
  ).catch(() => {})
  closeRoomIfEmpty(roomId, game, 'grace-expire')
}

// ── Game event → WS broadcast ─────────────────────────────────────────────────

function handleGameEvent({ type, roomId, ...data }) {
  const game = rooms.get(roomId)
  if (!game) return

  const roomClients = [...clients.entries()].filter(([, info]) => info.roomId === roomId)

  if (type === 'state_update') {
    for (const [ws, info] of roomClients) {
      wsSend(ws, {
        type:  'state_update',
        myId:  info.userId,
        state: game.stateForPlayer(info.userId),
      })
    }
    onBotStateUpdate(game, data.state)
    broadcastRoomListAll()
    return
  }

  if (type === 'hole_cards') {
    const target = roomClients.find(([, info]) => info.userId === data.playerId)
    if (target) wsSend(target[0], { type: 'hole_cards', cards: data.cards })
    return
  }

  if (type === 'showdown' || type === 'hand_result') {
    if (!rooms.has(roomId)) return
    syncBotBalances(game).catch(() => {})

    if (type === 'showdown' || type === 'hand_result') {
      const winnerMap = new Map((data.winners ?? []).map(w => [w.id, w.amount]))
      for (const p of game.players) {
        if (!p.totalBet || isBot(p.id)) continue
        const winAmt = winnerMap.get(p.id) ?? 0
        const net = winAmt ? winAmt - p.totalBet : -p.totalBet
        const entryType = winAmt ? 'hand_win' : 'hand_loss'
        query(
          'INSERT INTO ledger (user_id, type, amount, bet, room_id, game) VALUES ($1,$2,$3,$4,$5,$6)',
          [p.id, entryType, net, p.totalBet, roomId, 'texas-holdem']
        ).catch(() => {})
      }
    }
    // Fall through to broadcast
  }

  // Broadcast to all room clients
  for (const [ws] of roomClients) {
    wsSend(ws, { type, ...data })
  }
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || CORS_ORIGIN
  const url    = new URL(req.url, 'http://localhost')
  const path   = url.pathname

  if (req.method === 'OPTIONS') { cors(res, origin); res.writeHead(204); res.end(); return }

  try {
    if (req.method === 'POST' && path === '/auth/register') {
      const { username, password } = await readBody(req)
      if (!username?.trim() || !password) {
        return sendJson(res, 400, { message: 'Username and password required.' }, origin)
      }
      const hash = await bcrypt.hash(password, 12)
      try {
        const { rows } = await query(
          'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING *',
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

    sendJson(res, 404, { message: 'Not found.' }, origin)
  } catch (err) {
    console.error('[server]', err)
    sendJson(res, 500, { message: err.message }, origin)
  }
})

// ── WebSocket server ──────────────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true })

wss.on('connection', async (ws, _request, user) => {
  ws.isAlive = true
  ws.on('pong', () => { ws.isAlive = true })

  clients.set(ws, { userId: user.id, username: user.username, roomId: null })

  ws.on('message', async (raw) => {
    let msg
    try { msg = JSON.parse(raw) } catch { return }
    const info = clients.get(ws)
    if (!info) return

    try {
      const { type, ...payload } = msg

      if (type === 'list_rooms') {
        const list = [...rooms.entries()].map(([id, game]) => ({
          id, gameType: 'texas-holdem', phase: game.phase,
          playerCount: game.players.length, maxPlayers: game.maxPlayers,
          smallBlind: game.smallBlind, bigBlind: game.bigBlind,
        }))
        wsSend(ws, { type: 'room_list', rooms: list })
        return
      }

      if (type === 'create_room') {
        const roomId = createRoom({
          smallBlind: payload.smallBlind, bigBlind: payload.bigBlind, maxPlayers: payload.maxPlayers,
        })
        await joinRoom(ws, info, roomId, payload.buyIn ?? 1000)
        const game = rooms.get(roomId)
        if (game) fillRoom(game, roomId)
        return
      }

      if (type === 'join_room') {
        await joinRoom(ws, info, payload.roomId, payload.buyIn ?? 1000)
        return
      }

      if (type === 'leave_room') {
        leaveRoom(ws, info)
        return
      }

      if (type === 'set_ready') {
        const game = info.roomId ? rooms.get(info.roomId) : null
        if (!game) return sendError(ws, '尚未加入房間')
        game.setReady(info.userId)
        return
      }

      if (type === 'unready') {
        const game = info.roomId ? rooms.get(info.roomId) : null
        if (!game) return sendError(ws, '尚未加入房間')
        if (typeof game.unready === 'function') game.unready(info.userId)
        return
      }

      if (type === 'action') {
        const game = info.roomId ? rooms.get(info.roomId) : null
        if (!game) return sendError(ws, '尚未加入房間')
        game.processAction(info.userId, payload.action, payload.amount ?? 0)
        return
      }

      sendError(ws, '未知指令')
    } catch (err) {
      sendError(ws, err.message)
    }
  })

  ws.on('close', () => {
    const info = clients.get(ws)
    if (info?.roomId) {
      const game = rooms.get(info.roomId)
      const needsGrace = game?.phase !== 'waiting'
      if (needsGrace) {
        startGracePeriod(info.userId, info.roomId)
      } else {
        leaveRoom(ws, info)
      }
    }
    clients.delete(ws)
  })

  ws.on('error', () => ws.close())

  // Send current room list on connect
  const list = [...rooms.entries()].map(([id, game]) => ({
    id, gameType: 'texas-holdem', phase: game.phase,
    playerCount: game.players.length, maxPlayers: game.maxPlayers,
    smallBlind: game.smallBlind, bigBlind: game.bigBlind,
  }))
  wsSend(ws, { type: 'room_list', rooms: list })
})

// Ping keep-alive
setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) { ws.terminate(); return }
    ws.isAlive = false
    ws.ping()
  })
}, 30_000)

server.on('upgrade', async (request, socket, head) => {
  try {
    const url   = new URL(request.url, `http://${request.headers.host}`)
    const token = url.searchParams.get('token')
    if (!token) { socket.destroy(); return }
    const { rows } = await query(
      'SELECT u.* FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.token = $1',
      [token]
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

initDb()
  .then(() => seedBots())
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Texas Hold'em server listening on :${PORT}`)
      console.log(`WebSocket: ws://localhost:${PORT}?token=<your_token>`)
    })
  })
  .catch(err => { console.error('Boot failed:', err); process.exit(1) })
