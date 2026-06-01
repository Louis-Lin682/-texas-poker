import { decide } from './BotPlayer.js'
import { decideBigTwo } from './BigTwoBotPlayer.js'
import { query as dbQuery } from '../db.js'

const THINK_MIN = 900
const THINK_MAX = 2800

const BOT_DEFS = [
  { username: '阿明', balance: 10000 },
  { username: '小龍', balance: 10000 },
  { username: '大寶', balance: 10000 },
  { username: '阿文', balance: 10000 },
  { username: '小慧', balance: 10000 },
  { username: '大山', balance: 10000 },
]

export class BotManager {
  constructor(pool) {
    this.pool = pool
    // id → { username, balance, roomId }
    this.bots = new Map()
    // id → setTimeout handle (action timers)
    this._timers = new Map()
    // roomId → [setTimeout handles] (staggered join timers)
    this._joinTimers = new Map()
  }

  // ── Seed bot accounts ─────────────────────────────────────

  async seedBots() {
    for (const b of BOT_DEFS) {
      const { rows } = await dbQuery(
        `INSERT INTO users (username, password_hash, balance, is_bot)
         VALUES ($1, 'BOT_RESERVED', $2, true)
         ON CONFLICT (username) DO UPDATE SET is_bot = true
         RETURNING id, username, balance`,
        [b.username, b.balance],
      )
      this.bots.set(rows[0].id, { username: rows[0].username, balance: rows[0].balance, roomId: null })
    }
  }

  // ── Queries ───────────────────────────────────────────────

  isBot(userId) { return this.bots.has(userId) }

  // ── Room management ───────────────────────────────────────

  fillRoom(game, roomId, count = 3) {
    const handles = []
    let added = 0
    let joinDelay = 1800
    for (const [id, info] of this.bots) {
      if (added >= count) break
      if (info.roomId !== null) continue

      const botId = id
      const botInfo = info
      const buyIn = info.balance < 200 ? 2000 : Math.min(info.balance, 2000)

      // Reserve the slot immediately so concurrent fillRoom calls don't double-pick
      botInfo.roomId = roomId

      const t = setTimeout(() => {
        // Remove this handle from the list
        const list = this._joinTimers.get(roomId)
        if (list) list.splice(list.indexOf(t), 1)

        try {
          game.addPlayer({ id: botId, username: botInfo.username, balance: buyIn })
          const rt = setTimeout(() => {
            try { game.setReady(botId) } catch {}
          }, 800 + Math.random() * 1200)
          this._joinTimers.get(roomId)?.push(rt)
        } catch {
          botInfo.roomId = null
        }
      }, joinDelay)

      handles.push(t)
      joinDelay += 2000 + Math.floor(Math.random() * 1200)
      added++
    }
    this._joinTimers.set(roomId, handles)
  }

  notifyRoomClosed(roomId) {
    // Cancel any pending staggered join timers
    const handles = this._joinTimers.get(roomId) ?? []
    handles.forEach(t => clearTimeout(t))
    this._joinTimers.delete(roomId)

    for (const [id, info] of this.bots) {
      if (info.roomId === roomId) {
        this._cancelTimer(id)
        info.roomId = null
      }
    }
  }

  notifyPlayerLeft(userId) {
    const info = this.bots.get(userId)
    if (info) {
      this._cancelTimer(userId)
      info.roomId = null
    }
  }

  // ── Game event hooks ──────────────────────────────────────

