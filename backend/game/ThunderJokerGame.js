import { randomInt } from 'node:crypto'

const PAYLINES = [
  [0,0,0,0,0],[1,1,1,1,1],[2,2,2,2,2],[3,3,3,3,3],[4,4,4,4,4],
  [0,1,2,3,4],[4,3,2,1,0],
  [0,1,2,1,0],[0,2,4,2,0],[2,3,4,3,2],
  [4,3,2,3,4],[4,2,0,2,4],[2,1,0,1,2],
  [0,2,0,2,0],[4,2,4,2,4],
]

function rnd(pool) { return pool[randomInt(pool.length)] }

export class ThunderJokerGame {
  constructor({ getConfig }) {
    this._cfg = getConfig
  }

  buildPool() {
    const pool = []
    for (const [key, val] of Object.entries(this._cfg())) {
      if (key.startsWith('weight.')) {
        const sym = key.slice(7)
        for (let i = 0; i < Number(val); i++) pool.push(sym)
      }
    }
    return pool
  }

  genGrid() {
    const pool = this.buildPool()
    return Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => rnd(pool))
    )
  }

  calcWins(grid, bet) {
    const cfg  = this._cfg()
    let total  = 0
    const hits = []
    for (let li = 0; li < PAYLINES.length; li++) {
      const syms = PAYLINES[li].map((row, reel) => grid[reel][row])
      const key  = syms.find(s => s !== 'wild' && s !== 'scatter') ?? 'wild'
      let cnt = 0
      for (const s of syms) {
        if (s === key || s === 'wild') cnt++
        else break
      }
      if (cnt >= 3) {
        const table = cfg[`payout.${key}`] ?? []
        const mult  = table[cnt - 1] ?? 0
        if (mult > 0) { const w = mult * bet; total += w; hits.push({ li, key, cnt, w }) }
      }
    }
    let scatters = 0
    for (let r = 0; r < 5; r++)
      for (let row = 0; row < 5; row++)
        if (grid[r][row] === 'scatter') scatters++
    return { total, hits, scatters }
  }

  jokerImgKey(mult) {
    return Math.min(Math.max(Math.round(mult), 1), 10)
  }

  // Pure spin — no DB. Returns updated session clone + all spin results.
  // Caller must: load session before, save session + update balance + ledger after.
  spin({ bet, isFree, session }) {
    const cfg = this._cfg()

    const grid = this.genGrid()
    const { total, hits, scatters } = this.calcWins(grid, bet)

    // Lightning cell
    const lProb  = isFree ? (cfg['lightning.free_prob'] ?? 14) : (cfg['lightning.base_prob'] ?? 5)
    const lMults = isFree ? (cfg['lightning.free_mults'] ?? [2,3]) : (cfg['lightning.base_mults'] ?? [2,2,3])
    let lightningCell = null
    if (randomInt(100) < lProb) {
      lightningCell = { reel: randomInt(5), row: randomInt(5), mult: rnd(lMults) }
    }

    // Joker accumulation (free spins only)
    let jokerMultGained = 0
    let jokerImgKey     = null
    const newSession    = { ...session }
    if (isFree) {
      let jokerCount = 0
      for (let r = 0; r < 5; r++)
        for (let row = 0; row < 5; row++)
          if (grid[r][row] === 'joker') jokerCount++
      if (jokerCount > 0) {
        const jMults = cfg['joker.mults'] ?? [1,1,2,3,5]
        const jMax   = cfg['joker.max']   ?? 10
        for (let i = 0; i < jokerCount; i++) {
          const m = rnd(jMults)
          if (jokerMultGained === 0) jokerMultGained = m
          newSession.jokerMult = Math.min(newSession.jokerMult + m, jMax)
        }
        jokerImgKey = this.jokerImgKey(jokerMultGained)
      }
    }

    // Apply multipliers — only one per spin to avoid stacking
    let winTotal = total
    if (lightningCell && winTotal > 0) {
      winTotal = Math.floor(winTotal * lightningCell.mult)
    } else if (isFree && newSession.jokerMult > 1 && winTotal > 0) {
      winTotal = Math.floor(winTotal * newSession.jokerMult)
    }

    // Update free spins count
    let freeSpinsGranted = 0
    const maxFree = cfg['free.max_total'] ?? 30
    if (isFree) {
      newSession.freeSpinsLeft = Math.max(0, newSession.freeSpinsLeft - 1)
      if (scatters >= 3 && newSession.freeSpinsLeft < maxFree) {
        const extra = scatters === 3 ? (cfg['free.retrigger_3scatter'] ?? 4)
                    : scatters === 4 ? (cfg['free.retrigger_4scatter'] ?? 6)
                    :                  (cfg['free.retrigger_5scatter'] ?? 8)
        newSession.freeSpinsLeft = Math.min(newSession.freeSpinsLeft + extra, maxFree)
        freeSpinsGranted = extra
      }
      if (newSession.freeSpinsLeft === 0) newSession.jokerMult = 1
    } else if (scatters >= 3) {
      freeSpinsGranted = scatters === 3 ? (cfg['free.spins_3scatter'] ?? 6)
                       : scatters === 4 ? (cfg['free.spins_4scatter'] ?? 9)
                       :                  (cfg['free.spins_5scatter'] ?? 12)
      newSession.freeSpinsLeft = freeSpinsGranted
      newSession.jokerMult = 1
    }

    return {
      grid, hits, total, winTotal, scatters,
      lightningCell,
      jokerMultGained, jokerImgKey,
      freeSpinsGranted,
      session: newSession,
    }
  }
}
