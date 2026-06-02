import { createDeck, shuffle } from './deck.js'

export function handScore(cards) {
  let score = 0
  let aces = 0
  for (const c of cards) {
    if (!c) continue
    const rank = c.slice(0, -1)
    if (['T', 'J', 'Q', 'K'].includes(rank)) score += 10
    else if (rank === 'A') { score += 11; aces++ }
    else score += parseInt(rank)
  }
  while (score > 21 && aces > 0) { score -= 10; aces-- }
  return score
}

function handInfo(cards) {
  let score = 0
  let aces = 0
  for (const c of cards) {
    if (!c) continue
    const rank = c.slice(0, -1)
    if (['T', 'J', 'Q', 'K'].includes(rank)) score += 10
    else if (rank === 'A') { score += 11; aces++ }
    else score += parseInt(rank)
  }
  let acesAs11 = aces
  while (score > 21 && acesAs11 > 0) { score -= 10; acesAs11-- }
  return { score, soft: acesAs11 > 0 }
}

export function cardFaceValue(card) {
  if (!card) return 0
  const rank = card.slice(0, -1)
  if (['T', 'J', 'Q', 'K'].includes(rank)) return 10
  if (rank === 'A') return 11
  return parseInt(rank)
}

function isBlackjack(cards) {
  return cards.length === 2 && handScore(cards) === 21
}

const BET_TIME = 15_000

function makeHand(cards, bet) {
  return { cards, bet, status: 'active', doubled: false, result: null }
}

export class BlackjackGame {
  constructor(opts = {}) {
    this.roomId = opts.roomId
    this.gameSlug = 'blackjack'
    this.gameType = 'blackjack'
    this.maxPlayers = opts.maxPlayers ?? 6
    this.minBet = opts.minBet ?? 50
    this.maxBet = opts.maxBet ?? 5000
    this.betUnit = opts.betUnit ?? 50

    this.players = []
    this.phase = 'waiting'
    this.dealer = { cards: [] }
    this._shoe = []
    this._roundPlayers = []
    this._actorIdx = -1
    this._betTimer = null
    this._dealerTimer = null
    this._resultTimer = null
    this.betDeadline = null
    this.onEvent = null
  }

  // ── Public API ────────────────────────────────────────────

  addPlayer({ id, username, balance }) {
    if (this.players.length >= this.maxPlayers) throw new Error('房間已滿')
    if (this.phase !== 'waiting') throw new Error('遊戲進行中，無法加入')
    this.players.push({
      id, username, balance,
      ready: false,
      bet: 0, insuranceBet: 0, insuranceDecided: false,
      hands: [], currentHandIdx: 0,
      result: null,
    })
    this._emit(this.publicState())
  }

  removePlayer(userId) {
    if (this.phase === 'waiting') {
      this.players = this.players.filter(p => p.id !== userId)
      this._emit(this.publicState())
      return
    }
    const p = this.players.find(p => p.id === userId)
    if (p) p._left = true
    const rp = this._roundPlayers.find(p => p.id === userId)
    if (rp) {
      rp._left = true
      if (this._roundPlayers[this._actorIdx]?.id === userId) {
        for (const hand of rp.hands) {
          if (hand.status === 'active') hand.status = 'stood'
        }
        this._advanceActor()
      }
    }
  }

  setReady(userId) {
    if (this.phase !== 'waiting') return
    const p = this.players.find(p => p.id === userId)
    if (!p) return
    p.ready = true
    this._emit(this.publicState())
    this._tryStart()
  }

  processAction(userId, action, amount = 0) {
    if (this.phase === 'betting') {
      if (action !== 'bet') throw new Error('請先下注')
      this._placeBet(userId, Number(amount))
      return
    }
    if (this.phase !== 'playing') throw new Error('現在無法操作')
    const actor = this._roundPlayers[this._actorIdx]
    if (!actor || actor.id !== userId) throw new Error('還沒輪到你')
    this._handleAction(actor, action, Number(amount))
  }

  stateForPlayer(_userId) {
    return this.publicState()
  }

  publicState() {
    return {
      phase: this.phase,
      players: this.players.map(p => this._playerPublic(p)),
      dealer: this._dealerPublic(),
      currentActorId: this._roundPlayers[this._actorIdx]?.id ?? null,
      currentHandIdx: this._roundPlayers[this._actorIdx]?.currentHandIdx ?? 0,
      betDeadline: this.betDeadline,
      minBet: this.minBet,
      maxBet: this.maxBet,
      betUnit: this.betUnit,
    }
  }

  destroy() {
    clearTimeout(this._betTimer)
    clearTimeout(this._dealerTimer)
    clearTimeout(this._resultTimer)
  }

  // ── Phase transitions ─────────────────────────────────────

  _tryStart() {
    if (this.phase !== 'waiting') return
    if (this.players.length === 0) return
    if (!this.players.every(p => p.ready)) return
    this._startBetting()
  }

