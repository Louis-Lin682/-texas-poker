const DEAL_MS   = 3_000
const RESULT_MS = 5_000

const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K']
const SUITS  = ['♠','♥','♦','♣']
const RED_SUITS = new Set(['♥','♦'])

const SUIT_KEY = { '♠': 'spade', '♥': 'heart', '♦': 'diamond', '♣': 'club' }

const VALID_ZONES = new Set([
  'dragon', 'tiger', 'tie',
  'dragon_big', 'dragon_small', 'dragon_odd', 'dragon_even',
  'dragon_spade', 'dragon_heart', 'dragon_diamond', 'dragon_club',
  'tiger_big',  'tiger_small',  'tiger_odd',  'tiger_even',
  'tiger_spade', 'tiger_heart', 'tiger_diamond', 'tiger_club',
])

function emptyBets() {
  return Object.fromEntries([...VALID_ZONES].map(z => [z, 0]))
}

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

// Settle big/small + odd/even + suit side bets for one card
// cfg keys: payout.big, payout.small, payout.odd, payout.even, payout.suit, seven_rule
function settleCardBets(bets, side, val, suit, cfg) {
  let p = 0
  const sevenRule = cfg['seven_rule'] ?? 'push'

  const big   = bets[`${side}_big`]   || 0
  const small = bets[`${side}_small`] || 0
  if (val === 7 && sevenRule === 'push') {
    p += big + small
  } else if (val !== 7) {
    if (val > 7) p += Math.floor(big   * (1 + (cfg['payout.big']   ?? 1)))
    else         p += Math.floor(small * (1 + (cfg['payout.small'] ?? 1)))
  }

  const odd  = bets[`${side}_odd`]  || 0
  const even = bets[`${side}_even`] || 0
  if (val === 7 && sevenRule === 'push') {
    p += odd + even
  } else if (val !== 7) {
    if (val % 2 === 1) p += Math.floor(odd  * (1 + (cfg['payout.odd']  ?? 1)))
    else               p += Math.floor(even * (1 + (cfg['payout.even'] ?? 1)))
  }

  const wonSuitKey = SUIT_KEY[suit]
  const suitMult   = 1 + (cfg['payout.suit'] ?? 3)
  for (const key of Object.keys(SUIT_KEY)) {
    const betAmt = bets[`${side}_${SUIT_KEY[key]}`] || 0
    if (SUIT_KEY[key] === wonSuitKey) p += Math.floor(betAmt * suitMult)
  }

  return p
}

