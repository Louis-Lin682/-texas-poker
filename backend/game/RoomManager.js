import { randomUUID } from 'node:crypto'
import { query as dbQuery } from '../db.js'
import { PokerGame } from './PokerGame.js'
import { BigTwoGame } from './BigTwoGame.js'
import { BlackjackGame } from './BlackjackGame.js'
import { decideBigTwo } from './BigTwoBotPlayer.js'

export class RoomManager {
  constructor(pool = null) {
    // roomId → PokerGame
    this.rooms = new Map()
    // wsClient → { userId, username, roomId }
    this.clients = new Map()
    // roomId → setTimeout handle (AFK auto-pass for Big Two)
    this._afkTimers = new Map()
    // injected after construction
    this.botManager = null
    this.pool = pool
  }

  // ── Room lifecycle ────────────────────────────────────────

  createRoom(options = {}) {
    const roomId  = randomUUID().slice(0, 8).toUpperCase()
    const isBigTwo    = options.gameType === 'big-two'
    const isBlackjack = options.gameType === 'blackjack'
    const game = isBigTwo
      ? new BigTwoGame({ roomId, ...options })
      : isBlackjack
        ? new BlackjackGame({ roomId, ...options })
        : new PokerGame({ roomId, ...options })

    game.onEvent = (event) => this._handleGameEvent(event)

    this.rooms.set(roomId, game)
    this._broadcastRoomList()
    return roomId
  }

  getRoom(roomId) {
    return this.rooms.get(roomId) ?? null
  }

  listRooms() {
    return [...this.rooms.entries()].map(([id, game]) => ({
      id,
      gameType:    game.gameSlug ?? 'texas-holdem',
      phase:       game.phase,
      playerCount: game.players.length,
      maxPlayers:  game.maxPlayers,
      smallBlind:  game.smallBlind  ?? null,
      bigBlind:    game.bigBlind    ?? null,
      betUnit:     game.betUnit     ?? null,
    }))
  }

  // ── Client / connection management ───────────────────────

  registerClient(ws, { userId, username }) {
    this.clients.set(ws, { userId, username, roomId: null })
  }

  unregisterClient(ws) {
    const info = this.clients.get(ws)
    if (info?.roomId) {
      this._leaveRoom(ws, info)
    }
    this.clients.delete(ws)
  }

  // ── Message dispatch (called by ws server) ────────────────

  async handleMessage(ws, message) {
    const info = this.clients.get(ws)
    if (!info) return

    try {
      const { type, ...payload } = message

      if (type === 'list_rooms') {
        this._send(ws, { type: 'room_list', rooms: this.listRooms() })
        return
      }

      if (type === 'create_room') {
        const roomId = this.createRoom({
          gameType:   payload.gameType,
          smallBlind: payload.smallBlind,
          bigBlind:   payload.bigBlind,
          betUnit:    payload.betUnit,
          maxPlayers: payload.maxPlayers,
          gameSlug:   payload.gameSlug,
        })
        await this._joinRoom(ws, info, roomId, payload.buyIn ?? 1000)
        const game = this.rooms.get(roomId)
        if (game) this.botManager?.fillRoom(game, roomId)
        return
      }

      if (type === 'join_room') {
        await this._joinRoom(ws, info, payload.roomId, payload.buyIn ?? 1000)
        return
      }

      if (type === 'leave_room') {
        this._leaveRoom(ws, info)
        return
      }

      if (type === 'set_ready') {
        const game = this._roomOf(info)
        if (!game) return this._sendError(ws, '尚未加入房間')
        game.setReady(info.userId)
        return
      }

      if (type === 'start_game') {
        const game = this._roomOf(info)
        if (!game) return this._sendError(ws, '尚未加入房間')
        if (typeof game.startGame === 'function') game.startGame()
        return
      }

      if (type === 'action') {
        const game = this._roomOf(info)
        if (!game) return this._sendError(ws, '尚未加入房間')
        if (game.gameSlug === 'big-two') {
          game.processAction(info.userId, payload.action, payload.cards ?? [])
        } else {
          game.processAction(info.userId, payload.action, payload.amount ?? 0)
        }
        return
      }

      if (type === 'place_bet') {
        const game = this._roomOf(info)
        if (!game) return this._sendError(ws, '尚未加入房間')
        game.processAction(info.userId, 'bet', payload.amount ?? 0)
        return
      }

      this._sendError(ws, '未知指令')
    } catch (err) {
      this._sendError(ws, err.message)
    }
  }

  // ── Internal helpers ──────────────────────────────────────

