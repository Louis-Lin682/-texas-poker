import { shuffle } from './deck.js'

// Big Two rank order: 3 < 4 < 5 < 6 < 7 < 8 < 9 < T < J < Q < K < A < 2
const BT_RANKS = ['3','4','5','6','7','8','9','T','J','Q','K','A','2']
// Suit order: c < d < h < s  (梅花 < 方塊 < 紅心 < 黑桃)
const BT_SUITS = ['c','d','h','s']

export function btVal(card) {
  const suit = card.slice(-1)
  const rank = card.slice(0, -1)
  return BT_RANKS.indexOf(rank) * 4 + BT_SUITS.indexOf(suit)
}

function btSort(cards) {
  return [...cards].sort((a, b) => btVal(a) - btVal(b))
}

function createBTDeck() {
  const cards = []
  for (const suit of BT_SUITS)
    for (const rank of BT_RANKS)
      cards.push(rank + suit)
  return shuffle(cards)
}

// ── Hand classification ───────────────────────────────────

// Returns { type, typeRank, key } or null if invalid
// typeRank: single=0 pair=1 triple=2 straight=3 flush=4 fullhouse=5 quads=6 sf=7
export function classifyBTHand(cards) {
  if (!cards || cards.length === 0) return null
  const sorted = btSort(cards)
  const n = cards.length

  if (n === 1) return { type: 'single',  typeRank: 0, key: btVal(sorted[0]) }

  if (n === 2) {
    const [r0, r1] = [sorted[0].slice(0, -1), sorted[1].slice(0, -1)]
    if (r0 === r1) return { type: 'pair', typeRank: 1, key: btVal(sorted[1]) }
    return null
  }

  if (n === 3) {
    const ranks = sorted.map(c => c.slice(0, -1))
    if (ranks[0] === ranks[1] && ranks[1] === ranks[2])
      return { type: 'triple', typeRank: 2, key: btVal(sorted[2]) }
    return null
  }

  if (n === 5) return classifyFiveBT(sorted)
  return null
}

function classifyFiveBT(sorted) {
  const rankIdxs = sorted.map(c => BT_RANKS.indexOf(c.slice(0, -1)))
  const suits    = sorted.map(c => c.slice(-1))
  const isFlush  = new Set(suits).size === 1

  const ri = [...rankIdxs].sort((a, b) => a - b)
  const isConsec = ri.every((r, i) => i === 0 || r === ri[i - 1] + 1)

  // Special: A-2-3-4-5 (rankIdxs [0,1,2,11,12] sorted = [0,1,2,11,12])
  const isA2345 = ri[0] === 0 && ri[1] === 1 && ri[2] === 2 && ri[3] === 11 && ri[4] === 12

  const rankCount = {}
  for (const r of rankIdxs) rankCount[r] = (rankCount[r] ?? 0) + 1
  const counts = Object.values(rankCount).sort((a, b) => b - a)

  const highKey = btVal(sorted[sorted.length - 1])

  if ((isConsec || isA2345) && isFlush) {
    // Straight flush key: for A-2-3-4-5 use value of the 5
    const key = isA2345 ? btVal(sorted.find(c => c.slice(0,-1) === '5')) : highKey
    return { type: 'sf', typeRank: 7, key }
  }

  if (counts[0] === 4) {
    const quadRankIdx = Number(Object.entries(rankCount).find(([,v]) => v === 4)[0])
    const quadCards   = sorted.filter(c => BT_RANKS.indexOf(c.slice(0,-1)) === quadRankIdx)
    return { type: 'quads', typeRank: 6, key: btVal(quadCards[quadCards.length - 1]) }
  }

  if (counts[0] === 3 && counts[1] === 2) {
    const triRankIdx = Number(Object.entries(rankCount).find(([,v]) => v === 3)[0])
    const triCards   = sorted.filter(c => BT_RANKS.indexOf(c.slice(0,-1)) === triRankIdx)
    return { type: 'fullhouse', typeRank: 5, key: btVal(triCards[triCards.length - 1]) }
  }

  if (isFlush) return { type: 'flush', typeRank: 4, key: highKey }

  if (isConsec || isA2345) {
    const key = isA2345 ? btVal(sorted.find(c => c.slice(0,-1) === '5')) : highKey
    return { type: 'straight', typeRank: 3, key }
  }

  return null
}

export function btBeats(newCls, newLen, pileCls, pileLen) {
  if (!pileCls) return true
  if (newLen !== pileLen) return false
  if (newLen === 5) {
    if (newCls.typeRank !== pileCls.typeRank) return newCls.typeRank > pileCls.typeRank
    return newCls.key > pileCls.key
  }
  if (newCls.type !== pileCls.type) return false
  return newCls.key > pileCls.key
}

// ── Game ─────────────────────────────────────────────────

const RESULT_DELAY_MS = 5_000

