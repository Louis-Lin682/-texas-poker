/**
 * Dragon Tiger Automated Bot Runner
 *
 * Connects as a real WebSocket client (treated as human by BotManager, which
 * fills the room with bot opponents that bet alongside it). Runs N rounds of
 * Dragon Tiger, then verifies chip conservation across players AND the house
 * bank account (_house_bank).
 *
 * Dragon Tiger is fixed-odds (not a shared pot), so RoomManager.js's
 * round_result handler credits/debits the house with the exact opposite of
 * every round's combined player net (see HOUSE_USERNAME in RoomManager.js).
 * If that offset were ever wrong or skipped, SUM(balance) over
 * {runner, bots, house} would drift — that's what this script checks.
 *
 * Usage:
 *   node backend/dt-bot-runner.js
 *   ROUNDS=50 node backend/dt-bot-runner.js
 *
 * Env:
 *   WS_URL  ws://localhost:4000/poker  (default)
 *   ROUNDS  20                          (default)
 */

import WebSocket from 'ws'
import pool, { query } from './db.js'
import { randomUUID } from 'node:crypto'

const WS_URL         = process.env.WS_URL ?? 'ws://localhost:4000/poker'
const TARGET_ROUNDS  = Number(process.env.ROUNDS ?? 20)
const RUNNER_NAME    = 'dt_runner'
const HOUSE_USERNAME = '_house_bank'
const BUY_IN         = 5000
const TOPUP_BELOW    = 2000
const TOPUP_TO       = 10000
const ROUND_TIMEOUT  = 35_000   // betting 20s + dealing 3s + result 5s + margin

const ZONES   = ['dragon', 'tiger', 'tie', 'dragon_big', 'dragon_small', 'tiger_odd', 'tiger_even']
const AMOUNTS = [20, 50, 100]

// ── Stats ──────────────────────────────────────────────────────────────
const stats = {
  roundsSeen: 0,
  errors: [],
  topups: 0,
  t0: Date.now(),
}

function ts() { return new Date().toISOString().slice(11, 19) }
function log(msg, level = 'INFO')  { console.log(`[${ts()}] [${level}] ${msg}`) }
function warn(msg)                  { log(msg, 'WARN') }

function recordError(context, err, extra = null) {
  const entry = { time: new Date().toISOString(), context, msg: err?.message ?? String(err), extra }
  stats.errors.push(entry)
  log(`${context}: ${entry.msg}`, 'ERROR')
  if (extra) log(`  detail: ${JSON.stringify(extra).slice(0, 400)}`, 'ERROR')
}

// ── DB helpers ─────────────────────────────────────────────────────────
async function ensureRunner() {
  // Upsert runner account (not a bot — so BotManager treats it as human)
  const { rows: [row] } = await query(
    `INSERT INTO users (username, password_hash, balance, is_bot)
       VALUES ($1, 'DT_RUNNER_RESERVED', $2, false)
     ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
     RETURNING id, balance`,
    [RUNNER_NAME, BUY_IN],
  )
  if (Number(row.balance) < BUY_IN) {
    await query('UPDATE users SET balance = $1 WHERE id = $2', [BUY_IN, row.id])
  }
  // Fresh session (delete old ones first)
  await query('DELETE FROM sessions WHERE user_id = $1', [row.id])
  const token = randomUUID()
  await query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, row.id])
  return { id: row.id, token }
}

async function topupBots() {
  const { rows } = await query(
    'SELECT id, username, balance FROM users WHERE is_bot = true AND balance < $1',
    [TOPUP_BELOW],
  )
  for (const bot of rows) {
    const add = TOPUP_TO - Number(bot.balance)
    if (add <= 0) continue
    await query('UPDATE users SET balance = balance + $1 WHERE id = $2', [add, bot.id])
    await query(
      `INSERT INTO ledger (user_id, type, amount, game) VALUES ($1, 'bot_topup', $2, 'system')`,
      [bot.id, add],
    )
    log(`Topped up ${bot.username}  ${bot.balance} → ${TOPUP_TO}`)
    stats.topups++
  }
}

