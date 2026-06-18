/**
 * Big Two Automated Bot Runner
 *
 * Connects as a real WebSocket client (treated as human by BotManager),
 * stays in the same room for all TARGET_GAMES rounds (no reconnect per round).
 * Tests: auth → room creation → multi-round game logic → ledger → zero-sum.
 *
 * Usage:
 *   node backend/bt-bot-runner.js
 *   GAMES=20 node backend/bt-bot-runner.js
 *
 * Env:
 *   WS_URL    ws://localhost:4000/poker  (default)
 *   GAMES     30                          (default)
 *   BET_UNIT  10                          (default)
 */

import WebSocket from 'ws'
import pool, { query } from './db.js'
import { decideBigTwo } from './game/BigTwoBotPlayer.js'
import { classifyBTHand } from './game/BigTwoGame.js'
import { randomUUID } from 'node:crypto'

const WS_URL       = process.env.WS_URL  ?? 'ws://localhost:4000/poker'
const TARGET_GAMES = Number(process.env.GAMES ?? 30)
const BET_UNIT     = Number(process.env.BET_UNIT ?? 10)
const BUY_IN       = 1000
const THINK_MS     = 200
const ROUND_TIMEOUT = 120_000   // ms before a single round is declared stuck
const RUNNER_NAME  = 'bt_runner'

const stats = {
  played: 0,
  errors: [],
  runnerTopups: 0,
  t0: Date.now(),
}

function ts()  { return new Date().toISOString().slice(11, 19) }
function log(msg, level = 'INFO') { console.log(`[${ts()}] [${level}] ${msg}`) }

function recordError(context, err, extra = null) {
  const entry = { time: new Date().toISOString(), context, msg: err?.message ?? String(err), extra }
  stats.errors.push(entry)
  log(`${context}: ${entry.msg}`, 'ERROR')
  if (extra) log(`  detail: ${JSON.stringify(extra).slice(0, 400)}`, 'ERROR')
}

// ── DB helpers ─────────────────────────────────────────────────────────
async function ensureRunner() {
  const { rows: [row] } = await query(
    `INSERT INTO users (username, password_hash, balance, is_bot)
       VALUES ($1, 'BOT_RUNNER_RESERVED', $2, false)
     ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
     RETURNING id, balance`,
    [RUNNER_NAME, BUY_IN * 100],
  )
  if (Number(row.balance) < BUY_IN * 5) {
    await query('UPDATE users SET balance = $1 WHERE id = $2', [BUY_IN * 100, row.id])
  }
  await query('DELETE FROM sessions WHERE user_id = $1', [row.id])
  const token = randomUUID()
  await query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, row.id])
  return { id: row.id, token }
}

async function topupBots() {
  const BOT_MIN = BUY_IN * 2
  const BOT_TO  = BUY_IN * 20
  const { rows } = await query(
    'SELECT id, username, balance FROM users WHERE is_bot = true AND balance < $1',
    [BOT_MIN],
  )
  for (const bot of rows) {
    const add = BOT_TO - Number(bot.balance)
    if (add <= 0) continue
    await query('UPDATE users SET balance = balance + $1 WHERE id = $2', [add, bot.id])
    await query(
      `INSERT INTO ledger (user_id, type, amount, game) VALUES ($1, 'bot_topup', $2, 'system')`,
      [bot.id, add],
    )
    log(`Topped up ${bot.username} → ${BOT_TO}`)
  }
}

async function topupRunner(myId) {
  const { rows: [row] } = await query('SELECT balance FROM users WHERE id = $1', [myId])
  const current = Number(row?.balance ?? 0)
  if (current >= BUY_IN * 10) return 0
  const add = BUY_IN * 100 - current
  if (add <= 0) return 0
  await query('UPDATE users SET balance = balance + $1 WHERE id = $2', [add, myId])
  log(`Runner topped up +${add} (was ${current})`)
  return add
}

async function chipSnapshot() {
  const { rows: [row] } = await query(
    `SELECT COALESCE(SUM(balance), 0)::bigint AS total
       FROM users WHERE username = $1 OR is_bot = true`,
    [RUNNER_NAME],
  )
  return Number(row.total)
}

