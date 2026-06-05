import { createDeck, shuffle } from './deck.js'
import { determineWinners } from './evaluator.js'

function cmpScore(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1)
    if (d !== 0) return d
  }
  return 0
}

function pickWinners(evaluated) {
  let top = evaluated[0].hand.score
  for (const p of evaluated.slice(1)) {
    if (cmpScore(p.hand.score, top) > 0) top = p.hand.score
  }
  return evaluated.filter(p => cmpScore(p.hand.score, top) === 0)
}

const TURN_TIMEOUT_MS   = 30_000
const SHOWDOWN_DELAY_MS = 7_000
const STREET_PAUSE_MS   = 1_500
const FOLD_WIN_DELAY_MS = 5_500

export class PokerGame {
  constructor({ roomId, smallBlind = 10, bigBlind = 20, maxPlayers = 6, gameSlug = 'texas-holdem' } = {}) {
    this.roomId = roomId
    this.gameSlug = gameSlug
    this.smallBlind = smallBlind
    this.bigBlind = bigBlind
    this.maxPlayers = maxPlayers

    this.players = []
    // phase: waiting | pre_flop | flop | turn | river | showdown
    this.phase = 'waiting'
    this.communityCards = []
    this.deck = []
    this.pot = 0
    this.currentBet = 0
    this.lastRaiseSize = bigBlind
    this.actingIndex = -1
    this.dealerIndex = -1
    this._turnTimer = null
    this.turnDeadline = null
    this._countdownTimer = null
    this.countdownEnd = null
    this._streetTimer = null

    // Set by RoomManager: ({ type, ...data }) => void
    this.onEvent = null
  }

  // ── Player management ─────────────────────────────────────

  addPlayer({ id, username, balance }) {
    if (this.players.length >= this.maxPlayers) throw new Error('桌子已滿')
    if (this.phase !== 'waiting') throw new Error('遊戲進行中，請等待下一局')
    if (this.players.some(p => p.id === id)) throw new Error('已在桌上')
    this.players.push(this._newPlayerState(id, username, balance))
    this._emit('player_joined', { id, username, balance })
    this._broadcastState()
  }

  removePlayer(id) {
    if (this.phase !== 'waiting') {
      const p = this._findPlayer(id)
      if (p) {
        p.status = 'folded'
        p.balance = 0  // prevent re-activation in subsequent hands
      }
      this._emit('player_left', { id })

      // If it was this player's turn, don't wait 30s — advance immediately
      if (this._actingPlayer()?.id === id) {
        this._clearTurnTimer()
        try {
          this.processAction(id, 'fold')
        } catch {
          this._broadcastState()
        }
      } else {
        this._broadcastState()
      }
      return
    }

    this.players = this.players.filter(p => p.id !== id)
    if (this._countdownTimer) {
      const stillAllReady = this.players.length >= 2 && this.players.every(p => p.ready)
      if (!stillAllReady) this._clearCountdown()
    }
    this._emit('player_left', { id })
    this._broadcastState()
  }

  // ── Start / reset ─────────────────────────────────────────

  startGame() {
    if (this.phase !== 'waiting') throw new Error('遊戲已在進行中')
    const eligible = this.players.filter(p => p.balance > 0)
    if (eligible.length < 2) throw new Error('至少需要 2 名玩家且有籌碼')
    this._startHand()
  }

  _startHand() {
    this._clearCountdown()
    if (this._streetTimer) { clearTimeout(this._streetTimer); this._streetTimer = null }
    // Remove players who left mid-hand (balance was zeroed on disconnect)
    this.players = this.players.filter(p => p.balance > 0)
    this.deck = shuffle(createDeck())
    this.communityCards = []
    this.pot = 0
    this.currentBet = this.bigBlind
    this.lastRaiseSize = this.bigBlind

    for (const p of this.players) {
      p.holeCards = []
      p.roundBet = 0
      p.totalBet = 0
      p.hasActed = false
      p.isDealer = false
      p.isSB = false
      p.isBB = false
      p.ready = false
      p.status = p.balance > 0 ? 'active' : 'out'
    }

    const eligible = this.players.filter(p => p.status === 'active')
    if (eligible.length < 2) {
      this.phase = 'waiting'
      this._broadcastState()
      return
    }

    // Advance dealer clockwise among active players
    this.dealerIndex = this._nextActiveFrom(this.dealerIndex)
    const headsUp = eligible.length === 2

    const sbIdx = headsUp ? this.dealerIndex : this._nextActiveFrom(this.dealerIndex)
    const bbIdx = this._nextActiveFrom(sbIdx)
    const firstToActIdx = headsUp ? this.dealerIndex : this._nextActiveFrom(bbIdx)

    this.players[this.dealerIndex].isDealer = true
    this.players[sbIdx].isSB = true
    this.players[bbIdx].isBB = true

    this._postBlind(this.players[sbIdx], this.smallBlind)
    this._postBlind(this.players[bbIdx], this.bigBlind)

    // Deal 2 hole cards to each active player
    for (const p of this.players.filter(p => p.status === 'active')) {
      p.holeCards = [this.deck.pop(), this.deck.pop()]
      // Private event so server can send only to that player
      this._emit('hole_cards', { playerId: p.id, cards: p.holeCards })
    }

    this.phase = 'pre_flop'
    this.actingIndex = firstToActIdx

    this._emit('hand_started', { phase: this.phase })
    this._broadcastState()
    this._startTurnTimer()
  }

