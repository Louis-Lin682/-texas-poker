import { rankIndex } from './deck.js'

export const HAND_NAMES = ['高牌','一對','兩對','三條','順子','同花','葫蘆','四條','同花順']

// All combinations of k items from arr
function combos(arr, k) {
  if (k === 0) return [[]]
  if (arr.length < k) return []
  const [h, ...t] = arr
  return [...combos(t, k - 1).map(c => [h, ...c]), ...combos(t, k)]
}

// Score a exactly-5-card hand → array for lexicographic comparison
// score[0] = hand rank (0-8), rest = tiebreakers high-to-low
function score5(hand) {
  const rv = hand.map(rankIndex).sort((a, b) => b - a)
  const suits = hand.map(c => c.slice(-1))
  const isFlush = suits.every(s => s === suits[0])

  // Straight check (including wheel A2345)
  let isStraight = false
  let strHigh = rv[0]
  if (new Set(rv).size === 5) {
    if (rv[0] - rv[4] === 4) {
      isStraight = true
    } else if (rv[0] === 12 && rv[1] === 3) {
      // A-2-3-4-5 wheel
      isStraight = true
      strHigh = 3
    }
  }

  // Group by rank, sorted by count desc then rank desc
  const freq = {}
  for (const r of rv) freq[r] = (freq[r] || 0) + 1
  const groups = Object.entries(freq)
    .sort((a, b) => b[1] - a[1] || b[0] - a[0])
  const cnts = groups.map(([, c]) => c)
  const rnks = groups.map(([r]) => Number(r))

  if (isFlush && isStraight) return [8, strHigh]
  if (cnts[0] === 4)                return [7, ...rnks]
  if (cnts[0] === 3 && cnts[1] === 2) return [6, ...rnks]
  if (isFlush)                       return [5, ...rv]
  if (isStraight)                    return [4, strHigh]
  if (cnts[0] === 3)                 return [3, ...rnks]
  if (cnts[0] === 2 && cnts[1] === 2) return [2, ...rnks]
  if (cnts[0] === 2)                 return [1, ...rnks]
  return [0, ...rv]
}

function compareScores(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1)
    if (d !== 0) return d
  }
  return 0
}

// Best 5-card hand from any number of cards (≥5)
export function bestHand(holeCards, communityCards) {
  const all = [...holeCards, ...communityCards]
  if (all.length < 5) return { score: [-1], name: '等待中', cards: [] }

  let best = null
  let bestCards = null
  for (const combo of combos(all, 5)) {
    const s = score5(combo)
    if (!best || compareScores(s, best) > 0) {
      best = s
      bestCards = combo
    }
  }

  return { score: best, name: HAND_NAMES[best[0]] ?? '高牌', cards: bestCards }
}

// Given active players (each with .id, .holeCards) and community cards,
// return { winners: [...], evaluated: [...] }
export function determineWinners(activePlayers, communityCards) {
  const evaluated = activePlayers.map(p => ({
    ...p,
    hand: bestHand(p.holeCards, communityCards),
  }))

  let topScore = evaluated[0].hand.score
  for (const p of evaluated.slice(1)) {
    if (compareScores(p.hand.score, topScore) > 0) topScore = p.hand.score
  }

  const winners = evaluated.filter(p => compareScores(p.hand.score, topScore) === 0)
  return { winners, evaluated }
}