export class BigTwoGame {
  constructor({ roomId, maxPlayers = 4, betUnit = 10, gameSlug = 'big-two', minPlayers = 2 } = {}) {
    this.roomId     = roomId
    this.gameSlug   = gameSlug
    this.maxPlayers = maxPlayers
    this.betUnit    = betUnit
    this.minPlayers = minPlayers

    this.players          = []
    this.phase            = 'waiting'  // waiting | playing | finished
    this.currentPlayerIdx = -1
    this.pile             = null       // { cards, classified, playerId }
    this.passCount        = 0
    this.winners          = []
    this._hasPlayed       = new Set()  // ids who played ≥1 card
    this._resultTimer     = null

    this.onEvent = null
  }

  // ── Player management ─────────────────────────────────

  addPlayer({ id, username, balance }) {
    if (this.players.length >= this.maxPlayers) throw new Error('房間已滿')
    if (this.phase !== 'waiting') throw new Error('遊戲進行中，無法加入')
    if (this.players.find(p => p.id === id)) return
    this.players.push({ id, username, balance, hand: [], ready: false, status: 'waiting' })
    this._broadcastState()
  }

  removePlayer(id) {
    if (this.phase === 'waiting') {
      this.players = this.players.filter(p => p.id !== id)
      this._broadcastState()
      return
    }
    const p = this._find(id)
    if (!p || p.status === 'finished') return
    p.status  = 'finished'
    p.balance = 0
    p.hand    = []
    this._broadcastState()
    this._checkEnd()
  }

  setReady(playerId) {
    if (this.phase !== 'waiting') return
    const p = this._find(playerId)
    if (!p) return
    p.ready = true
    this._broadcastState()
    this._checkAllReady()
  }

  _checkAllReady() {
    if (this.phase !== 'waiting') return
    const eligible = this.players.filter(p => p.balance > 0)
    if (eligible.length < this.minPlayers) return
    if (!eligible.every(p => p.ready)) return
    this._startGame()
  }

  // ── Game flow ─────────────────────────────────────────