  // ── Player action ─────────────────────────────────────────

  processAction(playerId, action, amount = 0) {
    if (!['pre_flop','flop','turn','river'].includes(this.phase)) {
      throw new Error('現在不是下注階段')
    }
    const p = this._actingPlayer()
    if (!p || p.id !== playerId) throw new Error('不是你的回合')

    this._clearTurnTimer()

    const toCall = this.currentBet - p.roundBet

    switch (action) {
      case 'fold':
        p.status = 'folded'
        break

      case 'check':
        if (toCall > 0) throw new Error('無法 Check，需先 Call 或 Fold')
        p.hasActed = true
        break

      case 'call': {
        const chips = Math.min(toCall, p.balance)
        this._betChips(p, chips)
        if (p.balance === 0) p.status = 'all_in'
        p.hasActed = true
        break
      }

      case 'raise': {
        const total = toCall + amount
        // Allow going all-in for less than minimum raise
        if (total < p.balance && amount < this.lastRaiseSize) {
          throw new Error(`加注至少 ${this.lastRaiseSize} 籌碼`)
        }
        if (total >= p.balance) {
          // Goes all-in
          this._betChips(p, p.balance)
          if (p.roundBet > this.currentBet) {
            this.lastRaiseSize = p.roundBet - this.currentBet
            this.currentBet = p.roundBet
            // Reset everyone else's hasActed
            for (const other of this.players) {
              if (other.id !== p.id) other.hasActed = false
            }
          }
          p.status = 'all_in'
        } else {
          this._betChips(p, total)
          this.lastRaiseSize = amount
          this.currentBet = p.roundBet
          // Reset everyone else's hasActed
          for (const other of this.players) {
            if (other.id !== p.id) other.hasActed = false
          }
        }
        p.hasActed = true
        break
      }

      default:
        throw new Error('未知行動')
    }

    this._emit('player_action', {
      playerId,
      username: p.username,
      action,
      amount: action === 'raise' ? amount : (action === 'call' ? toCall : 0),
    })

    // If only one active player remains (everyone else folded), they win immediately
    const activePlayers = this.players.filter(p => p.status === 'active')
    if (activePlayers.length <= 1) {
      if (this._awardUncontested()) return
    }

    if (this._isBettingRoundOver()) {
      this._scheduleAdvance()
    } else {
      this._moveToNextActor()
      this._broadcastState()
      this._startTurnTimer()
    }
  }

  // ── Phase transitions ─────────────────────────────────────

  _scheduleAdvance() {
    if (this._streetTimer) return
    // Freeze acting player so bots don't try to act during the pause
    this.actingIndex = -1
    this._broadcastState()
    this._streetTimer = setTimeout(() => {
      this._streetTimer = null
      this._advancePhase()
    }, STREET_PAUSE_MS)
  }

  _advancePhase() {
    if (this._streetTimer) { clearTimeout(this._streetTimer); this._streetTimer = null }
    // Reset for next street
    for (const p of this.players) {
      p.roundBet = 0
      p.hasActed = false
    }
    this.currentBet = 0
    this.lastRaiseSize = this.bigBlind

    if (this.phase === 'pre_flop') {
      this.communityCards.push(this.deck.pop(), this.deck.pop(), this.deck.pop())
      this.phase = 'flop'
    } else if (this.phase === 'flop') {
      this.communityCards.push(this.deck.pop())
      this.phase = 'turn'
    } else if (this.phase === 'turn') {
      this.communityCards.push(this.deck.pop())
      this.phase = 'river'
    } else {
      this._goToShowdown()
      return
    }

    // Post-flop: first active player left of dealer
    this.actingIndex = this._nextActiveFrom(this.dealerIndex)

    this._emit('phase_changed', { phase: this.phase, communityCards: this.communityCards })
    this._broadcastState()
    this._startTurnTimer()
  }

