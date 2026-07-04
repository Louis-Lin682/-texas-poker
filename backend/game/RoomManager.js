import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { query as dbQuery } from '../db.js'
import { PokerGame } from './PokerGame.js'
import { BigTwoGame } from './BigTwoGame.js'
import { BlackjackGame } from './BlackjackGame.js'
import { DragonTigerGame } from './DragonTigerGame.js'
import { getConfig as getDtConfig } from './dragonTigerConfig.js'
import { decideBigTwo } from './BigTwoBotPlayer.js'

// DIAGNOSTIC: chip-conservation audit trail, used to track down the zero-sum
// delta seen in bot-runner.js. Enable with CHIP_AUDIT=1. Safe to remove once
// root-caused. Logs the true DB total (runner + bots) at every event that
// should move chips into/out of that total, so a leak shows up as an
// unexplained jump between two consecutive lines.
const __dirname  = path.dirname(fileURLToPath(import.meta.url))
const AUDIT_LOG  = path.join(__dirname, '..', 'chip-audit.log')
const CHIP_AUDIT = process.env.CHIP_AUDIT === '1'
if (CHIP_AUDIT) fs.writeFileSync(AUDIT_LOG, `${new Date().toISOString()} ── audit start ──\n`)

// Blackjack and Dragon Tiger are fixed-odds, house-banked games: payouts aren't
// funded by other players' stakes, so without an explicit house account every
// round creates or destroys chips relative to the player-balance universe.
// This reserved account absorbs the opposite of whatever players collectively
// win/lose each round, keeping the global total constant. Not flagged is_bot so
// it stays outside bot-runner.js's zero-sum scope (sum of is_bot OR bot_runner).
export const HOUSE_USERNAME = '_house_bank'

export class RoomManager {
  constructor(pool = null) {
    // roomId → PokerGame
    this.rooms = new Map()
    // wsClient → { userId, username, roomId }
    this.clients = new Map()
    // roomId → setTimeout handle (AFK auto-pass for Big Two)
    this._afkTimers = new Map()
    // userId → { timer, roomId } — 30s reconnect grace for Dragon Tiger
    this._graceTimers = new Map()
    // injected after construction
    this.botManager = null
    this.pool = pool
    // id of the house bank account (see ensureHouseAccount), null until seeded
    this.houseId = null
  }

  // Seed (or look up) the reserved house-bank account used to absorb Blackjack /
  // Dragon Tiger payout imbalance. Call once at startup, mirroring botManager.seedBots().
  async ensureHouseAccount() {
    if (!this.pool) return
    const { rows } = await dbQuery(
      `INSERT INTO users (username, password_hash, balance, is_bot)
       VALUES ($1, 'HOUSE_RESERVED', 0, false)
       ON CONFLICT (username) DO NOTHING
       RETURNING id`,
      [HOUSE_USERNAME],
    )
    if (rows[0]) {
      this.houseId = rows[0].id
      return
    }
    const { rows: existing } = await dbQuery('SELECT id FROM users WHERE username = $1', [HOUSE_USERNAME])
    this.houseId = existing[0]?.id ?? null
  }

  // ── Room lifecycle ────────────────────────────────────────

  createRoom(options = {}) {
    const roomId  = randomUUID().slice(0, 8).toUpperCase()
    const isBigTwo      = options.gameType === 'big-two'
    const isBlackjack   = options.gameType === 'blackjack'
    const isDragonTiger = options.gameType === 'dragon-tiger'

    const game = isBigTwo
      ? new BigTwoGame({ roomId, ...options })
      : isBlackjack
        ? new BlackjackGame({ roomId, ...options })
        : isDragonTiger
          ? new DragonTigerGame({ roomId, ...options, getConfig: getDtConfig })
          : new PokerGame({ roomId, ...options })

    game.onEvent = (event) => this._handleGameEvent(event)

    this.rooms.set(roomId, game)
    if (isDragonTiger) {
      dbQuery('SELECT COALESCE(MAX(round_id), 0) AS max_id FROM dt_round_history')
        .then(({ rows }) => { game.roundId = Number(rows[0].max_id) })
        .catch(() => {})
        .finally(() => game.start())
    }
    this._broadcastRoomList()
    return roomId
  }

