import { btVal, classifyBTHand, btBeats } from './BigTwoGame.js'

function btSort(cards) {
  return [...cards].sort((a, b) => btVal(a) - btVal(b))
}

function rankOf(card) { return card.slice(0, -1) }

function groupByRank(cards) {
  const map = new Map()
  for (const c of cards) {
    const r = rankOf(c)
    if (!map.has(r)) map.set(r, [])
    map.get(r).push(c)
  }
  return map
}

function fiveCombos(cards) {
  const result = []
  const n = cards.length
  for (let a = 0; a < n - 4; a++)
    for (let b = a+1; b < n - 3; b++)
      for (let c = b+1; c < n - 2; c++)
        for (let d = c+1; d < n - 1; d++)
          for (let e = d+1; e < n; e++)
            result.push([cards[a], cards[b], cards[c], cards[d], cards[e]])
  return result
}

function validPlays(hand, pile) {
  const results = []
  const n = hand.length

  if (!pile) {
    for (const c of hand) results.push([c])
    const byRank = groupByRank(hand)
    for (const [, cards] of byRank) {
      if (cards.length >= 2)
        for (let i = 0; i < cards.length - 1; i++)
          for (let j = i + 1; j < cards.length; j++)
            results.push([cards[i], cards[j]])
    }
    for (const [, cards] of byRank) {
      if (cards.length >= 3)
        for (let i = 0; i < cards.length - 2; i++)
          for (let j = i + 1; j < cards.length - 1; j++)
            for (let k = j + 1; k < cards.length; k++)
              results.push([cards[i], cards[j], cards[k]])
    }
    if (n >= 5)
      for (const combo of fiveCombos(hand))
        if (classifyBTHand(combo)) results.push(combo)
    return results
  }

  const pileLen = pile.cards.length
  const pileCls = pile.classified

  if (pileLen === 1) {
    for (const c of hand) {
      const cls = classifyBTHand([c])
      if (cls && btBeats(cls, 1, pileCls, 1)) results.push([c])
    }
  } else if (pileLen === 2) {
    const byRank = groupByRank(hand)
    for (const [, cards] of byRank) {
      if (cards.length >= 2)
        for (let i = 0; i < cards.length - 1; i++)
          for (let j = i + 1; j < cards.length; j++) {
            const combo = [cards[i], cards[j]]
            const cls = classifyBTHand(combo)
            if (cls && btBeats(cls, 2, pileCls, 2)) results.push(combo)
          }
    }
  } else if (pileLen === 3) {
    const byRank = groupByRank(hand)
    for (const [, cards] of byRank) {
      if (cards.length >= 3)
        for (let i = 0; i < cards.length - 2; i++)
          for (let j = i + 1; j < cards.length - 1; j++)
            for (let k = j + 1; k < cards.length; k++) {
              const combo = [cards[i], cards[j], cards[k]]
              const cls = classifyBTHand(combo)
              if (cls && btBeats(cls, 3, pileCls, 3)) results.push(combo)
            }
    }
  } else if (pileLen === 5) {
    for (const combo of fiveCombos(hand)) {
      const cls = classifyBTHand(combo)
      if (cls && btBeats(cls, 5, pileCls, 5)) results.push(combo)
    }
  }

  return results
}

// Lower bias = more eager to play on a free turn
// single: reluctant; pair/triple: eager; 5-card: play straights freely, save quads/sf
//         single  pair  triple  straight  flush  fullhouse  quads   sf
const FREE_BIAS = [  300,    0,      0,      80,    120,      140,   160,  200]

function chooseFreePlay(plays, handSize) {
  function score(combo) {
    const cls = classifyBTHand(combo)
    const twos = combo.filter(c => rankOf(c) === '2').length
    if (handSize <= 3) return twos * 100000 + cls.key  // endgame: just go out
    const bias = FREE_BIAS[cls.typeRank] ?? 300
    return twos * 100000 + bias + cls.key
  }
  return plays.slice().sort((a, b) => score(a) - score(b))[0]
}

function chooseBeatPlay(plays, handSize) {
  function score(combo) {
    const cls = classifyBTHand(combo)
    const twos = combo.filter(c => rankOf(c) === '2').length
    return twos * 100000 + cls.key
  }
  const ranked = plays.slice().sort((a, b) => score(a) - score(b))
  const best = ranked[0]
  const twos = best.filter(c => rankOf(c) === '2').length

  if (handSize <= 5) return best   // endgame: always play
  if (twos > 0) return null        // save 2s on a large hand, let others fight
  return best
}

export function decideBigTwo({ hand, pile, isFirstOfGame }) {
  const sorted = btSort(hand)
  const handSize = sorted.length

  // First play of the game: must include 3c — try to pair/triple it
  if (!pile && isFirstOfGame) {
    if (!sorted.includes('3c')) return { action: 'pass' }
    const byRank = groupByRank(sorted)
    const threes = byRank.get('3') ?? []
    if (threes.length >= 3) return { action: 'play', cards: threes.slice(0, 3) }
    if (threes.length >= 2) return { action: 'play', cards: threes.slice(0, 2) }
    return { action: 'play', cards: ['3c'] }
  }

  const plays = validPlays(sorted, pile)
  if (plays.length === 0) return { action: 'pass' }

  if (!pile) {
    return { action: 'play', cards: chooseFreePlay(plays, handSize) }
  }

  const cards = chooseBeatPlay(plays, handSize)
  return cards ? { action: 'play', cards } : { action: 'pass' }
}
