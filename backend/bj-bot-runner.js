/**
 * Blackjack Automated Bot Runner
 *
 * Connects as a real WebSocket client (treated as human by BotManager, which
 * fills the room with bot opponents). Plays a few normal rounds to confirm
 * steady-state play still works, then deliberately exercises the two
 * mid-hand-disconnect paths that RoomManager.js now has to defer instead of
 * crediting immediately (see _blackjackPendingHand in RoomManager.js):
 *
 *   1. Voluntary leave while a hand is still unresolved (_leaveRoom)
 *   2. Hard disconnect while a hand is still unresolved (_expireGrace, after
 *      the 30s reconnect grace period expires)
 *
 * Before the fix, both paths credited the runner's pre-resolution balance
 * immediately AND let BlackjackGame's own players_removed cleanup credit it
 * again once the hand actually resolved — creating chips. This script
 * verifies that no longer happens by checking SUM(balance) over
 * {runner, bots, house} stays conserved (Blackjack is house-banked, like
 * Dragon Tiger — see HOUSE_USERNAME in RoomManager.js), and by printing the
 * runner's full ledger trail so a doubled cash_out would be visible by eye.
 *
 * Usage:
 *   node backend/bj-bot-runner.js
 *   ROUNDS=10 node backend/bj-bot-runner.js
 *
 * Env:
 *   WS_URL  ws://localhost:4000/poker  (default)
 *   ROUNDS  5                          (default — normal rounds before the
 *                                       two mid-hand tests)
 */

import WebSocket from 'ws'
import pool, { query } from './db.js'
import { randomUUID } from 'node:crypto'

const WS_URL         = process.env.WS_URL ?? 'ws://localhost:4000/poker'
const NORMAL_ROUNDS  = Number(process.env.ROUNDS ?? 5)
const RUNNER_NAME    = 'bj_runner'
const HOUSE_USERNAME = '_house_bank'
const BUY_IN         = 5000
const BET_AMOUNT     = 100
const TOPUP_BELOW    = 2000
const TOPUP_TO       = 10000

// ── Stats ──────────────────────────────────────────────────────────────
const stats = { errors: [], topups: 0, t0: Date.now() }