  async _joinRoom(ws, info, roomId, buyIn) {
    if (info.roomId) this._leaveRoom(ws, info)

    // Reject suspended users
    if (this.pool) {
      const { rows } = await dbQuery('SELECT suspended_at FROM users WHERE id = $1', [info.userId])
      if (rows[0]?.suspended_at) return this._sendError(ws, '您已被停權，如有疑問，請聯繫客服')
    }

    const game = this.rooms.get(roomId)
    if (!game) return this._sendError(ws, '房間不存在')

    // Check joinability BEFORE deducting buy-in to avoid lost chips
    if (game.phase !== 'waiting') return this._sendError(ws, '遊戲進行中，無法加入')
    if (game.players.length >= game.maxPlayers) return this._sendError(ws, '房間已滿')

    if (this.pool) {
      const { rowCount } = await dbQuery(
        'UPDATE users SET balance = balance - $1 WHERE id = $2 AND balance >= $1',
        [buyIn, info.userId],
      )
      if (rowCount === 0) return this._sendError(ws, '餘額不足，無法進場')
    }

    // Record buy-in in ledger
    dbQuery(
      'INSERT INTO ledger (user_id, type, amount, room_id, game) VALUES ($1, $2, $3, $4, $5)',
      [info.userId, 'buy_in', -buyIn, roomId, game.gameSlug],
    ).catch(err => console.error('[ledger buy_in]', err))

    game.addPlayer({ id: info.userId, username: info.username, balance: buyIn })
    info.roomId = roomId

    this._send(ws, {
      type: 'room_joined',
      roomId,
      myId: info.userId,
      state: game.stateForPlayer(info.userId),
    })
    this._broadcastRoomList()
  }

  _leaveRoom(ws, info) {
    const roomId = info.roomId
    if (!roomId) return
    const game = this.rooms.get(roomId)
    info.roomId = null  // clear before counting remaining clients

    if (!game) return

    // Capture chips BEFORE removing (waiting-phase remove deletes from array)
    const player = game.players.find(p => p.id === info.userId)
    const cashout = player?.balance ?? 0

    game.removePlayer(info.userId)

    // Return remaining chips to DB and always record cash_out ledger entry
    if (this.pool) {
      const userId   = info.userId
      const gameSlug = game.gameSlug
      const doLedger = (bal) => {
        if (bal !== null) this._send(ws, { type: 'balance_update', balance: bal })
        return dbQuery(
          'INSERT INTO ledger (user_id, type, amount, room_id, game) VALUES ($1, $2, $3, $4, $5)',
          [userId, 'cash_out', cashout, roomId, gameSlug],
        ).catch(err => console.error('[ledger cash_out]', err))
      }
      if (cashout > 0) {
        dbQuery(
          'UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance',
          [cashout, userId],
        ).then(({ rows }) => doLedger(rows[0]?.balance ?? null))
          .catch(err => console.error('[cash-out]', err))
      } else {
        doLedger(null)
      }
    }

    // Check how many human connections remain in this room
    const humansLeft = [...this.clients.values()]
      .filter(c => c.roomId === roomId).length

    if (humansLeft === 0) {
      // Cancel AFK timer before closing
      const afk = this._afkTimers.get(roomId)
      if (afk) { clearTimeout(afk); this._afkTimers.delete(roomId) }
      // Last human left — stop bots and close room
      game.destroy()
      for (const p of [...game.players]) {
        if (this.botManager?.isBot(p.id)) {
          try { game.removePlayer(p.id) } catch {}
        }
      }
      this.rooms.delete(roomId)
      this.botManager?.notifyRoomClosed(roomId)
    }
    this._broadcastRoomList()
  }

  _roomOf(info) {
    return info.roomId ? this.rooms.get(info.roomId) ?? null : null
  }

  // ── Game event → WebSocket broadcast ─────────────────────

