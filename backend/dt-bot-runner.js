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

  // Global chip snapshot — SUM(ALL users) is the only true zero-sum invariant.
  // Scoping to runner+bots+house is misleading: bots in *other* rooms (poker/BJ)
  // may win chips from human players whose balances aren't in that narrow set,
  // making chips appear created even when accounting is correct.
  const { rows: [snapRow] } = await query(
    `SELECT COALESCE(SUM(balance), 0)::bigint AS total FROM users`,
  )
  // Also snapshot runner+bots+house for DT-specific per-account diagnosis
  const { rows: snapAccounts } = await query(
    `SELECT username, balance FROM users WHERE username = $1 OR username = $2 OR is_bot = true ORDER BY username`,
    [RUNNER_NAME, HOUSE_USERNAME],
  )
  const startTotal = Number(snapRow.total)
  const snapMap    = new Map(snapAccounts.map(r => [r.username, Number(r.balance)]))
  log(`Chip snapshot : ${startTotal.toLocaleString()} (ALL users total)`)

  await topupBots()

  const ws = await wsConnect(token)
  log('WebSocket connected')

  try {
    const result = await runSession(ws, myId)
    stats.roundsSeen = result?.roundsCompleted ?? 0
  } catch (err) {
    recordError('session', err)
  }

  try { ws.terminate() } catch {}
  // Give server 8 s to flush all async DB writes (cashout, syncBalances, house adjust).
  // With Neon network latency and pool max=5, ~40 fire-and-forget writes across 10 rounds
  // can take 3-4 s to fully commit — 2 s was too short and caused false-positive drift.
  await new Promise(r => setTimeout(r, 8000))

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

  // ── Global zero-sum check ─────────────────────────────────────────────
  // SUM(ALL user balances) must be conserved modulo known external injections
  // (bot top-ups). Scoping to runner+bots+house only is misleading because
  // bots active in *other* rooms (poker/BJ) can win chips from human players
  // whose balances aren't in that set, causing false-positive chip-creation.
  try {
    const runStartIso = new Date(stats.t0).toISOString()

    const { rows: [endTotalRow] } = await query(
      `SELECT COALESCE(SUM(balance), 0)::bigint AS total FROM users`,
    )
    const { rows: [topupRow] } = await query(
      `SELECT COALESCE(SUM(amount), 0)::bigint AS injected
         FROM ledger WHERE type = 'bot_topup' AND created_at >= $1`,
      [runStartIso],
    )
    const { rows: endAccounts } = await query(
      `SELECT username, balance FROM users WHERE username = $1 OR username = $2 OR is_bot = true ORDER BY username`,
      [RUNNER_NAME, HOUSE_USERNAME],
    )

    const endGlobalTotal = Number(endTotalRow.total)
    const topupInjected  = Number(topupRow.injected)
    const endMap         = new Map(endAccounts.map(r => [r.username, Number(r.balance)]))
    const houseBalance   = endMap.get(HOUSE_USERNAME) ?? 0
    const expectedEnd    = startTotal + topupInjected
    const delta          = endGlobalTotal - expectedEnd

    log('\n── Zero-sum check (ALL users) ──')
    log(`  Start total    : ${startTotal.toLocaleString()}`)
    log(`  Topup injected : ${topupInjected.toLocaleString()}`)
    log(`  Expected end   : ${expectedEnd.toLocaleString()}`)
    log(`  Actual end     : ${endGlobalTotal.toLocaleString()}`)
    log(`  Delta          : ${delta.toLocaleString()}  ${Math.abs(delta) < 10 ? '✓ OK' : '⚠  INVESTIGATE'}`)

    // DT-specific per-account breakdown (runner + bots + house only)
    log('\n── DT account delta (runner + bots + house) ──')
    log(`  House balance  : ${houseBalance.toLocaleString()}`)
    const allNames = new Set([...snapMap.keys(), ...endMap.keys()])
    for (const name of [...allNames].sort()) {
      const s = snapMap.get(name) ?? 0
      const e = endMap.get(name) ?? 0
      const d = e - s
      if (d !== 0) log(`  ${name.padEnd(20)} ${s.toLocaleString().padStart(10)} → ${e.toLocaleString().padStart(10)}  (${d > 0 ? '+' : ''}${d.toLocaleString()})`)
    }

    if (Math.abs(delta) >= 10) {
      log('  ⚠  Global chip total drifted — check round_result in RoomManager.js!', 'WARN')
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