  _startBetting() {
    this.phase = 'betting'
    this.betDeadline = Date.now() + BET_TIME
    for (const p of this.players) {
      p.bet = 0
      p.insuranceBet = 0
      p.insuranceDecided = false
      p.hands = []
      p.currentHandIdx = 0
      p.result = null
    }
    this._emit(this.publicState())
    this._betTimer = setTimeout(() => this._endBetting(), BET_TIME)
  }

  _endBetting() {
    clearTimeout(this._betTimer)
    this.betDeadline = null
    this._roundPlayers = this.players.filter(p => p.bet > 0)
    if (this._roundPlayers.length === 0) {
      this._resetWaiting()
      return
    }
    this._deal()
  }

  _deal() {
    this.phase = 'playing'
    if (this._shoe.length < 60) this._refillShoe()

    for (const p of this._roundPlayers) {
      p.hands = [makeHand([this._draw(), this._draw()], p.bet)]
      p.currentHandIdx = 0
    }
    this.dealer.cards = [this._draw(), this._draw()]

    // Mark natural blackjacks
    for (const p of this._roundPlayers) {
      if (isBlackjack(p.hands[0].cards)) {
        p.hands[0].status = 'blackjack'
      }
    }

    this._actorIdx = -1
    this._emit(this.publicState())
    this._advanceActor()
  }

  _advanceActor() {
    this._actorIdx++
    while (
      this._actorIdx < this._roundPlayers.length &&
      !this._roundPlayers[this._actorIdx].hands.some(h => h.status === 'active')
    ) {
      this._actorIdx++
    }

    if (this._actorIdx >= this._roundPlayers.length) {
      this._dealerPlay()
      return
    }

    const actor = this._roundPlayers[this._actorIdx]
    actor.currentHandIdx = actor.hands.findIndex(h => h.status === 'active')
    this._emit(this.publicState())
  }

  _dealerPlay() {
    this.phase = 'dealer'
    this._emit(this.publicState())
    if (isBlackjack(this.dealer.cards)) {
      setTimeout(() => this._resolve(), 800)
      return
    }
    this._dealerHitLoop()
  }

  _dealerHitLoop() {
    const { score, soft } = handInfo(this.dealer.cards)
    // H17: hit on soft 17
    if (score > 17 || (score === 17 && !soft)) {
      setTimeout(() => this._resolve(), 500)
      return
    }
    this.dealer.cards.push(this._draw())
    this._emit(this.publicState())
    this._dealerTimer = setTimeout(() => this._dealerHitLoop(), 700)
  }

  _resolve() {
    this.phase = 'result'
    const dScore = handScore(this.dealer.cards)
    const dBJ = isBlackjack(this.dealer.cards)

    const roundResults = []

    for (const p of this._roundPlayers) {
      let totalReturn = 0
      let totalBet = p.bet + p.insuranceBet

      // Insurance payout
      if (p.insuranceBet > 0) {
        if (dBJ) totalReturn += p.insuranceBet * 3  // 2:1 win + bet back
      }

      for (const hand of p.hands) {
        const pScore = handScore(hand.cards)
        const pBJ = hand.status === 'blackjack'

        if (hand.status === 'bust') {
          hand.result = 'lose'
        } else if (pBJ && dBJ) {
          hand.result = 'push'
          totalReturn += hand.bet
        } else if (pBJ) {
          hand.result = 'blackjack'
          totalReturn += hand.bet + Math.floor(hand.bet * 1.5)
        } else if (dBJ) {
          hand.result = 'lose'
        } else if (dScore > 21 || pScore > dScore) {
          hand.result = 'win'
          totalReturn += hand.bet * 2
        } else if (pScore === dScore) {
          hand.result = 'push'
          totalReturn += hand.bet
        } else {
          hand.result = 'lose'
        }

        // Double-down bets were already deducted from balance at action time
        // but hand.bet already reflects the doubled amount, so hand.bet is correct for totalBet
        if (hand.doubled) totalBet += hand.bet / 2  // extra deducted for the double
      }

      // For split hands, extra bets were deducted from balance at split time
      if (p.hands.length > 1) {
        totalBet = p.hands.reduce((s, h) => s + h.bet, 0) + p.insuranceBet
      }

      p.balance += totalReturn

      const allResults = p.hands.map(h => h.result)
      if (allResults.some(r => r === 'win' || r === 'blackjack')) p.result = 'win'
      else if (allResults.every(r => r === 'push')) p.result = 'push'
      else p.result = 'lose'

      roundResults.push({ id: p.id, totalBet, totalReturn })
    }

    this._emit(this.publicState())
    // Emit separate event for ledger writes
    this.onEvent?.({ type: 'round_result', roomId: this.roomId, results: roundResults })

    this._resultTimer = setTimeout(() => this._resetWaiting(), 5000)
  }

  _resetWaiting() {
    clearTimeout(this._resultTimer)
    this.phase = 'waiting'
    this.dealer = { cards: [] }
    this._roundPlayers = []
    this._actorIdx = -1
    this.betDeadline = null

    this.players = this.players.filter(p => !p._left && p.balance >= this.minBet)
    for (const p of this.players) {
      p.ready = false
      p.bet = 0
      p.insuranceBet = 0
      p.insuranceDecided = false
      p.hands = []
      p.currentHandIdx = 0
      p.result = null
    }
    this._emit(this.publicState())
  }