function ts() { return new Date().toISOString().slice(11, 19) }
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
       VALUES ($1, 'BJ_RUNNER_RESERVED', $2, false)
     ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
     RETURNING id, balance`,
    [RUNNER_NAME, BUY_IN],
  )
  if (Number(row.balance) < BUY_IN) {
    await query('UPDATE users SET balance = $1 WHERE id = $2', [BUY_IN, row.id])
  }
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
    await query(`INSERT INTO ledger (user_id, type, amount, game) VALUES ($1, 'bot_topup', $2, 'system')`, [bot.id, add])
    log(`Topped up ${bot.username}  ${bot.balance} → ${TOPUP_TO}`)
    stats.topups++
  }
}

async function chipSnapshot() {
  const { rows: [row] } = await query(
    `SELECT COALESCE(SUM(balance), 0)::bigint AS total
       FROM users WHERE username = $1 OR username = $2 OR is_bot = true`,
    [RUNNER_NAME, HOUSE_USERNAME],
  )
  return Number(row.total)
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

// ── Session: tracks live state + lets test code await specific conditions ─
function makeSession(ws, myId) {
  let state = null
  let lastPhase = null
  let betSentForRound = false
  let actedThisTurn = false
  let roundsCompleted = 0
  const waiters = []
  const balanceUpdates = []

  function checkWaiters() {
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].predicate()) {
        const w = waiters[i]
        waiters.splice(i, 1)
        clearTimeout(w.timer)
        w.resolve()
      }
    }
  }

  function waitFor(predicate, timeoutMs, label) {
    if (predicate()) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = waiters.findIndex(w => w.resolve === resolve)
        if (idx >= 0) waiters.splice(idx, 1)
        reject(new Error(`waitFor timeout: ${label ?? 'condition'}`))
      }, timeoutMs)
      waiters.push({ predicate, resolve, timer })
    })
  }

  const onMsg = (raw) => {
    let msg
    try { msg = JSON.parse(raw.toString()) } catch (e) { recordError('parse', e); return }

    if (msg.type === 'room_joined') {
      state = msg.state
      log(`room_joined phase=${state.phase}`)
    } else if (msg.type === 'state_update') {
      state = msg.state
      const me = state.players.find(p => p.id === myId)

      if (state.phase !== lastPhase) {
        if (state.phase === 'betting') { betSentForRound = false }
        if (state.phase === 'playing') { actedThisTurn = false }
        if (state.phase === 'result' && lastPhase !== 'result') {
          roundsCompleted++
          log(`round resolved (#${roundsCompleted}), my balance=${me?.balance ?? '(left)'}, result=${me?.result ?? '-'}`)
        }
        lastPhase = state.phase
      }

      // Auto-ready
      if (state.phase === 'waiting' && me && !me.ready) {
        send(ws, { type: 'set_ready' })
      }
      // Auto-bet once per betting phase
      if (state.phase === 'betting' && me && me.bet === 0 && !betSentForRound) {
        betSentForRound = true
        const amount = Math.min(BET_AMOUNT, Math.floor((me.balance ?? 0) / state.betUnit) * state.betUnit)
        if (amount >= state.minBet) {
          send(ws, { type: 'place_bet', amount })
        }
      }
      // Auto-stand on our turn (keeps rounds short/deterministic)
      if (state.phase === 'playing' && state.currentActorId === myId && !actedThisTurn) {
        actedThisTurn = true
        send(ws, { type: 'action', action: 'stand' })
      }
    } else if (msg.type === 'balance_update') {
      balanceUpdates.push(msg.balance)
      log(`  [WS push] balance_update received: ${msg.balance.toLocaleString()}`)
    } else if (msg.type === 'kicked_from_room') {
      log(`kicked_from_room: ${msg.message}`, 'WARN')
    } else if (msg.type === 'error') {
      recordError('server', new Error(msg.message), { phase: state?.phase })
    }

    checkWaiters()
  }

  ws.on('message', onMsg)

  return {
    getState:        () => state,
    getRoundsDone:    () => roundsCompleted,
    getBalanceUpdates: () => balanceUpdates,
    waitFor,
    stop: () => ws.off('message', onMsg),
  }
}

async function createBlackjackRoom(ws, buyIn = BUY_IN) {
  send(ws, { type: 'create_room', gameType: 'blackjack', gameSlug: 'blackjack', maxPlayers: 6, buyIn })
}