  // DIAGNOSTIC: see comment near AUDIT_LOG above. Fire-and-forget; queries the
  // real DB total (the same quantity bot-runner.js's zero-sum check uses) and
  // appends it with a context tag so we can pinpoint exactly which event
  // moves the total unexpectedly.
  _auditChips(ctx, roomId) {
    if (!this.pool || !CHIP_AUDIT) return
    dbQuery(`SELECT COALESCE(SUM(balance), 0)::bigint AS total FROM users WHERE username = 'bj_runner' OR username = '_house_bank' OR is_bot = true`)
      .then(({ rows }) => {
        fs.appendFileSync(AUDIT_LOG, `${new Date().toISOString()} room=${roomId} ${ctx} total=${rows[0].total}\n`)
      })
      .catch(err => {
        fs.appendFileSync(AUDIT_LOG, `${new Date().toISOString()} room=${roomId} ${ctx} AUDIT-ERROR ${err.message}\n`)
      })
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
      maxBet:      game.maxBet      ?? null,
    }))
  }

  // ── Client / connection management ───────────────────────

  registerClient(ws, { userId, username, avatar }) {
    this.clients.set(ws, { userId, username, avatar: avatar ?? '/notice-angel.png', roomId: null })
  }

  unregisterClient(ws) {
    const info = this.clients.get(ws)
    if (info?.roomId) {
      const game = this.rooms.get(info.roomId)
      this._leaveRoom(ws, info, true)
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
          maxBet:     payload.maxBet,
        })
        await this._joinRoom(ws, info, roomId, payload.buyIn ?? 1000)
        const game = this.rooms.get(roomId)
        if (game) this.botManager?.fillRoom(game, roomId)
        return
      }

      if (type === 'join_room') {
        await this._joinRoom(ws, info, payload.roomId, payload.buyIn ?? 1000)
        // DT: humans auto-join existing ambient rooms (not create_room), so
        // fillRoom was never called for this room. Top up bots whenever a human joins.
        const dtGame = this.rooms.get(payload.roomId)
        if (dtGame?.gameSlug === 'dragon-tiger') {
          const existingBots = dtGame.players.filter(p => this.botManager?.isBot(p.id)).length
          const needed = Math.max(0, 3 - existingBots)
          if (needed > 0) this.botManager?.fillRoom(dtGame, payload.roomId, needed)
        }
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

      if (type === 'unready') {
        const game = this._roomOf(info)
        if (!game) return this._sendError(ws, '尚未加入房間')
        if (typeof game.unready === 'function') game.unready(info.userId)
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

      if (type === 'dt_place_bet') {
        const game = this._roomOf(info)
        if (!game) return this._sendError(ws, '尚未加入房間')
        game.placeBet(info.userId, payload.zone, payload.amount ?? 0)
        return
      }

      if (type === 'dt_cancel_last_bet') {
        const game = this._roomOf(info)
        if (!game) return this._sendError(ws, '尚未加入房間')
        game.cancelLastBet(info.userId)
        return
      }

      if (type === 'dt_cancel_bets') {
        const game = this._roomOf(info)
        if (!game) return this._sendError(ws, '尚未加入房間')
        game.cancelBets(info.userId)
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

    // (Grace period removed — balance is returned immediately on disconnect)

    // Reject suspended users
    if (this.pool) {
      const { rows } = await dbQuery('SELECT suspended_at FROM users WHERE id = $1', [info.userId])
      if (rows[0]?.suspended_at) return this._sendError(ws, '您已被停權，如有疑問，請聯繫客服')
    }

    const game = this.rooms.get(roomId)
    if (!game) return this._sendError(ws, '房間不存在')

    // Dragon Tiger runs continuously — players can join at any phase
    const isDragonTiger = game.gameSlug === 'dragon-tiger'
    if (!isDragonTiger && game.phase !== 'waiting') return this._sendError(ws, '遊戲進行中，無法加入')
    if (game.players.length >= game.maxPlayers) return this._sendError(ws, '房間已滿')

    if (this.pool) {
      // Always read actual DB balance — client's buyIn may be stale
      const { rows: [balRow] } = await dbQuery(
        'SELECT balance FROM users WHERE id = $1', [info.userId],
      )
      buyIn = Number(balRow?.balance ?? 0)
      if (buyIn <= 0) {
        const hasPending = [...this.rooms.values()].some(
          g => g.players.some(p => p.id === info.userId && p._left)
        )
        throw new Error(hasPending ? '籌碼結算中，請稍後再試' : '餘額不足，無法加入房間')
      }
      await dbQuery('UPDATE users SET balance = 0 WHERE id = $1', [info.userId])

      // Guard: if WS disconnected while awaiting DB ops, undo the deduction and
      // abort — unregisterClient won't cashout because info.roomId is still null.
      if (!this.clients.has(ws)) {
        dbQuery('UPDATE users SET balance = balance + $1 WHERE id = $2', [buyIn, info.userId])
          .catch(err => console.error('[join-abort restore]', err))
        return
      }
    }

    // Record buy-in in ledger
    dbQuery(
      'INSERT INTO ledger (user_id, type, amount, room_id, game) VALUES ($1, $2, $3, $4, $5)',
      [info.userId, 'buy_in', -buyIn, roomId, game.gameSlug],
    ).catch(err => console.error('[ledger buy_in]', err))

    game.addPlayer({ id: info.userId, username: info.username, balance: buyIn, avatar: info.avatar })

    // Second guard: check again after addPlayer (sync, but covers the edge case
    // where disconnect arrived between the two guards and pool is null).
    if (this.pool && !this.clients.has(ws)) {
      game.removePlayer(info.userId)
      dbQuery('UPDATE users SET balance = balance + $1 WHERE id = $2', [buyIn, info.userId])
        .catch(err => console.error('[join-abort post-add restore]', err))
      return
    }

    info.roomId = roomId
    this._auditChips(`join:human buyIn=${buyIn}`, roomId)

    this._send(ws, {
      type: 'room_joined',
      roomId,
      myId: info.userId,
      state: game.stateForPlayer(info.userId),
    })
    this._broadcastRoomList()
  }

  // Admin-triggered: leave by userId + roomId (no ws required)
  _leaveRoomById(userId, roomId) {
    const ws = [...this.clients.entries()].find(([, info]) => info.userId === userId && info.roomId === roomId)?.[0]
    if (ws) {
      this._send(ws, { type: 'kicked' })
      this._leaveRoom(ws, this.clients.get(ws))
    } else {
      // Player has no active connection (bot or disconnected) — remove directly
      const game = this.rooms.get(roomId)
      if (!game) return
      const player = game.players.find(p => p.id === userId)
      const cashout = player?.balance ?? 0
      game.removePlayer(userId)
      if (this.pool && cashout > 0) {
        dbQuery('UPDATE users SET balance = balance + $1 WHERE id = $2', [cashout, userId]).catch(() => {})
        dbQuery('INSERT INTO ledger (user_id, type, amount, room_id, game) VALUES ($1, $2, $3, $4, $5)',
          [userId, 'cash_out', cashout, roomId, game.gameSlug]).catch(() => {})
      }
      this.botManager?.notifyPlayerLeft(userId)
      this._broadcastRoomList()
    }
  }

  _leaveRoom(ws, info, isDisconnect = false) {
    const roomId = info.roomId
    if (!roomId) return
    const game = this.rooms.get(roomId)
    info.roomId = null  // clear before counting remaining clients

    if (!game) return

    // Blackjack: if this player's hand is still unresolved, defer entirely to
    // the players_removed cleanup that fires once the shared dealer hand
    // resolves — see _blackjackPendingHand for why crediting balance now
    // would double-credit them.
    if (this._blackjackPendingHand(game, info.userId)) {
      game.removePlayer(info.userId)
      this._broadcastRoomList()
      return
    }

    // Capture chips BEFORE removing (waiting-phase remove deletes from array).
    // If a hand is in progress the player's blind/bets are in game.pot, not their
    // balance — add them back so chips are conserved when the room closes mid-hand.
    const player = game.players.find(p => p.id === info.userId)
    const midHandRefund = game.pot > 0 ? (player?.totalBet ?? 0) : 0
    // Voluntary leave mid-Dragon-Tiger-round: forfeit the pending bet to the
    // house. On disconnect, refund instead (same as _expireGrace).
    const dtPending = this._dtPendingBet(game, player)
    const dtForfeit = isDisconnect ? 0 : dtPending
    const dtRefund  = isDisconnect ? dtPending : 0
    const cashout = (player?.balance ?? 0) + midHandRefund + dtRefund

    game.removePlayer(info.userId)
    this._creditHouse(dtForfeit, roomId, 'voluntary-leave-forfeit')
    if (this.pool && dtForfeit > 0) {
      dbQuery(
        'INSERT INTO ledger (user_id, type, amount, bet, room_id, game, detail) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [info.userId, 'hand_loss', -dtForfeit, dtForfeit, roomId, game.gameSlug, JSON.stringify({ reason: 'left_mid_bet' })],
      ).catch(err => console.error('[ledger dt-forfeit]', err))
    }
    if (this.pool && midHandRefund > 0) {
      dbQuery(
        'INSERT INTO ledger (user_id, type, amount, bet, room_id, game, detail) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [info.userId, 'bet_void', midHandRefund, midHandRefund, roomId, game.gameSlug, JSON.stringify({ reason: 'left_mid_hand' })],
      ).catch(err => console.error('[ledger mid-hand-refund]', err))
    }

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

    // Close the room if no humans (connected or in grace) remain. destroy()
    // clears this game's timers; we never call game.removePlayer() again
    // after that — removePlayer()'s mid-hand fold path can reschedule a
    // brand-new streetTimer/nextHandTimer on this now-orphaned game, which
    // can later fire _advancePhase()/_goToShowdown() with zero eligible
    // players and crash.
    this._closeRoomIfEmpty(roomId, game, `room-close cashout=${cashout}`)
    this._broadcastRoomList()
  }

  _startGracePeriod(userId, roomId) {
    const existing = this._graceTimers.get(userId)
    if (existing) clearTimeout(existing.timer)

    const timer = setTimeout(() => {
      this._graceTimers.delete(userId)
      try { this._expireGrace(userId, roomId) } catch (err) { console.error('[_expireGrace]', err) }
    }, 30_000)

    this._graceTimers.set(userId, { timer, roomId })
  }

  _expireGrace(userId, roomId) {
    const game = this.rooms.get(roomId)
    if (!game) return

    // Blackjack: defer entirely to players_removed, same as _leaveRoom.
    if (this._blackjackPendingHand(game, userId)) {
      game.removePlayer(userId)
      return
    }

    const player  = game.players.find(p => p.id === userId)
    const midHandRefund = game.pot > 0 ? (player?.totalBet ?? 0) : 0
    // Disconnect/grace-expiry mid-Dragon-Tiger-round: refund the pending bet
    // to the player — this wasn't their choice, unlike a voluntary leave.
    const dtRefund = this._dtPendingBet(game, player)
    const cashout = (player?.balance ?? 0) + midHandRefund + dtRefund

    game.removePlayer(userId)

    if (this.pool) {
      const gameSlug = game.gameSlug
      if (cashout > 0) {
        dbQuery(
          'UPDATE users SET balance = balance + $1 WHERE id = $2',
          [cashout, userId],
        ).catch(err => console.error('[grace expire cash-out]', err))
      }
      if (midHandRefund > 0) {
        dbQuery(
          'INSERT INTO ledger (user_id, type, amount, bet, room_id, game, detail) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [userId, 'bet_void', midHandRefund, midHandRefund, roomId, gameSlug, JSON.stringify({ reason: 'disconnect_mid_hand' })],
        ).catch(err => console.error('[ledger mid-hand-refund]', err))
      }
      if (dtRefund > 0) {
        dbQuery(
          'INSERT INTO ledger (user_id, type, amount, bet, room_id, game, detail) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [userId, 'bet_void', dtRefund, dtRefund, roomId, gameSlug, JSON.stringify({ reason: 'disconnect_mid_bet' })],
        ).catch(err => console.error('[ledger dt-refund]', err))
      }
      dbQuery(
        'INSERT INTO ledger (user_id, type, amount, room_id, game) VALUES ($1, $2, $3, $4, $5)',
        [userId, 'cash_out', cashout, roomId, gameSlug],
      ).catch(err => console.error('[ledger grace expire]', err))
    }

    // See _leaveRoom for why we don't call game.removePlayer() again below.
    if (this._closeRoomIfEmpty(roomId, game, `grace-expire-close cashout=${cashout}`)) {
      this._broadcastRoomList()
    }
  }

  _roomOf(info) {
    return info.roomId ? this.rooms.get(info.roomId) ?? null : null
  }

  // Dragon Tiger deducts a bet from balance immediately on placement, but it
  // only resolves at _settle() — if a player is removed mid-round (betting/
  // dealing phase) before that, the staked amount is neither in `balance` nor
  // in any pot. Callers use this to either forfeit it to the house (voluntary
  // leave) or refund it to the player (disconnect/grace-expiry).
  _dtPendingBet(game, player) {
    if (!player || game.gameSlug !== 'dragon-tiger') return 0
    if (game.phase !== 'betting' && game.phase !== 'dealing') return 0
    return Object.values(player.bets ?? {}).reduce((a, v) => a + v, 0)
  }

  _creditHouse(amount, roomId, ctx) {
    if (!this.pool || !this.houseId || !amount) return
    dbQuery('UPDATE users SET balance = balance + $1 WHERE id = $2', [amount, this.houseId])
      .catch(err => console.error('[house credit]', err))
    this._auditChips(`house-credit ${ctx} amount=${amount}`, roomId)
  }

  // BlackjackGame.removePlayer() only ever splices a player out of game.players
  // when phase === 'waiting'; for any other phase it just flags p._left = true
  // and leaves them in place, because their bet (if any) is already riding on
  // the round's one shared dealer hand and can't be cleanly forfeited or
  // refunded mid-round. That flagged player isn't actually purged until the
  // round naturally finishes and _resetWaiting() processes its `kicked` list,
  // which fires its own players_removed credit. So whenever phase !== 'waiting',
  // crediting player.balance here too would double-credit them once that
  // later cleanup runs — the caller must defer to it instead.
  _blackjackPendingHand(game, userId) {
    if (!game) return false
    if (game.gameSlug !== 'blackjack' || game.phase === 'waiting') return false
    return game.players.some(p => p.id === userId)
  }

  // Shared "close this room if no humans (connected or in grace) remain"
  // check. Used after any event that might leave a room human-less: explicit
  // leave, grace-period expiry, or a deferred players_removed cleanup (e.g.
  // the Blackjack case above, where closing has to wait until the pending
  // hand actually resolves — destroying the room earlier would kill the
  // timers _resolve()/_resetWaiting() need to run).
  _closeRoomIfEmpty(roomId, game, ctx) {
    const humansLeft = [...this.clients.values()].filter(c => c.roomId === roomId).length
    const graceLeft  = [...this._graceTimers.values()].filter(g => g.roomId === roomId).length
    if (humansLeft > 0 || graceLeft > 0) return false

    const afk = this._afkTimers.get(roomId)
    if (afk) { clearTimeout(afk); this._afkTimers.delete(roomId) }
    // Return mid-hand pot chips to remaining players (bots) before syncing so
    // chips inside game.pot aren't silently destroyed when the room closes.
    if (game.pot > 0) {
      for (const p of game.players) p.balance += (p.totalBet ?? 0)
      game.pot = 0
    }
    // For DT: refund bots' pending (unresolved) bets so they aren't silently
    // destroyed when the room closes mid-round. House already absorbed the
    // leaving human's bets via _dtPendingBet; bots' bets just get cancelled.
    // MUST check phase: in 'result' phase p.bets still holds the just-settled
    // round's values (cleared in _startBetting, 5 s later) — refunding them
    // would double-credit bots and create chips out of thin air.
    if (game.gameSlug === 'dragon-tiger' &&
        (game.phase === 'betting' || game.phase === 'dealing')) {
      for (const p of game.players) {
        const pending = Object.values(p.bets || {}).reduce((a, v) => a + v, 0)
        if (pending > 0) p.balance += pending
      }
    }
    this.botManager?.syncBalances(game)
    this._auditChips(ctx, roomId)
    game.destroy()
    this.rooms.delete(roomId)
    this.botManager?.notifyRoomClosed(roomId)
    return true
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
      // Guard: room already deleted (close sequence in progress) — skip spurious sync
      if (!this.rooms.has(roomId)) return
      // Sync bot balances to DB after each hand
      this.botManager?.syncBalances(game)
      this._auditChips('hand-end', roomId)

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
      // Blackjack / Dragon Tiger round end: sync balances and write ledger entries
      this.botManager?.syncBalances(game)
      if (this.pool) {
        let playerNetTotal = 0
        for (const r of data.results) {
          if (!r.totalBet) continue
          const net = r.totalReturn - r.totalBet
          playerNetTotal += net
          if (this.botManager?.isBot(r.id)) continue
          const entryType = net >= 0 ? 'hand_win' : 'hand_loss'
          dbQuery(
            'INSERT INTO ledger (user_id, type, amount, bet, room_id, game, detail) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [r.id, entryType, net, r.totalBet, roomId, game.gameSlug, r.detail ? JSON.stringify(r.detail) : null],
          ).catch(err => console.error('[ledger round]', err))
        }
        // House absorbs the exact opposite of every player's (bot + human) net
        // this round — see HOUSE_USERNAME comment above for why this is needed.
        if (this.houseId && playerNetTotal !== 0) {
          dbQuery('UPDATE users SET balance = balance - $1 WHERE id = $2', [playerNetTotal, this.houseId])
            .catch(err => console.error('[house adjust]', err))
        }
        this._auditChips(`round-result net=${playerNetTotal}`, roomId)
        // Record DT round to shared history table
        if (game.gameSlug === 'dragon-tiger') {
          const st = data.state
          if (st?.dragonCard && st?.tigerCard && st?.result) {
            dbQuery(
              'INSERT INTO dt_round_history (round_id, result, dragon_rank, dragon_suit, tiger_rank, tiger_suit) VALUES ($1,$2,$3,$4,$5,$6)',
              [st.roundId ?? null, st.result, st.dragonCard.rank, st.dragonCard.suit, st.tigerCard.rank, st.tigerCard.suit],
            ).catch(err => console.error('[dt history]', err))
          }
        }
      }
      return  // no need to broadcast this event to clients
    }

    if (type === 'players_removed') {
      // Return remaining chips to DB for players kicked due to insufficient balance,
      // or whose cash-out was deferred because they left/disconnected mid-hand
      // (see _blackjackPendingHand) — reason: 'left' identifies the latter.
      for (const p of data.players) {
        if (this.botManager?.isBot(p.id)) continue
        // A 'left' player already navigated away from this room (info.roomId
        // is no longer roomId) — match them by userId alone, wherever they
        // are now, so they still get their resolved balance pushed live.
        const entry = [...this.clients.entries()]
          .find(([, info]) => info.userId === p.id && (p.reason === 'left' || info.roomId === roomId))
        if (entry && p.reason !== 'left') {
          const [ws, info] = entry
          info.roomId = null
          this._send(ws, { type: 'kicked_from_room', message: '籌碼不足，已離開房間' })
        }
        if (this.pool && p.balance > 0) {
          const userId = p.id
          const gameSlug = game.gameSlug
          dbQuery(
            'UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance',
            [p.balance, userId],
          ).then(({ rows }) => {
            if (entry) this._send(entry[0], { type: 'balance_update', balance: rows[0]?.balance })
          }).catch(err => console.error('[kick return chips]', err))
          dbQuery(
            'INSERT INTO ledger (user_id, type, amount, room_id, game) VALUES ($1, $2, $3, $4, $5)',
            [userId, 'cash_out', p.balance, roomId, gameSlug],
          ).catch(err => console.error('[ledger kick]', err))
        }
      }
      // Re-check: closing may have been deferred (e.g. a human left/disconnected
      // mid-Blackjack-hand — see _blackjackPendingHand) until this cleanup ran.
      this._closeRoomIfEmpty(roomId, game, 'players-removed-close')
      this._broadcastRoomList()
      return
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
    if (!actingId) return

    const isBot = this.botManager?.isBot(actingId) ?? false
    if (!isBot) return

    const timeout = 5_000

    const t = setTimeout(() => {
      this._afkTimers.delete(roomId)
      const g = this.rooms.get(roomId)
      if (!g || g.phase !== 'playing') return
      const cur = g.players[g.currentPlayerIdx]
      if (!cur || cur.id !== actingId) return
      try {
        if (!g.pile || g.pile.playerId === actingId) {
          g.processAction(actingId, 'play', cur.hand[0] ? [cur.hand[0]] : [])
        } else {
          g.processAction(actingId, 'pass')
        }
      } catch {
        try { g.processAction(actingId, 'pass') } catch {}
      }
    }, timeout)

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
