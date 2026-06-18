// 彩種定義與獎級結構

export const GAMES = {
  lotto539: {
    slug:           'lotto539',
    name:           '今彩539',
    pickCount:      5,
    poolSize:       39,
    hasBonus:       false,
    hasExtra:       false,
    betAmount:      50,
    feeRate:        0.16,       // 16% platform fee
    poolRate:       0.84,       // 84% to prize pool
    drawDays:       [1,2,3,4,5,6], // 0=Sun … 6=Sat; Mon-Sat
    drawTimeHH:     20,
    drawTimeMM:     30,
    tiers: [
      { tier: 1, name: '頭獎', matchMain: 5, matchBonus: false, matchExtra: false, poolShare: 0.55, rollover: true  },
      { tier: 2, name: '貳獎', matchMain: 4, matchBonus: false, matchExtra: false, poolShare: 0.25, rollover: true  },
      { tier: 3, name: '參獎', matchMain: 3, matchBonus: false, matchExtra: false, poolShare: 0.12, rollover: false },
      { tier: 4, name: '肆獎', matchMain: 2, matchBonus: false, matchExtra: false, poolShare: 0.08, rollover: false },
    ],
  },

  lotto649: {
    slug:           'lotto649',
    name:           '大樂透',
    pickCount:      6,
    poolSize:       49,
    hasBonus:       true,       // 1 bonus ball from remaining
    hasExtra:       false,
    betAmount:      50,
    feeRate:        0.16,
    poolRate:       0.84,
    drawDays:       [1, 4],     // Mon, Thu
    drawTimeHH:     20,
    drawTimeMM:     30,
    tiers: [
      { tier: 1, name: '頭獎', matchMain: 6, matchBonus: false, matchExtra: false, poolShare: 0.50, rollover: true  },
      { tier: 2, name: '貳獎', matchMain: 5, matchBonus: true,  matchExtra: false, poolShare: 0.12, rollover: true  },
      { tier: 3, name: '參獎', matchMain: 5, matchBonus: false, matchExtra: false, poolShare: 0.10, rollover: false },
      { tier: 4, name: '肆獎', matchMain: 4, matchBonus: false, matchExtra: false, poolShare: 0.10, rollover: false },
      { tier: 5, name: '伍獎', matchMain: 3, matchBonus: false, matchExtra: false, poolShare: 0.10, rollover: false },
      { tier: 6, name: '陸獎', matchMain: 2, matchBonus: true,  matchExtra: false, poolShare: 0.08, rollover: false },
    ],
  },

  lotto638: {
    slug:           'lotto638',
    name:           '威力彩',
    pickCount:      6,
    poolSize:       38,
    hasBonus:       false,
    hasExtra:       true,       // 1 power ball from 1-8
    extraPoolSize:  8,
    betAmount:      50,
    feeRate:        0.16,
    poolRate:       0.84,
    drawDays:       [1, 4],     // Mon, Thu
    drawTimeHH:     20,
    drawTimeMM:     30,
    tiers: [
      { tier: 1, name: '頭獎', matchMain: 6, matchBonus: false, matchExtra: true,  poolShare: 0.50, rollover: true  },
      { tier: 2, name: '貳獎', matchMain: 6, matchBonus: false, matchExtra: false, poolShare: 0.12, rollover: true  },
      { tier: 3, name: '參獎', matchMain: 5, matchBonus: false, matchExtra: true,  poolShare: 0.10, rollover: false },
      { tier: 4, name: '肆獎', matchMain: 5, matchBonus: false, matchExtra: false, poolShare: 0.10, rollover: false },
      { tier: 5, name: '伍獎', matchMain: 4, matchBonus: false, matchExtra: false, poolShare: 0.10, rollover: false },
      { tier: 6, name: '陸獎', matchMain: 3, matchBonus: false, matchExtra: true,  poolShare: 0.08, rollover: false },
    ],
  },
}

export const GAME_LIST = Object.values(GAMES)

/** Calculate which tier a bet hits, returns tier number (1-based) or 0 */
export function matchTier(game, betNumbers, betExtra, drawNumbers, drawBonus, drawExtra) {
  const mainHits = betNumbers.filter(n => drawNumbers.includes(n)).length
  const bonusHit = drawBonus != null && betNumbers.includes(drawBonus)
  const extraHit = drawExtra != null && betExtra != null && betExtra === drawExtra

  for (const t of game.tiers) {
    const mainOk  = mainHits === t.matchMain
    const bonusOk = !t.matchBonus  || bonusHit
    const extraOk = !t.matchExtra  || extraHit
    if (mainOk && bonusOk && extraOk) return t.tier
  }
  return 0
}