  // ── Actions ───────────────────────────────────────────────

  _placeBet(userId, amount) {
    const p = this.players.find(p => p.id === userId)
    if (!p) throw new Error('玩家不在房間')
    if (p.bet > 0) throw new Error('已下注')
    if (amount < this.minBet) throw new Error(`最低下注 ${this.minBet}`)
    if (amount > this.maxBet) throw new Error(`最高下注 ${this.maxBet}`)
    if (amount > p.balance) throw new Error('餘額不足')
    p.bet = amount
    p.balance -= amount
    this._emit(this.publicState())
  }

  _handleAction(actor, action, amount) {
    const hand = actor.hands[actor.currentHandIdx]
    if (!hand || hand.status !== 'active') throw new Error('無效操作')

    switch (action) {
      case 'hit':       this._hit(actor, hand); break
      case 'stand':     this._stand(hand); break
      case 'double':    this._double(actor, hand); break
      case 'split':     this._split(actor, hand); break
      case 'insurance': this._insurance(actor); break
      default:          throw new Error('未知操作')
    }
  }

  _hit(actor, hand) {
    hand.cards.push(this._draw())
    const score = handScore(hand.cards)
    if (score > 21) {
      hand.status = 'bust'
      this._nextHand(actor)
    } else if (score === 21) {
      hand.status = 'stood'
      this._nextHand(actor)
    } else {
      this._emit(this.publicState())
    }
  }

  _stand(hand) {
    hand.status = 'stood'
    const actor = this._roundPlayers[this._actorIdx]
    this._nextHand(actor)
  }

  _double(actor, hand) {
    if (hand.cards.length !== 2) throw new Error('只能在前兩張牌時加倍')
    if (actor.balance < hand.bet) throw new Error('餘額不足加倍')
    actor.balance -= hand.bet
    hand.bet *= 2
    hand.doubled = true
    hand.cards.push(this._draw())
    hand.status = handScore(hand.cards) > 21 ? 'bust' : 'stood'
    this._nextHand(actor)
  }

  _split(actor, hand) {
    if (hand.cards.length !== 2) throw new Error('只能在前兩張牌時分牌')
    if (cardFaceValue(hand.cards[0]) !== cardFaceValue(hand.cards[1])) throw new Error('只能對同點數分牌')
    if (actor.balance < hand.bet) throw new Error('餘額不足分牌')
    if (actor.hands.length >= 4) throw new Error('最多分4手')

    actor.balance -= hand.bet
    const [c1, c2] = hand.cards
    const isAce = c1.slice(0, -1) === 'A'

    actor.hands.splice(actor.currentHandIdx, 1,
      makeHand([c1, this._draw()], hand.bet),
      makeHand([c2, this._draw()], hand.bet),
    )

    if (isAce) {
      actor.hands[actor.currentHandIdx].status = 'stood'
      actor.hands[actor.currentHandIdx + 1].status = 'stood'
      this._nextHand(actor)
      return
    }
    this._emit(this.publicState())
  }

  _insurance(actor) {
    if (actor.insuranceDecided) throw new Error('已決定保險')
    const dealerUp = this.dealer.cards[0]?.slice(0, -1)
    if (dealerUp !== 'A') throw new Error('莊家非A，無法買保險')
    const cost = Math.floor(actor.bet / 2)
    if (actor.balance < cost) throw new Error('餘額不足')
    actor.balance -= cost
    actor.insuranceBet = cost
    actor.insuranceDecided = true
    this._emit(this.publicState())
    // Don't advance — player still plays their hand
  }

  _nextHand(actor) {
    const nextIdx = actor.hands.findIndex((h, i) => i > actor.currentHandIdx && h.status === 'active')
    if (nextIdx !== -1) {
      actor.currentHandIdx = nextIdx
      this._emit(this.publicState())
      return
    }
    this._advanceActor()
  }

  // ── Utils ─────────────────────────────────────────────────

  _refillShoe() {
    this._shoe = []
    for (let i = 0; i < 6; i++) this._shoe.push(...shuffle(createDeck()))
  }

  _draw() {
    if (this._shoe.length === 0) this._refillShoe()
    return this._shoe.pop()
  }

  _playerPublic(p) {
    return {
      id: p.id,
      username: p.username,
      balance: p.balance,
      ready: p.ready,
      bet: p.bet,
      insuranceBet: p.insuranceBet,
      insuranceDecided: p.insuranceDecided,
      hands: p.hands.map(h => ({ ...h, score: handScore(h.cards) })),
      currentHandIdx: p.currentHandIdx,
      result: p.result,
    }
  }

  _dealerPublic() {
    if (this.phase === 'playing') {
      return {
        cards: [this.dealer.cards[0], null],
        score: cardFaceValue(this.dealer.cards[0]),
      }
    }
    return {
      cards: this.dealer.cards,
      score: handScore(this.dealer.cards),
    }
  }

  _emit(state) {
    this.onEvent?.({ type: 'state_update', roomId: this.roomId, state })
  }
}
