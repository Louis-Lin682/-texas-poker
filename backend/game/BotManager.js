import { decide } from './BotPlayer.js'
import { decideBigTwo } from './BigTwoBotPlayer.js'
import { decideBlackjack } from './BlackjackBotPlayer.js'
import { cardFaceValue } from './BlackjackGame.js'
import { query as dbQuery } from '../db.js'

const THINK_MIN = 350
const THINK_MAX = 800

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
    // id → setTimeout handle (ready + action timers)
    this._timers = new Map()
    // ids of bots that already have a game-phase action timer set (not ready timers)
    this._actionBots = new Set()
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
    if (game.gameSlug === 'blackjack') {
      this._handleBlackjackTurn(game, publicState)
      return
    }
    if (game.gameSlug === 'dragon-tiger') {
      this._handleDragonTigerTurn(game, publicState)
      return
    }

    if (publicState.phase === 'waiting') {
      // Clear stale game-phase action tracking from previous hand
      for (const p of publicState.players) {
        if (this.isBot(p.id)) this._actionBots.delete(p.id)
      }
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
        const delay = 600 + Math.random() * 800
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
    if (this._actionBots.has(actingId)) return
    this._cancelTimer(actingId)

    const me = publicState.players.find(p => p.id === actingId)
    if (!me) return
    this._actionBots.add(actingId)

    const delay = THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN)
    const timer = setTimeout(() => {
      this._actionBots.delete(actingId)
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
      // Clear stale game-phase action tracking from previous game
      for (const p of publicState.players) {
        if (this.isBot(p.id)) this._actionBots.delete(p.id)
      }
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
        const delay = 600 + Math.random() * 800
        const t = setTimeout(() => {
          this._timers.delete(p.id)
          try { game.setReady(p.id) } catch {}
        }, delay)
        this._timers.set(p.id, t)
      }
      return
    }

    if (publicState.phase !== 'playing') return

    const actingId = publicState.currentPlayerId
    if (!actingId || !this.isBot(actingId)) return
    if (this._actionBots.has(actingId)) return
    this._cancelTimer(actingId)

    const botPlayer = game.players.find(p => p.id === actingId)
    if (!botPlayer || botPlayer.status !== 'playing') return
    this._actionBots.add(actingId)

    const delay = THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN)
    const timer = setTimeout(() => {
      this._actionBots.delete(actingId)
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
        // Smarter fallback: if free turn, must play a card; otherwise try pass
        const pile = game.pile
        const canPass = pile && pile.playerId !== actingId
        if (canPass) {
          try { game.processAction(actingId, 'pass') } catch {}
        } else {
          for (const card of (bp.hand ?? [])) {
            try { game.processAction(actingId, 'play', [card]); break } catch {}
          }
        }
      }
    }, delay)

    this._timers.set(actingId, timer)
  }

  _handleBlackjackTurn(game, publicState) {
    if (publicState.phase === 'waiting') {
      // Clear stale game-phase action tracking from previous hand
      for (const p of publicState.players) {
        if (this.isBot(p.id)) this._actionBots.delete(p.id)
      }
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
        const delay = 800 + Math.random() * 1500
        const t = setTimeout(() => {
          this._timers.delete(p.id)
          try { game.setReady(p.id) } catch {}
        }, delay)
        this._timers.set(p.id, t)
      }
      return
    }

    if (publicState.phase === 'betting') {
      // Clear stale action tracking when a new betting round starts
      for (const p of publicState.players) {
        if (this.isBot(p.id)) this._actionBots.delete(p.id)
      }
      for (const p of publicState.players) {
        if (!this.isBot(p.id) || p.bet > 0) continue
        this._cancelTimer(p.id)
        const delay = 800 + Math.random() * 2000
        const t = setTimeout(() => {
          this._timers.delete(p.id)
          const units = Math.floor(Math.random() * 3) + 1
          const betAmt = units * game.betUnit
          try { game.processAction(p.id, 'bet', betAmt) } catch {}
        }, delay)
        this._timers.set(p.id, t)
      }
      return
    }

    if (publicState.phase === 'playing') {
      const actingId = publicState.currentActorId
      if (!actingId || !this.isBot(actingId)) return
      if (this._actionBots.has(actingId)) return
      this._cancelTimer(actingId)

      const actor0 = game._roundPlayers?.[game._actorIdx]
      if (!actor0 || actor0.id !== actingId) return
      this._actionBots.add(actingId)

      const delay = THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN)
      const t = setTimeout(() => {
        this._actionBots.delete(actingId)
        this._timers.delete(actingId)
        if (game.phase !== 'playing') return
        if (game._roundPlayers[game._actorIdx]?.id !== actingId) return

        const actor = game._roundPlayers[game._actorIdx]
        if (!actor) return
        const hand = actor.hands[actor.currentHandIdx]
        if (!hand || hand.status !== 'active') return

        const canDouble = hand.cards.length === 2 && actor.balance >= hand.bet
        const canSplit = hand.cards.length === 2 &&
          cardFaceValue(hand.cards[0]) === cardFaceValue(hand.cards[1]) &&
          actor.balance >= hand.bet &&
          actor.hands.length < 4

        const { action } = decideBlackjack({
          hand: hand.cards,
          dealerUp: game.dealer.cards[0],
          balance: actor.balance,
          handBet: hand.bet,
          canDouble,
          canSplit,
        })

        try {
          game.processAction(actingId, action, hand.bet)
        } catch {
          try { game.processAction(actingId, 'stand') } catch {}
        }
      }, delay)

      this._timers.set(actingId, t)
    }
  }

  _handleDragonTigerTurn(game, publicState) {
    // Free bots that were silently removed (e.g. balance hit 0)
    for (const [id, info] of this.bots) {
      if (info.roomId === game.roomId && !game.players.some(p => p.id === id)) {
        this._cancelTimer(id)
        info.roomId = null
      }
    }

    if (publicState.phase !== 'betting') return

    // Clear stale action tracking when a new round starts (bets reset to 0)
    for (const p of publicState.players) {
      if (this.isBot(p.id) && p.bets &&
          p.bets.dragon === 0 && p.bets.tie === 0 && p.bets.tiger === 0) {
        this._actionBots.delete(p.id)
      }
    }

    const ZONES   = ['dragon', 'dragon', 'tiger', 'tiger', 'tie']
    const AMOUNTS = [20, 50, 100, 500, 1000]

    for (const p of publicState.players) {
      if (!this.isBot(p.id)) continue
      if (this._actionBots.has(p.id)) continue
      const totalBet = p.bets ? p.bets.dragon + p.bets.tie + p.bets.tiger : 0
      if (totalBet > 0) continue
      this._actionBots.add(p.id)

      const delay = 1500 + Math.random() * 5000
      const t = setTimeout(() => {
        this._actionBots.delete(p.id)
        this._timers.delete(p.id)
        if (game.phase !== 'betting') return
        const botPlayer = game.players.find(pl => pl.id === p.id)
        if (!botPlayer || botPlayer.balance <= 0) return

        const zone   = ZONES[Math.floor(Math.random() * ZONES.length)]
        const amount = AMOUNTS[Math.floor(Math.random() * AMOUNTS.length)]
        try { game.placeBet(p.id, zone, Math.min(amount, botPlayer.balance)) } catch {}
      }, delay)

      this._timers.set(p.id, t)
    }
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