async function runnerDbBalance(id) {
  const { rows: [r] } = await query('SELECT balance FROM users WHERE id = $1', [id])
  return Number(r.balance)
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
  log('═══════════════════════════════════════')
  log(' BJ Bot Runner — Blackjack')
  log(` Normal rounds : ${NORMAL_ROUNDS}`)
  log(` Buy-in        : ${BUY_IN.toLocaleString()} chips`)
  log(` WS            : ${WS_URL}`)
  log('═══════════════════════════════════════')

  const { id: myId, token } = await ensureRunner()
  log(`Runner account id=${myId} (${RUNNER_NAME})`)

  // Warn if ambient rooms are likely active (bots occupied by non-BJ games).
  // Bots losing to human players in Texas/Big Two during this run will cause
  // apparent negative delta — not a BJ bug.  Run server with SEED_AMBIENT_ROOMS=0
  // for a clean zero-sum reading.
  if (process.env.SEED_AMBIENT_ROOMS !== '0') {
    log('WARN: Server may have ambient rooms active (SEED_AMBIENT_ROOMS != 0).', 'WARN')
    log('      Bot losses to human players will appear as negative delta.', 'WARN')
    log('      Restart server with SEED_AMBIENT_ROOMS=0 for accurate BJ accounting.', 'WARN')
  }

  await topupBots()

  const startTotal = await chipSnapshot()
  log(`Chip snapshot : ${startTotal.toLocaleString()} (runner + bots + house)`)
  const runStartIso = new Date(stats.t0).toISOString()

  // ── Phase 1: normal play ────────────────────────────────────────────
  let ws = await wsConnect(token)
  log('WebSocket connected')
  let session = makeSession(ws, myId)
  await createBlackjackRoom(ws)

  try {
    await session.waitFor(() => session.getRoundsDone() >= NORMAL_ROUNDS, 25_000 + NORMAL_ROUNDS * 20_000, 'normal rounds')
    log(`Normal play OK — ${session.getRoundsDone()} round(s) resolved cleanly`)
  } catch (err) {
    recordError('normal-rounds', err, { phase: session.getState()?.phase })
  }

  // ── Phase 2: voluntary leave mid-hand (_leaveRoom defer path) ───────
  log('\n── Test: voluntary leave mid-hand ──')
  try {
    await session.waitFor(() => session.getState()?.phase === 'betting', 20_000, 'betting phase (leave test)')
    await sleep(1500)  // let our place_bet land
    const before = session.getState()?.players?.find(p => p.id === myId)
    log(`Leaving with bet=${before?.bet} balance=${before?.balance} (hand unresolved)`)
    send(ws, { type: 'leave_room' })

    await session.waitFor(() => session.getBalanceUpdates().length > 0, 30_000, 'deferred balance_update after leave')
    log(`Deferred credit confirmed via live WS push — balance now ${session.getBalanceUpdates().at(-1).toLocaleString()}`)
  } catch (err) {
    recordError('leave-mid-hand', err, { phase: session.getState()?.phase })
  }

  // ── Phase 3: hard disconnect mid-hand (_expireGrace defer path) ─────
  log('\n── Test: disconnect mid-hand (30s grace) ──')
  try {
    session.stop()
    session = makeSession(ws, myId)
    // Runner's DB balance after phase 2 cash-out may be < BUY_IN; use whatever is available.
    const phase3BuyIn = Math.min(BUY_IN, await runnerDbBalance(myId))
    if (phase3BuyIn < 50) throw new Error(`runner balance too low for phase 3 (${phase3BuyIn})`)
    await createBlackjackRoom(ws, phase3BuyIn)
    await session.waitFor(() => session.getState()?.phase === 'betting', 20_000, 'betting phase (disconnect test)')
    await sleep(1500)
    const before = session.getState()?.players?.find(p => p.id === myId)
    log(`Disconnecting with bet=${before?.bet} balance=${before?.balance} (hand unresolved)`)
    ws.terminate()
    log('Connection terminated — waiting for grace period (30s) + hand resolution...')
    await sleep(55_000)
  } catch (err) {
    recordError('disconnect-mid-hand', err)
  }

  // ── Final report ──────────────────────────────────────────────────────
  const mins = ((Date.now() - stats.t0) / 60_000).toFixed(1)
  console.log('\n')
  log('═══════════ REPORT ═══════════')
  log(`Errors      : ${stats.errors.length}`)
  log(`Bot top-ups : ${stats.topups}`)
  log(`Duration    : ${mins} min`)
  if (stats.errors.length > 0) {
    log('\n── Error List ──')
    for (const e of stats.errors) log(`  [${e.time.slice(11, 19)}] ${e.context} — ${e.msg}`)
  }

  // Ledger trail for the runner — a doubled cash_out for either mid-hand
  // test would show up here as an extra row.
  try {
    const { rows: [{ id: runnerId }] } = await query('SELECT id FROM users WHERE username = $1', [RUNNER_NAME])
    const { rows: ledgerRows } = await query(
      `SELECT type, amount, bet, created_at FROM ledger WHERE user_id = $1 AND created_at >= $2 ORDER BY created_at`,
      [runnerId, runStartIso],
    )
    log('\n── Runner ledger trail ──')
    for (const r of ledgerRows) {
      log(`  ${r.created_at.toISOString().slice(11, 19)}  ${r.type.padEnd(10)} amount=${String(r.amount).padStart(7)} bet=${r.bet ?? '-'}`)
    }
    const cashOutCount = ledgerRows.filter(r => r.type === 'cash_out').length
    log(`  cash_out entries: ${cashOutCount} (expect 2 — one per mid-hand test)`)
    if (cashOutCount !== 2) log('  Unexpected cash_out count — check for double-crediting!', 'WARN')
  } catch (err) {
    recordError('ledger query', err)
  }

  // Zero-sum check: SUM(balance) over runner + bots + house must be conserved
  try {
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
      log('  Chips may have been created/destroyed — check _blackjackPendingHand / players_removed handling in RoomManager.js!', 'WARN')
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
