import cron from 'node-cron'
import { query } from '../db.js'
import { GAME_LIST } from './definitions.js'
import { SCRAPERS } from './scraper.js'
import { settleDraw } from './settler.js'

// Taiwan = UTC+8 → cron runs in server local time, so we adjust if needed
// Cron expression: second minute hour day month weekday
//
// Draw at 20:30 Taiwan → close bets at 20:30 Taiwan
// Results available ~20:35-20:45 → scrape + settle at 21:00 Taiwan

/** Get today's draw date in Taiwan time (YYYY-MM-DD) */
function getTwDate(d = new Date()) {
  return new Date(d.getTime() + 8 * 3600 * 1000)
    .toISOString().slice(0, 10)
}

/** Check if given game draws today (Taiwan time) */
function drawsToday(game, d = new Date()) {
  const tw = new Date(d.getTime() + 8 * 3600 * 1000)
  return game.drawDays.includes(tw.getDay())
}

/** Ensure an open draw row exists for today's eligible games */
export async function ensureTodayDraws() {
  const date = getTwDate()
  for (const game of GAME_LIST) {
    if (!drawsToday(game)) continue
    await query(`
      INSERT INTO lottery_draws (game_slug, draw_date, status, prize_pool, numbers)
      VALUES ($1, $2, 'open', 0, '{}')
      ON CONFLICT (game_slug, draw_date) DO NOTHING
    `, [game.slug, date])
  }
}

/** Close bets for draws that reached cutoff */
async function closeDraws() {
  const date = getTwDate()
  await query(`
    UPDATE lottery_draws SET status = 'closed'
    WHERE draw_date = $1 AND status = 'open'
  `, [date])
  console.log(`[lottery] closed draws for ${date}`)
}

/** Scrape results and trigger settlement */
async function scrapeAndSettle() {
  const date = getTwDate()

  for (const game of GAME_LIST) {
    if (!drawsToday(game)) continue

    const { rows: [draw] } = await query(`
      SELECT * FROM lottery_draws
      WHERE game_slug = $1 AND draw_date = $2 AND status = 'closed'
    `, [game.slug, date])

    if (!draw) continue

    const scraper = SCRAPERS[game.slug]
    if (!scraper) continue

    try {
      const result = await scraper()

      await query(`
        UPDATE lottery_draws
        SET numbers = $2, bonus_number = $3, extra_number = $4,
            period = $5, status = 'drawn', drawn_at = NOW()
        WHERE id = $1
      `, [draw.id, result.numbers, result.bonusNumber ?? null, result.extraNumber ?? null, result.period ?? ''])

      console.log(`[lottery] scraped ${game.slug}: ${result.numbers.join(',')}`)

      await settleDraw(draw.id)
    } catch (err) {
      console.error(`[lottery] scrape/settle failed for ${game.slug}:`, err.message)
    }
  }
}

export function initLotteryScheduler() {
  // Ensure today's draw rows exist at startup and at midnight Taiwan (16:00 UTC)
  ensureTodayDraws().catch(console.error)
  cron.schedule('0 16 * * *', () => ensureTodayDraws().catch(console.error))  // 00:00 Taiwan

  // Close bets at 20:30 Taiwan = 12:30 UTC
  cron.schedule('30 12 * * *', () => closeDraws().catch(console.error))

  // Scrape + settle at 21:00 Taiwan = 13:00 UTC
  cron.schedule('0 13 * * *', () => scrapeAndSettle().catch(console.error))

  console.log('[lottery] scheduler initialised')
}
