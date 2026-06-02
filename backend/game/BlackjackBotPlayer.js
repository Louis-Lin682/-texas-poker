import { handScore, cardFaceValue } from './BlackjackGame.js'

export function decideBlackjack({ hand, dealerUp, balance, handBet, canDouble, canSplit }) {
  const { score, soft } = handInfoLocal(hand)
  const dv = cardFaceValue(dealerUp)

  // Split: always split Aces and 8s
  if (canSplit) {
    const r = hand[0].slice(0, -1)
    if (r === 'A' || r === '8') return { action: 'split' }
    if (r === 'T' || r === 'J' || r === 'Q' || r === 'K') return { action: 'stand' }
  }

  // Soft hand strategy
  if (soft) {
    if (score <= 17) return { action: 'hit' }
    if (score === 18) return dv >= 9 ? { action: 'hit' } : { action: 'stand' }
    return { action: 'stand' }
  }

  // Hard hand
  if (score >= 17) return { action: 'stand' }
  if (score <= 8) return { action: 'hit' }

  if (score === 11 && canDouble) return { action: 'double' }
  if (score === 10 && canDouble && dv < 10) return { action: 'double' }
  if (score === 9 && canDouble && dv >= 3 && dv <= 6) return { action: 'double' }

  if (score === 12) return (dv >= 4 && dv <= 6) ? { action: 'stand' } : { action: 'hit' }
  if (score >= 13 && score <= 16) return dv <= 6 ? { action: 'stand' } : { action: 'hit' }

  return { action: 'hit' }
}

function handInfoLocal(cards) {
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