  _goToShowdown() {
    this._clearTurnTimer()
    this.phase = 'showdown'

    const notFolded = this.players.filter(p => ['active', 'all_in'].includes(p.status))
    const { evaluated } = determineWinners(notFolded, this.communityCards)
    const evalMap = new Map(evaluated.map(p => [p.id, p]))

    const sidePots = this._calcSidePots()
    const winnerAmounts = new Map()

    for (const { amount, eligible } of sidePots) {
      const eligibleEval = evaluated.filter(p => eligible.includes(p.id))
      if (eligibleEval.length === 0) continue
      const potWinners = pickWinners(eligibleEval)
      const share = Math.floor(amount / potWinners.length)
      const extra = amount % potWinners.length
      potWinners.forEach((w, i) => {
        const player = this._findPlayer(w.id)
        const gain = share + (i === 0 ? extra : 0)
        if (player) player.balance += gain
        winnerAmounts.set(w.id, (winnerAmounts.get(w.id) ?? 0) + gain)
      })
    }

    const winners = [...winnerAmounts.entries()].map(([id, amount]) => ({
      id,
      username: this._findPlayer(id)?.username ?? '',
      handName: evalMap.get(id)?.hand?.name,
      amount,
    }))

    this._emit('showdown', {
      pot: this.pot,
      communityCards: this.communityCards,
      players: evaluated.map(p => ({
        id: p.id,
        username: p.username,
        holeCards: p.holeCards,
        handName: p.hand.name,
      })),
      winners,
    })

    this.pot = 0
    this._broadcastState()

    setTimeout(() => {
      if (this.players.filter(p => p.balance > 0).length >= 2) {
        this._startHand()
      } else {
        this.phase = 'waiting'
        this._broadcastState()
      }
    }, SHOWDOWN_DELAY_MS)
  }

  _calcSidePots() {
    const sorted = [...this.players]
      .filter(p => p.totalBet > 0)
      .sort((a, b) => a.totalBet - b.totalBet)

    const pots = []
    let prevLevel = 0

    for (const { totalBet } of sorted) {
      if (totalBet <= prevLevel) continue
      const cap = totalBet - prevLevel
      let potSize = 0
      for (const p of this.players) {
        potSize += Math.min(Math.max(0, p.totalBet - prevLevel), cap)
      }
      const eligible = this.players
        .filter(p => p.totalBet >= totalBet && ['active', 'all_in'].includes(p.status))
        .map(p => p.id)
      if (potSize > 0 && eligible.length > 0) pots.push({ amount: potSize, eligible })
      prevLevel = totalBet
    }

    if (pots.length === 0) {
      const eligible = this.players.filter(p => ['active', 'all_in'].includes(p.status)).map(p => p.id)
      return [{ amount: this.pot, eligible }]
    }
    return pots
  }

  // ── Helpers ───────────────────────────────────────────────

  _awardUncontested() {
    const active = this.players.filter(p => p.status === 'active')
    const allIn  = this.players.filter(p => p.status === 'all_in')

    if (active.length === 0 && allIn.length > 1) {
      // Multiple all-in players → go to showdown (run out the board)
      while (this.communityCards.length < 5) this.communityCards.push(this.deck.pop())
      this._goToShowdown()
      return true
    }

    if (active.length + allIn.length === 1) {
      const winner = (active[0] || allIn[0])
      winner.balance += this.pot
      this._emit('hand_result', {
        winners: [{ id: winner.id, username: winner.username, amount: this.pot }],
        pot: this.pot,
        folded: true,
      })
      this.pot = 0
      this.actingIndex = -1  // freeze bots until next hand starts
      this._broadcastState()
      setTimeout(() => {
        if (this.players.filter(p => p.balance > 0).length >= 2) this._startHand()
        else { this.phase = 'waiting'; this._broadcastState() }
      }, FOLD_WIN_DELAY_MS)
      return true
    }
    return false
  }

  _isBettingRoundOver() {
    const canAct = this.players.filter(p => p.status === 'active')
    if (canAct.length === 0) return true
    return canAct.every(p => p.hasActed && p.roundBet === this.currentBet)
  }

  _moveToNextActor() {
    const start = this.actingIndex
    let idx = (this.actingIndex + 1) % this.players.length
    while (idx !== start) {
      if (this.players[idx]?.status === 'active') {
        this.actingIndex = idx
        return
      }
      idx = (idx + 1) % this.players.length
    }
  }