  // Called by RoomManager on every state_update, passing the full game object
  onStateUpdate(game, publicState) {
    if (game.gameSlug === 'big-two') {
      this._handleBigTwoTurn(game, publicState)
      return
    }

    if (publicState.phase === 'waiting') {
      // Free bots silently removed from game (e.g. balance hit 0 in _startHand)
      for (const [id, info] of this.bots) {
        if (info.roomId === game.roomId && !game.players.some(p => p.id === id)) {
          this._cancelTimer(id)
          info.roomId = null
        }
      }
      const hasHuman = publicState.players.some(p => !this.isBot(p.id))
      if (!hasHuman) return
      for (const p of publicState.players) {
        if (!this.isBot(p.id) || p.ready) continue
        this._cancelTimer(p.id)
        const delay = 1200 + Math.random() * 2000
        const t = setTimeout(() => {
          this._timers.delete(p.id)
          try { game.setReady(p.id) } catch {}
        }, delay)
        this._timers.set(p.id, t)
      }
      return
    }

    const actingId = publicState.actingPlayerId
    if (!actingId || !this.isBot(actingId)) return

    this._cancelTimer(actingId)

    const me = publicState.players.find(p => p.id === actingId)
    if (!me) return

    const delay = THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN)
    const timer = setTimeout(() => {
      this._timers.delete(actingId)
      const acting = game._actingPlayer()
      if (!acting || acting.id !== actingId) return

      const botPlayer = game.players.find(p => p.id === actingId)
      if (!botPlayer || botPlayer.status !== 'active') return

      const dec = decide({
        holeCards:      botPlayer.holeCards ?? [],
        communityCards: publicState.communityCards,
        phase:          publicState.phase,
        currentBet:     publicState.currentBet,
        myRoundBet:     me.roundBet,
        myBalance:      me.balance,
        pot:            publicState.pot,
        minRaise:       publicState.minRaise ?? publicState.bigBlind ?? 20,
      })

      try {
        game.processAction(actingId, dec.action, dec.amount ?? 0)
      } catch {
        try { game.processAction(actingId, 'fold') } catch {}
      }
    }, delay)

    this._timers.set(actingId, timer)
  }

  _handleBigTwoTurn(game, publicState) {
    // Auto-ready bots whenever we're in waiting phase (handles post-game resets).
    // Only auto-ready if at least one human is in the room — bots should not start
    // games among themselves, which would block humans from joining mid-game.
    if (publicState.phase === 'waiting') {
      // Free bots silently removed from game (e.g. balance hit 0 in _resetGame)
      for (const [id, info] of this.bots) {
        if (info.roomId === game.roomId && !game.players.some(p => p.id === id)) {
          this._cancelTimer(id)
          info.roomId = null
        }
      }
      const hasHuman = publicState.players.some(p => !this.isBot(p.id))
      if (!hasHuman) return
      for (const p of publicState.players) {
        if (!this.isBot(p.id) || p.ready) continue
        this._cancelTimer(p.id)
        const delay = 1200 + Math.random() * 2000
        const t = setTimeout(() => {
          this._timers.delete(p.id)
          try { game.setReady(p.id) } catch {}
        }, delay)
        this._timers.set(p.id, t)
      }
      return
    }

    const actingId = publicState.currentPlayerId
    if (!actingId || !this.isBot(actingId)) return

    this._cancelTimer(actingId)

    const botPlayer = game.players.find(p => p.id === actingId)
    if (!botPlayer || botPlayer.status !== 'playing') return

    const delay = THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN)
    const timer = setTimeout(() => {
      this._timers.delete(actingId)
      if (game.players[game.currentPlayerIdx]?.id !== actingId) return
      const bp = game.players.find(p => p.id === actingId)
      if (!bp || bp.status !== 'playing') return

      const dec = decideBigTwo({
        hand:          bp.hand,
        pile:          game.pile,
        isFirstOfGame: game._hasPlayed.size === 0,
      })

      try {
        game.processAction(actingId, dec.action, dec.cards ?? [])
      } catch {
        try { game.processAction(actingId, 'pass') } catch {}
      }
    }, delay)

    this._timers.set(actingId, timer)
  }

  // Sync in-game balances back to DB after each hand
  syncBalances(game) {
    for (const p of game.players) {
      const info = this.bots.get(p.id)
      if (!info) continue
      info.balance = p.balance
      dbQuery('UPDATE users SET balance = $1 WHERE id = $2', [p.balance, p.id])
        .catch(() => {})
    }
  }

  // ── Helpers ───────────────────────────────────────────────

  _cancelTimer(id) {
    const t = this._timers.get(id)
    if (t) { clearTimeout(t); this._timers.delete(id) }
  }
}
