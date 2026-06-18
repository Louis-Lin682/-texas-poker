import { query } from '../db.js'
import { GAMES, matchTier } from './definitions.js'

/**
 * 結算一期開獎：
 * 1. 計算每層獎池（本期池 + 上期滾入）
 * 2. 對每張票對獎
 * 3. 分獎、入帳、標記 settled
 * 4. 無人中獎的可rollover層 → 累積進下一期
 */
export async function settleDraw(drawId) {
  const { rows: [draw] } = await query(
    `SELECT * FROM lottery_draws WHERE id = $1`, [drawId]
  )
  if (!draw) throw new Error(`Draw ${drawId} not found`)
  if (draw.status === 'settled') return { skipped: true }
  if (draw.status !== 'drawn') throw new Error(`Draw ${drawId} status is ${draw.status}, expected drawn`)

  const game = GAMES[draw.game_slug]
  if (!game) throw new Error(`Unknown game slug: ${draw.game_slug}`)

  // ── 1. 計算各獎層的獎池 ───────────────────────────────────────────────────
  // 取得上期此彩種各層的未領 rollover（若有）
  const { rows: prevTiers } = await query(`
    SELECT ltp.tier, ltp.total - ltp.winner_count * ltp.prize_each AS carryover
    FROM lottery_tier_pools ltp
    JOIN lottery_draws ld ON ld.id = ltp.draw_id
    WHERE ld.game_slug = $1
      AND ld.draw_date < $2
      AND ld.status = 'settled'
      AND ltp.winner_count = 0
    ORDER BY ld.draw_date DESC
  `, [draw.game_slug, draw.draw_date])

  // 只取每個tier最近一期的rollover
  const carryoverMap = {}
  for (const r of prevTiers) {
    if (!(r.tier in carryoverMap)) {
      const def = game.tiers.find(t => t.tier === r.tier)
      if (def?.rollover) carryoverMap[r.tier] = Number(r.carryover)
    }
  }

  const tierPoolMap = {}
  for (const t of game.tiers) {
    const allocated  = Number(draw.prize_pool) * t.poolShare
    const carriedIn  = carryoverMap[t.tier] ?? 0
    tierPoolMap[t.tier] = { allocated, carriedIn, total: allocated + carriedIn }
  }

  // ── 2. 取出所有待結算的票 ─────────────────────────────────────────────────
  const { rows: bets } = await query(
    `SELECT * FROM lottery_bets WHERE draw_id = $1 AND status = 'pending'`,
    [drawId]
  )

  // 對獎
  const winnersByTier = {}
  for (const t of game.tiers) winnersByTier[t.tier] = []

  for (const bet of bets) {
    const tier = matchTier(
      game,
      bet.numbers,
      bet.extra_number,
      draw.numbers,
      draw.bonus_number,
      draw.extra_number,
    )
    if (tier > 0) winnersByTier[tier].push(bet)
  }

  // ── 3. 計算每位得獎者的彩金 ───────────────────────────────────────────────
  const tierResults = {}
  for (const t of game.tiers) {
    const pool    = tierPoolMap[t.tier]
    const winners = winnersByTier[t.tier]
    const count   = winners.length
    const each    = count > 0 ? Math.floor(pool.total / count) : 0
    tierResults[t.tier] = { ...pool, winnerCount: count, prizeEach: each }
  }

  // ── 4. 寫 DB（在 transaction 中）─────────────────────────────────────────
  const client = await (await import('../db.js')).default.connect()
  try {
    await client.query('BEGIN')

    // upsert tier pools
    for (const t of game.tiers) {
      const r = tierResults[t.tier]
      await client.query(`
        INSERT INTO lottery_tier_pools (draw_id, tier, allocated, carried_in, total, winner_count, prize_each)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (draw_id, tier) DO UPDATE
          SET allocated=$3, carried_in=$4, total=$5, winner_count=$6, prize_each=$7
      `, [drawId, t.tier, r.allocated, r.carriedIn, r.total, r.winnerCount, r.prizeEach])
    }

    // settle each bet
    for (const bet of bets) {
      const tier = matchTier(
        game, bet.numbers, bet.extra_number,
        draw.numbers, draw.bonus_number, draw.extra_number,
      )
      const prize = tier > 0 ? tierResults[tier].prizeEach : 0
      await client.query(`
        UPDATE lottery_bets
        SET tier_won=$2, prize=$3, status=$4, settled_at=NOW()
        WHERE id=$1
      `, [bet.id, tier || 0, prize, tier > 0 ? 'won' : 'lost'])

      if (prize > 0) {
        // add balance
        await client.query(`UPDATE users SET balance = balance + $1 WHERE id = $2`, [prize, bet.user_id])
        // ledger
        await client.query(`
          INSERT INTO ledger (user_id, type, amount, game, detail)
          VALUES ($1,'lottery_win',$2,$3,$4)
        `, [bet.user_id, prize, draw.game_slug, JSON.stringify({ drawId, tier, betId: bet.id })])
      }
    }

    // mark draw settled
    await client.query(
      `UPDATE lottery_draws SET status='settled', settled_at=NOW() WHERE id=$1`, [drawId]
    )

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  const totalPrize = bets.reduce((s, b) => {
    const tier = matchTier(game, b.numbers, b.extra_number, draw.numbers, draw.bonus_number, draw.extra_number)
    return s + (tier > 0 ? tierResults[tier].prizeEach : 0)
  }, 0)

  console.log(`[lottery] settled draw ${drawId} (${draw.game_slug} ${draw.draw_date}): ${bets.length} bets, ${Object.values(winnersByTier).flat().length} winners, ${totalPrize} paid out`)
  return { settled: true, bets: bets.length, tierResults }
}
