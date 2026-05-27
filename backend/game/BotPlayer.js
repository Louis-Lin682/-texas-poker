// Simple decision engine for bot players

const RANK_VAL = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':14 }

function rankOf(card) { return RANK_VAL[card.slice(0, -1)] ?? 2 }
function suitOf(card) { return card.slice(-1) }

function preflopStrength(hole) {
  if (!hole || hole.length < 2) return 0.2
  const [a, b] = hole.map(rankOf).sort((x, y) => y - x)
  const suited = suitOf(hole[0]) === suitOf(hole[1])
  const isPair = a === b

  if (isPair && a >= 13) return 0.95   // AA, KK
  if (isPair && a >= 11) return 0.82   // QQ, JJ
  if (isPair && a >= 8)  return 0.65   // TT–88
  if (isPair)            return 0.50   // 77–22
  if (a === 14 && b >= 13) return 0.88 // AK
  if (a === 14 && b >= 11) return 0.72 // AQ, AJ
  if (a === 14 && b >= 9)  return 0.58 // AT, A9
  if (a >= 13 && b >= 11)  return 0.62 // KQ, KJ
  if (suited && a >= 10 && a - b <= 2) return 0.55 // suited connectors (high)
  if (a >= 10 && b >= 10) return 0.50
  if (suited) return 0.38
  return 0.25
}

// Returns { action, amount? }
export function decide({ holeCards, communityCards, phase, currentBet, myRoundBet, myBalance, pot, minRaise }) {
  const toCall   = Math.max(0, currentBet - myRoundBet)
  const canCheck = toCall === 0
  const minR     = minRaise ?? 20

  // Hand strength 0–1
  let strength = (phase === 'pre_flop' || !communityCards?.length)
    ? preflopStrength(holeCards)
    : preflopStrength(holeCards) * 0.55 + 0.45 * Math.random()

  // Personality noise ±12%
  strength = Math.min(0.98, Math.max(0.04, strength + (Math.random() - 0.5) * 0.24))

  const callFraction = pot > 0 ? toCall / (pot + toCall) : 0.5

  if (canCheck) {
    // Bet / check
    if (strength > 0.70 && myBalance > minR) {
      const extra  = Math.floor(Math.random() * pot * 0.5)
      const amount = Math.max(minR, Math.min(minR + extra, myBalance))
      return { action: 'raise', amount }
    }
    return { action: 'check' }
  }

  // Must pay
  if (strength < 0.28)                         return { action: 'fold' }
  if (strength < 0.48 && callFraction > 0.35)  return { action: 'fold' }

  if (strength > 0.72 && myBalance > minR + toCall) {
    const extra  = Math.floor(Math.random() * Math.min(pot * 0.5, myBalance - toCall - minR))
    const amount = Math.max(minR, minR + Math.max(0, extra))
    return { action: 'raise', amount }
  }

  return { action: 'call' }
}