  _handleGameEvent({ type, roomId, ...data }) {
    const game = this.rooms.get(roomId)
    if (!game) return

    // Build the set of clients in this room
    const roomClients = [...this.clients.entries()]
      .filter(([, info]) => info.roomId === roomId)

    if (type === 'state_update') {
      // Each client gets personalised state (own hole cards)
      for (const [ws, info] of roomClients) {
        this._send(ws, {
          type: 'state_update',
          myId: info.userId,
          state: game.stateForPlayer(info.userId),
        })
      }
      // Let bots act if it's their turn
      this.botManager?.onStateUpdate(game, data.state)
      // Push playerCount changes to lobby clients (e.g. bots joining seeded rooms)
      this._broadcastRoomList()
      // AFK auto-pass timer for Big Two human turns
      if (game.gameSlug === 'big-two') this._resetAfkTimer(roomId, game)
      return
    }

    if (type === 'showdown' || type === 'hand_result') {
      // Sync bot balances to DB after each hand
      this.botManager?.syncBalances(game)

      // Write per-hand win/loss ledger entries for human players
      if (this.pool) {
        const winnerMap = new Map(data.winners.map(w => [w.id, w.amount]))
        for (const p of game.players) {
          if (!p.totalBet || this.botManager?.isBot(p.id)) continue
          const winAmt = winnerMap.get(p.id) ?? 0
          const net = winAmt ? winAmt - p.totalBet : -p.totalBet
          const entryType = winAmt ? 'hand_win' : 'hand_loss'
          dbQuery(
            'INSERT INTO ledger (user_id, type, amount, bet, room_id, game) VALUES ($1, $2, $3, $4, $5, $6)',
            [p.id, entryType, net, p.totalBet, roomId, game.gameSlug],
          ).catch(err => console.error('[ledger hand]', err))
        }
      }
    }

    if (type === 'hole_cards') {
      // Private: only send to the intended player
      const target = roomClients.find(([, info]) => info.userId === data.playerId)
      if (target) this._send(target[0], { type: 'hole_cards', cards: data.cards })
      return
    }

    if (type === 'deal') {
      // Big Two private deal — only send hand to the intended player
      const target = roomClients.find(([, info]) => info.userId === data.playerId)
      if (target) this._send(target[0], { type: 'deal', hand: data.hand })
      return
    }

    if (type === 'game_result') {
      // Big Two game end: sync bot balances and write human ledger entries
      this.botManager?.syncBalances(game)
      if (this.pool) {
        for (const s of data.scores) {
          if (this.botManager?.isBot(s.id)) continue
          const entryType = s.chipChange >= 0 ? 'hand_win' : 'hand_loss'
          dbQuery(
            'INSERT INTO ledger (user_id, type, amount, room_id, game) VALUES ($1, $2, $3, $4, $5)',
            [s.id, entryType, s.chipChange, roomId, game.gameSlug],
          ).catch(err => console.error('[ledger big-two]', err))
        }
      }
      // Fall through to broadcast game_result to all room clients
    }

    if (type === 'round_result') {
      // Blackjack round end: sync balances and write ledger entries
      this.botManager?.syncBalances(game)
      if (this.pool) {
        for (const r of data.results) {
          if (this.botManager?.isBot(r.id)) continue
          const net = r.totalReturn - r.totalBet
          const entryType = net >= 0 ? 'hand_win' : 'hand_loss'
          dbQuery(
            'INSERT INTO ledger (user_id, type, amount, bet, room_id, game) VALUES ($1, $2, $3, $4, $5, $6)',
            [r.id, entryType, net, r.totalBet, roomId, game.gameSlug],
          ).catch(err => console.error('[ledger blackjack]', err))
        }
      }
      return  // no need to broadcast this event to clients
    }

    // All other events broadcast to everyone in the room
    for (const [ws] of roomClients) {
      this._send(ws, { type, ...data })
    }
  }

  // Push updated room list to every client currently in the lobby
  _broadcastRoomList() {
    const list = this.listRooms()
    for (const [ws, info] of this.clients) {
      if (!info.roomId) this._send(ws, { type: 'room_list', rooms: list })
    }
  }

  _resetAfkTimer(roomId, game) {
    const existing = this._afkTimers.get(roomId)
    if (existing) { clearTimeout(existing); this._afkTimers.delete(roomId) }

    if (game.phase !== 'playing') return

    const actingId = game.players[game.currentPlayerIdx]?.id
    if (!actingId || this.botManager?.isBot(actingId)) return

    const t = setTimeout(() => {
      this._afkTimers.delete(roomId)
      const g = this.rooms.get(roomId)
      if (!g || g.phase !== 'playing') return
      const cur = g.players[g.currentPlayerIdx]
      if (!cur || cur.id !== actingId) return
      try {
        if (!g.pile || g.pile.playerId === actingId) {
          g.processAction(actingId, 'play', [cur.hand[0]])
        } else {
          g.processAction(actingId, 'pass')
        }
      } catch {
        try { g.processAction(actingId, 'pass') } catch {}
      }
    }, 30_000)

    this._afkTimers.set(roomId, t)
  }

  _send(ws, data) {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(JSON.stringify(data))
    }
  }

  _sendError(ws, message) {
    this._send(ws, { type: 'error', message })
  }
}