  _nextActiveFrom(fromIndex) {
    const n = this.players.length
    for (let i = 1; i <= n; i++) {
      const idx = (fromIndex + i) % n
      if (['active','all_in'].includes(this.players[idx]?.status)) return idx
    }
    return fromIndex
  }

  _postBlind(player, amount) {
    const chips = Math.min(amount, player.balance)
    player.balance -= chips
    player.roundBet += chips
    player.totalBet += chips
    this.pot += chips
    if (player.balance === 0) player.status = 'all_in'
  }

  _betChips(player, amount) {
    const chips = Math.min(amount, player.balance)
    player.balance -= chips
    player.roundBet += chips
    player.totalBet += chips
    this.pot += chips
  }

  _actingPlayer() {
    if (this.actingIndex < 0 || this.actingIndex >= this.players.length) return null
    return this.players[this.actingIndex]
  }

  _findPlayer(id) {
    return this.players.find(p => p.id === id)
  }

  setReady(playerId) {
    const p = this._findPlayer(playerId)
    if (!p) return
    p.ready = true
    this._broadcastState()
    this._checkCountdown()
  }

  unready(playerId) {
    if (this.phase !== 'waiting') return
    const p = this._findPlayer(playerId)
    if (!p || !p.ready) return
    p.ready = false
    const eligible = this.players.filter(p => p.balance > 0)
    if (!eligible.some(p => p.ready)) this._clearCountdown()
    this._broadcastState()
  }

  _checkCountdown() {
    if (this.phase !== 'waiting') return
    const eligible = this.players.filter(p => p.balance > 0)
    if (eligible.length < 2) return
    if (this._countdownTimer) return
    if (!eligible.some(p => p.ready)) return

    const COUNTDOWN_MS = 30_000
    this.countdownEnd = Date.now() + COUNTDOWN_MS
    this._broadcastState()

    this._countdownTimer = setTimeout(() => {
      this._countdownTimer = null
      this.countdownEnd = null
      try { this.startGame() } catch {}
    }, COUNTDOWN_MS)
  }

  _clearCountdown() {
    if (this._countdownTimer) {
      clearTimeout(this._countdownTimer)
      this._countdownTimer = null
    }
    this.countdownEnd = null
  }

  _newPlayerState(id, username, balance) {
    return {
      id, username, balance,
      holeCards: [], roundBet: 0, totalBet: 0, hasActed: false,
      status: 'waiting',
      isDealer: false, isSB: false, isBB: false,
      ready: false,
    }
  }

  _startTurnTimer() {
    this._clearTurnTimer()
    const acting = this._actingPlayer()
    if (!acting) return
    this.turnDeadline = Date.now() + TURN_TIMEOUT_MS
    this._turnTimer = setTimeout(() => {
      try { this.processAction(acting.id, 'fold') } catch {}
    }, TURN_TIMEOUT_MS)
  }

  _clearTurnTimer() {
    if (this._turnTimer) { clearTimeout(this._turnTimer); this._turnTimer = null }
    this.turnDeadline = null
  }

  destroy() {
    this._clearTurnTimer()
    this._clearCountdown()
    if (this._streetTimer) { clearTimeout(this._streetTimer); this._streetTimer = null }
  }

  _emit(type, data = {}) {
    this.onEvent?.({ type, roomId: this.roomId, ...data })
  }

  _broadcastState() {
    this._emit('state_update', { state: this.publicState() })
  }

  // Public state (no hole cards)
  publicState() {
    return {
      roomId: this.roomId,
      phase: this.phase,
      pot: this.pot,
      currentBet: this.currentBet,
      minRaise: this.lastRaiseSize,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      communityCards: this.communityCards,
      actingPlayerId: this._actingPlayer()?.id ?? null,
      turnDeadline: this.turnDeadline,
      countdownEnd: this.countdownEnd,
      players: this.players.map(p => ({
        id: p.id,
        username: p.username,
        balance: p.balance,
        roundBet: p.roundBet,
        status: p.status,
        isDealer: p.isDealer,
        isSB: p.isSB,
        isBB: p.isBB,
        cardCount: p.holeCards.length,
        ready: p.ready ?? false,
      })),
    }
  }

  // State for a specific player (includes their hole cards)
  stateForPlayer(playerId) {
    const state = this.publicState()
    const p = this._findPlayer(playerId)
    return { ...state, myHoleCards: p?.holeCards ?? [] }
  }
}