// ── WS helpers ─────────────────────────────────────────────────────────
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

// ── Single session (one continuous DT room, many rounds) ────────────────
function runSession(ws, myId) {
  return new Promise((resolve, reject) => {
    let state           = null
    let lastBetRoundId   = -1
    let lastSeenRoundId  = -1
    let roundsCompleted  = 0
    let leaving          = false
    let watchdog         = null

    const done = (outcome) => {
      clearTimeout(watchdog)
      ws.off('message', onMsg)
      resolve(outcome)
    }

    const bumpWatchdog = () => {
      clearTimeout(watchdog)
      watchdog = setTimeout(() => {
        recordError('Session watchdog', new Error('stuck'), {
          phase: state?.phase,
          roundId: state?.roundId,
          players: state?.players?.map(p => ({ id: p.id, balance: p.balance })),
        })
        send(ws, { type: 'leave_room' })
        reject(new Error(`Session timed out (phase=${state?.phase})`))
      }, ROUND_TIMEOUT)
    }

    const placeBetIfNeeded = () => {
      if (!state || state.phase !== 'betting') return
      if (state.roundId === lastBetRoundId) return
      lastBetRoundId = state.roundId
      const roundIdAtSchedule = state.roundId
      const delay = 500 + Math.random() * 2000
      setTimeout(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return
        const me = state?.players?.find(p => p.id === myId)
        if (!me || me.balance <= 0) return
        const zone   = ZONES[Math.floor(Math.random() * ZONES.length)]
        const amount = Math.min(AMOUNTS[Math.floor(Math.random() * AMOUNTS.length)], me.balance)
        send(ws, { type: 'dt_place_bet', zone, amount })
        log(`  bet round=${roundIdAtSchedule} zone=${zone} amount=${amount}`)
      }, delay)
    }

    const onMsg = (raw) => {
      let msg
      try { msg = JSON.parse(raw.toString()) }
      catch (e) { recordError('parse', e); return }

      bumpWatchdog()

      try {
        // ── Room joined ──
        if (msg.type === 'room_joined') {
          state = msg.state
          lastSeenRoundId = state.roundId
          log(`room_joined roundId=${state.roundId} phase=${state.phase}`)
          placeBetIfNeeded()
          return
        }

        // ── Kicked (balance hit 0) ──
        if (msg.type === 'kicked_from_room') {
          log(`kicked from room: ${msg.message}`, 'WARN')
          if (!leaving) { leaving = true; done({ ok: true, roundsCompleted, kicked: true }) }
          return
        }

        // ── Game state update ──
        if (msg.type === 'state_update') {
          state = msg.state

          if (state.roundId !== lastSeenRoundId) {
            roundsCompleted++
            const me = state.players.find(p => p.id === myId)
            log(`round ${roundsCompleted}/${TARGET_ROUNDS} resolved, my balance=${me?.balance ?? '(out)'}`)
            lastSeenRoundId = state.roundId
          }

          placeBetIfNeeded()

          if (roundsCompleted >= TARGET_ROUNDS && !leaving) {
            leaving = true
            log('target rounds reached, leaving room')
            send(ws, { type: 'leave_room' })
            setTimeout(() => done({ ok: true, roundsCompleted }), 500)
          }
          return
        }

        // ── Server error ──
        if (msg.type === 'error') {
          recordError('server', new Error(msg.message), { phase: state?.phase })
        }

      } catch (err) {
        recordError('handler', err, { phase: state?.phase })
      }
    }

    ws.on('message', onMsg)
    bumpWatchdog()

    // Create the room — BotManager auto-fills with bot opponents who bet too
    send(ws, {
      type:       'create_room',
      gameType:   'dragon-tiger',
      gameSlug:   'dragon-tiger',
      maxPlayers: 8,
      buyIn:      BUY_IN,
    })
  })
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
  log('═══════════════════════════════════════')
  log(' DT Bot Runner  —  Dragon Tiger')
  log(` Target  : ${TARGET_ROUNDS} rounds`)
  log(` Buy-in  : ${BUY_IN.toLocaleString()} chips`)
  log(` WS      : ${WS_URL}`)
  log('═══════════════════════════════════════')

  const { id: myId, token } = await ensureRunner()
  log(`Runner account id=${myId}  (${RUNNER_NAME})`)

  await topupBots()

  // Snapshot total chips before play: runner + all bots + house bank.
  // House is included because DT round settlement moves chips between
  // players and the house — the combined total is what must stay fixed.
  const { rows: [snapRow] } = await query(
    `SELECT COALESCE(SUM(balance), 0)::bigint AS total
       FROM users WHERE username = $1 OR username = $2 OR is_bot = true`,
    [RUNNER_NAME, HOUSE_USERNAME],
  )
  const startTotal = Number(snapRow.total)
  log(`Chip snapshot : ${startTotal.toLocaleString()} (runner + bots + house)`)

  const ws = await wsConnect(token)
  log('WebSocket connected')

  try {
    const result = await runSession(ws, myId)
    stats.roundsSeen = result?.roundsCompleted ?? 0
  } catch (err) {
    recordError('session', err)
  }

  try { ws.terminate() } catch {}

  // ── Final report ──────────────────────────────────────────────────────
  const mins = ((Date.now() - stats.t0) / 60_000).toFixed(1)
  console.log('\n')
  log('═══════════ REPORT ═══════════')
  log(`Rounds played : ${stats.roundsSeen} / ${TARGET_ROUNDS}`)
  log(`Errors        : ${stats.errors.length}`)
  log(`Bot top-ups   : ${stats.topups}`)
  log(`Duration      : ${mins} min`)

  if (stats.errors.length > 0) {
    log('\n── Error List ──')
    for (const e of stats.errors) {
      log(`  [${e.time.slice(11, 19)}] ${e.context} — ${e.msg}`)
    }
  }

  // Zero-sum check: SUM(balance) over runner + bots + house must be conserved
  // (modulo deliberate bot top-ups), since the house absorbs the exact
  // opposite of every round's player net — see RoomManager.js round_result.
  try {
    const runStartIso = new Date(stats.t0).toISOString()
    const { rows: [zs] } = await query(`
      SELECT
        (SELECT COALESCE(SUM(balance), 0)::bigint FROM users WHERE username = $1 OR username = $2 OR is_bot = true) AS end_total,
        (SELECT COALESCE(SUM(amount),  0)::bigint FROM ledger WHERE type = 'bot_topup' AND created_at >= $3) AS topup_injected,
        (SELECT balance FROM users WHERE username = $2) AS house_balance
    `, [RUNNER_NAME, HOUSE_USERNAME, runStartIso])
    const endTotal      = Number(zs.end_total)
    const topupInjected = Number(zs.topup_injected)
    const houseBalance  = Number(zs.house_balance)
    const expectedEnd   = startTotal + topupInjected
    const delta         = endTotal - expectedEnd
    log('\n── Zero-sum check (runner + bots + house) ──')
    log(`  Start total    : ${startTotal.toLocaleString()}`)
    log(`  Topup injected : ${topupInjected.toLocaleString()}`)
    log(`  Expected end   : ${expectedEnd.toLocaleString()}`)
    log(`  Actual end     : ${endTotal.toLocaleString()}`)
    log(`  House balance  : ${houseBalance.toLocaleString()}  (net player profit this run: ${(-houseBalance).toLocaleString()})`)
    log(`  Delta          : ${delta.toLocaleString()}  ${Math.abs(delta) < 10 ? '✓ OK' : '⚠  INVESTIGATE'}`)
    if (Math.abs(delta) >= 10) {
      log('  Chips may have been created/destroyed, or the house offset is wrong — check round_result handling in RoomManager.js!', 'WARN')
    }
  } catch (err) {
    recordError('zero-sum query', err)
  }

  log('═══════════════════════════════')

  await pool.end()
  process.exit(stats.errors.length > 0 ? 1 : 0)
}

main().catch(err => {
  log(`FATAL: ${err.message}`, 'ERROR')
  console.error(err)
  process.exit(1)
})