export class DragonTigerGame {
  // getConfig: () => current config object (called fresh each round start)
  constructor({ roomId, maxPlayers = 9999, getConfig = () => ({}) } = {}) {
    this.roomId     = roomId
    this.gameSlug   = 'dragon-tiger'
    this.maxPlayers = maxPlayers
    this.getConfig  = getConfig
    this.phase      = 'idle'
    this.players    = []
    this._roundCfg  = {}   // config snapshot for current round

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

  start() {
    if (this._destroyed) return
    this._startBetting()
  }

  // ── Player management ─────────────────────────────────────

  addPlayer({ id, username, balance }) {
    if (this.players.find(p => p.id === id)) return
    if (this.players.length >= this.maxPlayers) throw new Error('房間已滿')
    this.players.push({ id, username, balance, bets: emptyBets(), payout: 0, betHistory: [] })
    this._emit('state_update')
  }

  removePlayer(id) {
    const idx = this.players.findIndex(p => p.id === id)
    if (idx === -1) return
    this.players.splice(idx, 1)
    this._emit('state_update')
  }

  setReady() {} // no-op — continuous game needs no ready

  cancelLastBet(id) {
    if (this.phase !== 'betting') throw new Error('目前不是下注階段')
    const p = this.players.find(p => p.id === id)
    if (!p) throw new Error('玩家不在房間內')
    if (!p.betHistory || p.betHistory.length === 0) throw new Error('沒有可撤銷的下注')
    const last = p.betHistory.pop()
    p.bets[last.zone] -= last.amount
    p.balance         += last.amount
    this._emit('state_update')
  }

  cancelBets(id) {
    if (this.phase !== 'betting') throw new Error('目前不是下注階段')
    const p = this.players.find(p => p.id === id)
    if (!p) throw new Error('玩家不在房間內')
    const total = Object.values(p.bets).reduce((a, v) => a + v, 0)
    if (total === 0) throw new Error('尚未下注')
    p.balance    += total
    p.bets        = emptyBets()
    p.betHistory  = []
    this._emit('state_update')
  }

  // ── Betting ───────────────────────────────────────────────

  placeBet(id, zone, amount) {
    if (this.phase !== 'betting') throw new Error('目前不是下注階段')
    if (!VALID_ZONES.has(zone))   throw new Error('無效下注區域')
    const p = this.players.find(p => p.id === id)
    if (!p) throw new Error('玩家不在房間內')
    if (amount <= 0) throw new Error('下注金額無效')
    if (amount > p.balance) throw new Error('籌碼不足')
    const totalBet = Object.values(p.bets).reduce((a, v) => a + v, 0)
    const maxBet = this._roundCfg['max_bet'] ?? 10000
    if (totalBet + amount > maxBet) throw new Error('超過最高下注限額')

    // Simulate bets after this placement for conflict checks
    const next = { ...p.bets, [zone]: (p.bets[zone] || 0) + amount }
    const has = (z) => next[z] > 0

    // 龍 + 虎 互斥（含三者全押）
    if (has('dragon') && has('tiger')) throw new Error('龍虎不能同時下注')

    // 同側大 + 小 互斥
    if (has('dragon_big') && has('dragon_small')) throw new Error('龍大/龍小不能同時下注')
    if (has('tiger_big')  && has('tiger_small'))  throw new Error('虎大/虎小不能同時下注')

    // 同側單 + 雙 互斥
    if (has('dragon_odd') && has('dragon_even')) throw new Error('龍單/龍雙不能同時下注')
    if (has('tiger_odd')  && has('tiger_even'))  throw new Error('虎單/虎雙不能同時下注')

    // 同側四種花色全押
    const dragonSuits = ['dragon_spade','dragon_heart','dragon_club','dragon_diamond']
    const tigerSuits  = ['tiger_spade', 'tiger_heart', 'tiger_club', 'tiger_diamond']
    if (dragonSuits.every(z => has(z))) throw new Error('龍方花色不能全押')
    if (tigerSuits.every(z => has(z)))  throw new Error('虎方花色不能全押')

    p.bets[zone] += amount
    p.balance    -= amount
    p.betHistory.push({ zone, amount })
    this._emit('state_update')
  }

  // ── Phase transitions ─────────────────────────────────────

  _startBetting() {
    // Snapshot config at round start — live changes won't affect this round
    this._roundCfg  = { ...this.getConfig() }
    const bettingMs = this._roundCfg['bet_time_ms'] ?? 20000

    this.phase      = 'betting'
    this.dragonCard = null
    this.tigerCard  = null
    this.result     = null
    this.countdown  = Math.round(bettingMs / 1000)
    this.roundId++

    for (const p of this.players) {
      p.bets          = emptyBets()
      p.payout        = 0
      p.roundTotalBet = 0
      p.betHistory    = []
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
    }, bettingMs)
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

    const dv = this.dragonCard.value
    const tv = this.tigerCard.value
    const ds = this.dragonCard.suit
    const ts = this.tigerCard.suit
    const isTie = dv === tv

    if      (dv > tv) this.result = 'dragon'
    else if (tv > dv) this.result = 'tiger'
    else              this.result = 'tie'

    const roundResults = []
    for (const p of this.players) {
      const b        = p.bets
      const totalBet = Object.values(b).reduce((a, v) => a + v, 0)
      let payout = 0

      // Main bets
      const cfg        = this._roundCfg
      const tiePayout  = 1 + (cfg['payout.tie']        ?? 8)
      const tiRefund   =      cfg['payout.tie_refund']  ?? 0.5
      const mainPayout = 1 + (cfg['payout.dragon']      ?? 1)   // dragon === tiger payout

      if (isTie) {
        payout += b.tie * tiePayout
        payout += Math.floor(b.dragon * tiRefund) + Math.floor(b.tiger * tiRefund)
      } else if (this.result === 'dragon') {
        payout += Math.floor(b.dragon * mainPayout)
      } else {
        payout += Math.floor(b.tiger * mainPayout)
      }

      // Side bets (independent of main result)
      payout += settleCardBets(b, 'dragon', dv, ds, cfg)
      payout += settleCardBets(b, 'tiger',  tv, ts, cfg)

      p.balance      += payout
      p.payout        = payout
      p.roundTotalBet = totalBet
      roundResults.push({
        id: p.id, payout, totalBet, totalReturn: payout, net: payout - totalBet,
        detail: {
          result:     this.result,
          dragonCard: { rank: this.dragonCard.rank, suit: this.dragonCard.suit },
          tigerCard:  { rank: this.tigerCard.rank,  suit: this.tigerCard.suit  },
          bets:       Object.fromEntries(Object.entries(b).filter(([, v]) => v > 0)),
        },
      })
    }

    this._emit('state_update')
    this._emit('round_result', { results: roundResults })
    this._timer = setTimeout(() => this._nextRound(), RESULT_MS)
  }

  _nextRound() {
    if (this._destroyed) return
    const broke = this.players.filter(p => p.balance === 0)
    if (broke.length > 0) {
      for (const p of broke) this.players.splice(this.players.indexOf(p), 1)
      this._emit('players_removed', { players: broke })
    }
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
        bets:         { ...p.bets },
        payout:       p.payout,
        roundTotalBet: p.roundTotalBet ?? 0,
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