  _startGame() {
    const eligible = this.players.filter(p => p.balance > 0)
    if (eligible.length < 2) return

    const deck      = createBTDeck()
    const perPlayer = Math.floor(52 / eligible.length)

    for (let i = 0; i < eligible.length; i++) {
      eligible[i].hand   = btSort(deck.slice(i * perPlayer, (i + 1) * perPlayer))
      eligible[i].status = 'playing'
      eligible[i].ready  = false
    }

    this.phase            = 'playing'
    this.pile             = null
    this.passCount        = 0
    this.winners          = []
    this._hasPlayed       = new Set()

    // Who has 3♣ goes first
    let firstIdx = 0
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].hand?.includes('3c')) { firstIdx = i; break }
    }
    this.currentPlayerIdx = firstIdx

    this._emit('game_started', {})
    for (const p of eligible) {
      this._emit('deal', { playerId: p.id, hand: p.hand })
    }
    this._broadcastState()
  }

  processAction(playerId, action, cards = []) {
    if (this.phase !== 'playing') throw new Error('遊戲未進行中')
    const cur = this.players[this.currentPlayerIdx]
    if (!cur || cur.id !== playerId) throw new Error('不是你的回合')

    if (action === 'pass') {
      if (!this.pile)                          throw new Error('第一手必須出牌')
      if (this.pile.playerId === playerId)     throw new Error('輪到你自由出牌')
      this.passCount++
      this._emit('player_action', { playerId, username: cur.username, action: 'pass' })
      const active = this.players.filter(p => p.status === 'playing').length
      if (this.passCount >= active - 1) {
        this.pile      = null
        this.passCount = 0
      }
      this._moveNext()
      this._broadcastState()
      return
    }

    if (action === 'play') {
      if (!cards || cards.length === 0) throw new Error('請選擇要出的牌')

      const handCopy = [...cur.hand]
      const toPlay   = []
      for (const card of cards) {
        const idx = handCopy.indexOf(card)
        if (idx === -1) throw new Error(`手牌中沒有此牌`)
        toPlay.push(handCopy.splice(idx, 1)[0])
      }

      const cls = classifyBTHand(toPlay)
      if (!cls) throw new Error('無效的出牌組合')

      // First play of the game must include 3c
      if (!this.pile && this._hasPlayed.size === 0) {
        if (!toPlay.includes('3c')) throw new Error('第一手必須包含 3♣')
      }

      if (this.pile && !btBeats(cls, toPlay.length, this.pile.classified, this.pile.cards.length))
        throw new Error('出的牌不夠大')

      const wasFreeTurn  = !this.pile  // capture before overwriting

      cur.hand       = handCopy
      this.pile      = { cards: toPlay, classified: cls, playerId }
      this.passCount = 0
      this._hasPlayed.add(playerId)

      this._emit('player_action', {
        playerId, username: cur.username,
        action: 'play', cards: toPlay, handType: cls.type,
      })

      if (cur.hand.length === 0) {
        // 第一個出完牌即勝利，直接結算
        const isPackage = wasFreeTurn && this._hasPlayed.size > 1
        cur.status = 'finished'
        this.winners.push({ id: cur.id, username: cur.username, rank: 1, isPackage })
        this._emit('player_finished', { playerId: cur.id, rank: 1 })
        this._endGame()
        return
      }

      this._moveNext()
      this._broadcastState()
      return
    }

    throw new Error('未知動作')
  }

  _moveNext() {
    const n = this.players.length
    let idx = (this.currentPlayerIdx + 1) % n
    for (let i = 0; i < n; i++) {
      if (this.players[idx]?.status === 'playing') { this.currentPlayerIdx = idx; return }
      idx = (idx + 1) % n
    }
  }

  _checkEnd() {
    const still = this.players.filter(p => p.status === 'playing')
    if (still.length > 1) return false
    for (const p of still) {
      p.status = 'finished'
      this.winners.push({ id: p.id, username: p.username, rank: this.winners.length + 1 })
    }
    this._endGame()
    return true
  }

  _endGame() {
    this.phase = 'finished'
    const winner1  = this.winners[0]
    const isPackage = winner1?.isPackage ?? false

    // Calculate penalty for each loser
    const penaltyMap = new Map()
    let totalPenalty = 0

    for (const p of this.players) {
      if (p.id === winner1?.id) { penaltyMap.set(p.id, 0); continue }
      const remaining   = p.hand.length
      if (remaining === 0) { penaltyMap.set(p.id, 0); continue }

      let base = remaining

      // 關門: never played any card (didn't get turns or always auto-passed)
      if (!this._hasPlayed.has(p.id)) base *= 3
      else if (remaining >= 10)        base *= 2

      // 加倍: each unplayed 2 doubles penalty
      const unplayedTwos = p.hand.filter(c => c.startsWith('2')).length
      base *= Math.pow(2, unplayedTwos)

      // 包牌: winner dominated final round → all losers ×2
      if (isPackage) base *= 2

      penaltyMap.set(p.id, base)
      totalPenalty += base
    }

    // Actual loss per loser = min(their balance, full penalty) — can't pay more than they have
    const originalBalance = new Map(this.players.map(p => [p.id, p.balance]))
    let actualWinnings = 0
    for (const p of this.players) {
      if (p.id === winner1?.id) continue
      const pen = penaltyMap.get(p.id) ?? 0
      actualWinnings += Math.min(p.balance, pen * this.betUnit)
    }

    // Redistribute chips
    for (const p of this.players) {
      const pen = penaltyMap.get(p.id) ?? 0
      if (p.id === winner1?.id) {
        p.balance += actualWinnings
      } else {
        p.balance = Math.max(0, p.balance - pen * this.betUnit)
      }
    }

    const scores = this.players.map(p => ({
      id:         p.id,
      username:   p.username,
      rank:       this.winners.find(w => w.id === p.id)?.rank ?? this.players.length,
      cardsLeft:  p.hand.length,
      penalty:    penaltyMap.get(p.id) ?? 0,
      chipChange: p.balance - originalBalance.get(p.id),
    }))

    this._emit('game_result', { winners: this.winners, scores, isPackage })
    this._broadcastState()

    this._resultTimer = setTimeout(() => {
      this._resultTimer = null
      this._resetGame()
    }, RESULT_DELAY_MS)
  }

  _resetGame() {
    this.players = this.players.filter(p => p.balance > 0)
    for (const p of this.players) {
      p.hand   = []
      p.ready  = false
      p.status = 'waiting'
    }
    this.phase            = 'waiting'
    this.pile             = null
    this.passCount        = 0
    this.winners          = []
    this.currentPlayerIdx = -1
    this._broadcastState()
  }

  destroy() {
    if (this._resultTimer) { clearTimeout(this._resultTimer); this._resultTimer = null }
  }

  // ── State ──────────────────────────────────────────────

  stateForPlayer(playerId) {
    const state = this._publicState()
    const me    = this._find(playerId)
    if (me) state.myHand = btSort(me.hand)
    return state
  }

  _publicState() {
    return {
      gameType:        'big-two',
      phase:           this.phase,
      players:         this.players.map(p => ({
        id:             p.id,
        username:       p.username,
        balance:        p.balance,
        cardCount:      p.hand.length,
        status:         p.status,
        ready:          p.ready,
      })),
      pile:            this.pile ? {
        cards:    this.pile.cards,
        type:     this.pile.classified.type,
        typeRank: this.pile.classified.typeRank,
        playerId: this.pile.playerId,
      } : null,
      currentPlayerId: this.players[this.currentPlayerIdx]?.id ?? null,
      passCount:       this.passCount,
      winners:         this.winners,
      betUnit:         this.betUnit,
      myHand:          [],
    }
  }

  _broadcastState() {
    this._emit('state_update', { state: this._publicState() })
  }

  _emit(type, data) { this.onEvent?.({ type, roomId: this.roomId, ...data }) }
  _find(id)         { return this.players.find(p => p.id === id) }
}
