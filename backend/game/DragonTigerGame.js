const BETTING_MS = 20_000
const DEAL_MS    = 3_000
const RESULT_MS  = 5_000

const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K']
const SUITS  = ['♠','♥','♦','♣']
const RED_SUITS = new Set(['♥','♦'])

function buildDeck() {
  const deck = []
  for (const suit of SUITS)
    for (let v = 1; v <= 13; v++)
      deck.push({ rank: RANKS[v - 1], suit, value: v, red: RED_SUITS.has(suit) })
  return deck
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export class DragonTigerGame {
  constructor({ roomId, maxPlayers = 6, minBet = 20, maxBet = 10000 } = {}) {
    this.roomId     = roomId
    this.gameSlug   = 'dragon-tiger'
    this.maxPlayers = maxPlayers
    this.minBet     = minBet
    this.maxBet     = maxBet
    this.phase      = 'idle'
    this.players    = []

    this.dragonCard = null
    this.tigerCard  = null
    this.result     = null
    this.countdown  = 0
    this.roundId    = 0

    this._interval  = null
    this._timer     = null
    this._destroyed = false

    this.onEvent = () => {}
  }

  // Called by RoomManager after wiring onEvent — begins the continuous loop
  start() {
    if (this._destroyed) return
    this._startBetting()
  }

  // ── Player management ─────────────────────────────────────

  addPlayer({ id, username, balance }) {
    if (this.players.find(p => p.id === id)) return
    if (this.players.length >= this.maxPlayers) throw new Error('房間已滿')
    // Players can join at any phase — they bet in the current or next window
    this.players.push({ id, username, balance, bets: { dragon: 0, tie: 0, tiger: 0 }, payout: 0 })
    this._emit('state_update')
  }

  removePlayer(id) {
    const idx = this.players.findIndex(p => p.id === id)
    if (idx === -1) return
    this.players.splice(idx, 1)
    this._emit('state_update')
    // Game keeps running even with 0 players (live dealer style)
  }

  // No-op — kept so fillRoom's setReady() call doesn't throw
  setReady() {}

  // ── Betting ───────────────────────────────────────────────

  placeBet(id, zone, amount) {
    if (this.phase !== 'betting') throw new Error('目前不是下注階段')
    if (!['dragon', 'tie', 'tiger'].includes(zone)) throw new Error('無效下注區域')
    const p = this.players.find(p => p.id === id)
    if (!p) throw new Error('玩家不在房間內')
    if (amount <= 0) throw new Error('下注金額無效')
    if (amount > p.balance) throw new Error('籌碼不足')
    const total = p.bets.dragon + p.bets.tie + p.bets.tiger + amount
    if (total > this.maxBet) throw new Error('超過最高下注限額')
    p.bets[zone] += amount
    p.balance    -= amount
    this._emit('state_update')
  }

  // ── Phase transitions ─────────────────────────────────────

  _startBetting() {
    this.phase      = 'betting'
    this.dragonCard = null
    this.tigerCard  = null
    this.result     = null
    this.countdown  = Math.round(BETTING_MS / 1000)
    this.roundId++

    for (const p of this.players) {
      p.bets   = { dragon: 0, tie: 0, tiger: 0 }
      p.payout = 0
    }

    this._emit('state_update')

    this._interval = setInterval(() => {
      if (this.countdown > 0) this.countdown--
      this._emit('state_update')
    }, 1000)

    this._timer = setTimeout(() => {
      clearInterval(this._interval)
      this._interval = null
      this._deal()
    }, BETTING_MS)
  }

  _deal() {
    this.phase      = 'dealing'
    this.countdown  = 0
    const deck      = shuffle(buildDeck())
    this.dragonCard = deck[0]
    this.tigerCard  = deck[1]
    this._emit('state_update')
    this._timer = setTimeout(() => this._settle(), DEAL_MS)
  }

  _settle() {
    this.phase = 'result'

    if      (this.dragonCard.value > this.tigerCard.value) this.result = 'dragon'
    else if (this.tigerCard.value  > this.dragonCard.value) this.result = 'tiger'
    else                                                     this.result = 'tie'

    const roundResults = []
    for (const p of this.players) {
      const { dragon, tie, tiger } = p.bets
      const totalBet = dragon + tie + tiger
      let payout = 0

      if (this.result === 'dragon') {
        payout = dragon * 2
      } else if (this.result === 'tiger') {
        payout = tiger * 2
      } else {
        // Tie: tie bets win 1:8 (9× return); dragon/tiger bets lose half
        payout = tie * 9 + Math.floor(dragon / 2) + Math.floor(tiger / 2)
      }

      p.balance += payout
      p.payout   = payout
      roundResults.push({ id: p.id, payout, totalBet, totalReturn: payout, net: payout - totalBet })
    }

    this._emit('state_update')
    this._emit('round_result', { results: roundResults })
    this._timer = setTimeout(() => this._nextRound(), RESULT_MS)
  }

  _nextRound() {
    if (this._destroyed) return

    // Remove broke players
    const broke = this.players.filter(p => p.balance === 0)
    if (broke.length > 0) {
      for (const p of broke) this.players.splice(this.players.indexOf(p), 1)
      this._emit('players_removed', { players: broke })
    }

    // Always restart — live dealer runs continuously
    this._startBetting()
  }

  destroy() {
    this._destroyed = true
    clearInterval(this._interval)
    clearTimeout(this._timer)
    this._interval = null
    this._timer    = null
  }

  // ── State ─────────────────────────────────────────────────

  stateForPlayer(_id) {
    return {
      phase:      this.phase,
      countdown:  this.countdown,
      roundId:    this.roundId,
      players:    this.players.map(p => ({
        id:       p.id,
        username: p.username,
        balance:  p.balance,
        bets:     { ...p.bets },
        payout:   p.payout,
      })),
      dragonCard: this.dragonCard,
      tigerCard:  this.tigerCard,
      result:     this.result,
    }
  }

  _emit(type, extra = {}) {
    this.onEvent({ type, roomId: this.roomId, state: this.stateForPlayer(null), ...extra })
  }
}