function wsConnect(token) {
  return new Promise((resolve, reject) => {
    const ws  = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`)
    const tid = setTimeout(() => { ws.terminate(); reject(new Error('WS connect timeout')) }, 10_000)
    ws.once('open',  () => { clearTimeout(tid); resolve(ws) })
    ws.once('error', (e) => { clearTimeout(tid); reject(e) })
  })
}

function send(ws, obj) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj))
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ── All games in one persistent WS session ─────────────────────────────
function runSession(ws, myId) {
  return new Promise((resolve) => {
    let myHand       = []
    let pendingAct   = false
    let state        = null
    let watchdog     = null

    const bumpWatchdog = (label) => {
      clearTimeout(watchdog)
      watchdog = setTimeout(() => {
        recordError(`Round ${stats.played + 1} watchdog`, new Error(`stuck at ${label}`), {
          phase: state?.phase,
          currentPlayerId: state?.currentPlayerId,
        })
        // Try to escape by leaving and ending session
        send(ws, { type: 'leave_room' })
        resolve()
      }, ROUND_TIMEOUT)
    }

    const onMsg = (raw) => {
      let msg
      try { msg = JSON.parse(raw.toString()) }
      catch (e) { recordError('parse', e); return }

      bumpWatchdog(msg.type)

      try {
        // ── Joined room → send ready ──
        if (msg.type === 'room_joined') {
          log(`R${stats.played + 1} room_joined → set_ready`)
          setTimeout(() => send(ws, { type: 'set_ready' }), 400)
          return
        }

        // ── Private hand ──
        if (msg.type === 'deal') {
          myHand = msg.hand ?? []
          log(`R${stats.played + 1} deal: ${myHand.join(' ')}`)
          return
        }

        // ── State update: act on my turn ──
        if (msg.type === 'state_update') {
          const prevPhase = state?.phase
          state = msg.state
          // Sync hand from server-authoritative state (removes played cards)
          if (Array.isArray(msg.state.myHand) && msg.state.myHand.length > 0) {
            myHand = msg.state.myHand
          }

          if (state.phase !== prevPhase) {
            log(`R${stats.played + 1} phase: ${prevPhase ?? '?'} → ${state.phase}  current=${state.currentPlayerId?.slice(0, 8) ?? '-'}`)
          }

          // Detect elimination: runner removed from game after losing all chips
          if (stats.played > 0 && state.phase === 'waiting') {
            const stillInGame = state.players.some(p => p.id === myId)
            if (!stillInGame) {
              log(`R${stats.played + 1} runner eliminated → topping up & re-joining`)
              ;(async () => {
                const added = await topupRunner(myId)
                stats.runnerTopups += added
                send(ws, { type: 'leave_room' })
                await sleep(1500)
                myHand = []; pendingAct = false; state = null
                send(ws, {
                  type: 'create_room', gameType: 'big-two', gameSlug: 'big-two',
                  betUnit: BET_UNIT, maxPlayers: 4, buyIn: BUY_IN,
                })
              })().catch(err => recordError('rejoin', err))
              return
            }
          }

          if (
            state.phase === 'playing' &&
            state.currentPlayerId === myId &&
            !pendingAct
          ) {
            pendingAct = true
            const snapHand   = [...myHand]
            const rawPile    = state.pile
            const snapPile   = rawPile ? {
              cards:      rawPile.cards,
              classified: classifyBTHand(rawPile.cards),
            } : null
            // isFirstOfGame: pile is null AND I hold 3c (I'm the designated first player)
            const snapFirst  = !rawPile && snapHand.includes('3c')

            setTimeout(() => {
              pendingAct = false
              if (!ws || ws.readyState !== WebSocket.OPEN) return
              if (state.currentPlayerId !== myId) return

              const dec = decideBigTwo({ hand: snapHand, pile: snapPile, isFirstOfGame: snapFirst })
              log(`R${stats.played + 1} ACT ${dec.action}${dec.cards ? ' [' + dec.cards.join(' ') + ']' : ''}`)
              send(ws, { type: 'action', action: dec.action, cards: dec.cards ?? [] })
            }, THINK_MS)
          }
          return
        }

        // ── Round finished ──
        if (msg.type === 'game_result') {
          stats.played++
          const me = (msg.scores ?? []).find(s => s.id === myId)
          log(`R${stats.played} game_result  rank=${me?.rank ?? '?'}  chipChange=${me?.chipChange ?? '?'}  (${stats.played}/${TARGET_GAMES})`)

          if (stats.played >= TARGET_GAMES) {
            clearTimeout(watchdog)
            ws.off('message', onMsg)
            resolve()
            return
          }

          // Top up bots every 5 rounds, then set ready for next round
          const doReady = () => send(ws, { type: 'set_ready' })
          if (stats.played % 5 === 0) {
            topupBots().catch(() => {}).finally(() => setTimeout(doReady, 800))
          } else {
            setTimeout(doReady, 800)
          }
          return
        }

        if (msg.type === 'error') {
          recordError(`R${stats.played + 1} server`, new Error(msg.message), { phase: state?.phase })
        }

      } catch (err) {
        recordError(`R${stats.played + 1} handler`, err, { phase: state?.phase })
      }
    }

    ws.on('message', onMsg)
    bumpWatchdog('init')

    send(ws, {
      type:       'create_room',
      gameType:   'big-two',
      gameSlug:   'big-two',
      betUnit:    BET_UNIT,
      maxPlayers: 4,
      buyIn:      BUY_IN,
    })
  })
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
  log('═══════════════════════════════════════')
  log(` Bot Runner  —  大老二`)
  log(` Target : ${TARGET_GAMES} rounds`)
  log(` BetUnit: ${BET_UNIT}`)
  log(` WS     : ${WS_URL}`)
  log('═══════════════════════════════════════')

  if (process.env.SEED_AMBIENT_ROOMS !== '0') {
    log('WARN: Server may have ambient rooms active (SEED_AMBIENT_ROOMS != 0).', 'WARN')
    log('      Bot losses to human players will appear as negative delta.', 'WARN')
    log('      Restart server with SEED_AMBIENT_ROOMS=0 for accurate accounting.', 'WARN')
  }

  const { id: myId, token } = await ensureRunner()
  log(`Runner account id=${myId}  (${RUNNER_NAME})`)

  const startTotal = await chipSnapshot()
  log(`Chip snapshot  : ${startTotal.toLocaleString()} (runner + bots)`)

  const ws = await wsConnect(token)
  log('WebSocket connected')

  await runSession(ws, myId)

  // Leave room and allow DB writes to settle
  send(ws, { type: 'leave_room' })
  await sleep(3000)

  // ── Final report ──────────────────────────────────────────────────────
  const mins = ((Date.now() - stats.t0) / 60_000).toFixed(1)
  console.log('\n')
  log('═══════════ REPORT ═══════════')
  log(`Rounds played : ${stats.played} / ${TARGET_GAMES}`)
  log(`Errors        : ${stats.errors.length}`)
  log(`Runner topups : ${stats.runnerTopups.toLocaleString()}`)
  log(`Duration      : ${mins} min`)

  if (stats.errors.length > 0) {
    log('── Error List ──')
    for (const e of stats.errors) {
      log(`  [${e.time.slice(11, 19)}] ${e.context} — ${e.msg}`)
    }
  }

  // Zero-sum check: (runner + bots end) − topups injected == start total
  try {
    const runStartIso = new Date(stats.t0).toISOString()
    const { rows: [zs] } = await query(`
      SELECT
        (SELECT COALESCE(SUM(balance), 0)::bigint
           FROM users WHERE username = $1 OR is_bot = true) AS end_total,
        (SELECT COALESCE(SUM(amount), 0)::bigint
           FROM ledger WHERE type = 'bot_topup' AND created_at >= $2) AS topup_injected
    `, [RUNNER_NAME, runStartIso])
    const endTotal      = Number(zs.end_total)
    const topupInjected = Number(zs.topup_injected)
    const expectedEnd   = startTotal + topupInjected + stats.runnerTopups
    const delta         = endTotal - expectedEnd
    log('\n── Zero-sum check ──')
    log(`  Start total    : ${startTotal.toLocaleString()}`)
    log(`  Topup injected : ${topupInjected.toLocaleString()}`)
    log(`  Expected end   : ${expectedEnd.toLocaleString()}`)
    log(`  Actual end     : ${endTotal.toLocaleString()}`)
    log(`  Delta          : ${delta.toLocaleString()}  ${Math.abs(delta) < 10 ? '✓ OK' : '⚠  INVESTIGATE'}`)
    if (Math.abs(delta) >= 10) {
      log('  Chips may have been created or destroyed — check game logic!', 'WARN')
    }
  } catch (err) {
    recordError('zero-sum query', err)
  }

  log('═══════════════════════════════')

  try { ws.terminate() } catch {}
  await pool.end()
  process.exit(stats.errors.length > 0 ? 1 : 0)
}

main().catch(err => {
  log(`FATAL: ${err.message}`, 'ERROR')
  console.error(err)
  process.exit(1)
})
