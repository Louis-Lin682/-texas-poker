/**
 * Texas Hold'em Automated Bot Runner
 *
 * Connects as a real WebSocket client (treated as human by BotManager),
 * which triggers BotManager to fill the room with 3 bot opponents.
 * Tests the full WS stack: auth → room creation → game logic → ledger.
 *
 * Usage:
 *   node backend/bot-runner.js
 *   GAMES=50 TIER=low node backend/bot-runner.js
 *
 * Env:
 *   WS_URL   ws://localhost:4000/poker  (default)
 *   GAMES    300                         (default)
 *   TIER     low | mid | high | vip      (default: low)
 */

import WebSocket from 'ws'
import pool, { query } from './db.js'
import { decide } from './game/BotPlayer.js'
import { randomUUID } from 'node:crypto'

// ── Tier config ────────────────────────────────────────────────────────
const TIERS = {
  low:  { label: '低限',  smallBlind: 10,  bigBlind: 20  },
  mid:  { label: '中限',  smallBlind: 25,  bigBlind: 50  },
  high: { label: '高限',  smallBlind: 50,  bigBlind: 100 },
  vip:  { label: '豪華',  smallBlind: 100, bigBlind: 200 },
}

const WS_URL       = process.env.WS_URL  ?? 'ws://localhost:4000/poker'
const TARGET_GAMES = Number(process.env.GAMES ?? 300)
const TIER         = TIERS[process.env.TIER ?? 'low']
const BUY_IN       = TIER.bigBlind * 50          // min required to sit
const TOPUP_BELOW  = BUY_IN                      // top up bots below this
const TOPUP_TO     = BUY_IN * 10                 // fill to this amount
const THINK_MS     = 120                          // bot think delay
const GAME_TIMEOUT = 90_000                       // ms before game is declared stuck
const RUNNER_NAME  = 'bot_runner'

// ── Stats ──────────────────────────────────────────────────────────────
const stats = {
  played: 0,
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
       VALUES ($1, 'BOT_RUNNER_RESERVED', $2, false)
     ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
     RETURNING id, balance`,
    [RUNNER_NAME, TOPUP_TO],
  )
  // Ensure enough balance to play
  if (Number(row.balance) < BUY_IN) {
    await query('UPDATE users SET balance = $1 WHERE id = $2', [TOPUP_TO, row.id])
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

// ── Single game ────────────────────────────────────────────────────────
function runGame(ws, myId, gameIndex) {
  return new Promise((resolve, reject) => {
    let state        = null
    let holeCards    = []
    let gameStarted  = false
    let pendingAct   = false
    let watchdog     = null
    let handsDealt   = 0
    let leaving      = false

    const done = (outcome) => {
      clearTimeout(watchdog)
      ws.off('message', onMsg)
      resolve(outcome)
    }

    const bumpWatchdog = () => {
      clearTimeout(watchdog)
      watchdog = setTimeout(() => {
        recordError(`Game ${gameIndex} watchdog`, new Error('stuck'), {
          phase: state?.phase,
          acting: state?.actingPlayerId,
          players: state?.players?.map(p => ({ id: p.id, status: p.status, balance: p.balance })),
        })
        send(ws, { type: 'leave_room' })
        reject(new Error(`Game ${gameIndex} timed out (phase=${state?.phase})`))
      }, GAME_TIMEOUT)
    }

    const onMsg = (raw) => {
      let msg
      try { msg = JSON.parse(raw.toString()) }
      catch (e) { recordError(`Game ${gameIndex} parse`, e); return }

      bumpWatchdog()

      try {
        // ── Room joined → set ready ──
        if (msg.type === 'room_joined') {
          log(`  G${gameIndex} room_joined, sending set_ready`)
          setTimeout(() => send(ws, { type: 'set_ready' }), 400)
          return
        }

        // ── Hole cards dealt ──
        if (msg.type === 'hole_cards') {
          handsDealt++
          holeCards = msg.cards ?? []
          log(`  G${gameIndex} hole_cards [#${handsDealt}]: ${holeCards.join(' ')}`)
          // 第二手開始 = 第一手結束 (fold-win 不會經過 showdown phase)
          if (handsDealt > 1 && !leaving) {
            leaving = true
            log(`  G${gameIndex} hand done, leaving room`)
            send(ws, { type: 'leave_room' })
            setTimeout(() => done({ ok: true, finalState: state }), 400)
          }
          return
        }

        // ── Game state update ──
        if (msg.type === 'state_update') {
          const prevPhase = state?.phase
          state = msg.state

          if (state.phase !== prevPhase) {
            const players = state.players.map(p => `${p.username}(${p.balance})`).join(', ')
            log(`  G${gameIndex} phase: ${prevPhase ?? '?'} → ${state.phase}  acting=${state.actingPlayerId?.slice(0,8) ?? '-'}  players=[${players}]`)
          }

          // Mark game as started once it leaves waiting
          if (state.phase !== 'waiting') gameStarted = true

          // 偵測 runner 被淘汰（籌碼歸零後從玩家列表消失）
          if (gameStarted && !leaving) {
            const me = state.players.find(p => p.id === myId)
            if (!me) {
              leaving = true
              log(`  G${gameIndex} runner eliminated, leaving room`)
              send(ws, { type: 'leave_room' })
              setTimeout(() => done({ ok: true, finalState: state }), 400)
              return
            }
          }

          // Act on my turn
          if (
            state.actingPlayerId === myId &&
            state.phase !== 'waiting' &&
            !pendingAct
          ) {
            const me = state.players.find(p => p.id === myId)
            if (me) {
              pendingAct = true
              const snap = { ...state }
              const snapCards = [...holeCards]
              setTimeout(() => {
                pendingAct = false
                if (!ws || ws.readyState !== WebSocket.OPEN) return
                if (state.actingPlayerId !== myId) return   // turn moved on

                const dec = decide({
                  holeCards:      snapCards,
                  communityCards: snap.communityCards ?? [],
                  phase:          snap.phase,
                  currentBet:     snap.currentBet   ?? 0,
                  myRoundBet:     me.roundBet       ?? 0,
                  myBalance:      me.balance        ?? 0,
                  pot:            snap.pot          ?? 0,
                  minRaise:       snap.minRaise ?? snap.bigBlind ?? TIER.bigBlind,
                })
                log(`  G${gameIndex} ACT ${dec.action} ${dec.amount ?? ''}`)
                send(ws, { type: 'action', action: dec.action, amount: dec.amount ?? 0 })
              }, THINK_MS)
            }
          }

          // Fallback: if somehow phase returns to waiting (not enough players)
          if (gameStarted && state.phase === 'waiting' && !leaving) {
            leaving = true
            log(`  G${gameIndex} hand done (waiting), leaving room`)
            setTimeout(() => {
              send(ws, { type: 'leave_room' })
              setTimeout(() => done({ ok: true, finalState: state }), 400)
            }, 500)
          }
          return
        }

        // ── Server error ──
        if (msg.type === 'error') {
          recordError(`Game ${gameIndex} server`, new Error(msg.message), { phase: state?.phase })
        }

      } catch (err) {
        recordError(`Game ${gameIndex} handler`, err, { phase: state?.phase })
      }
    }

    ws.on('message', onMsg)
    bumpWatchdog()

    // Create the room — BotManager auto-fills with 3 bot opponents
    send(ws, {
      type:       'create_room',
      gameType:   'texas-holdem',
      gameSlug:   'texas-holdem',
      smallBlind: TIER.smallBlind,
      bigBlind:   TIER.bigBlind,
      maxPlayers: 4,
      buyIn:      BUY_IN,
    })
  })
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
  log('═══════════════════════════════════════')
  log(` Bot Runner  —  Texas Hold\'em`)
  log(` Tier   : ${TIER.label}  (SB ${TIER.smallBlind} / BB ${TIER.bigBlind})`)
  log(` Target : ${TARGET_GAMES} games`)
  log(` Buy-in : ${BUY_IN.toLocaleString()} chips`)
  log(` WS     : ${WS_URL}`)
  log('═══════════════════════════════════════')

  const { id: myId, token } = await ensureRunner()
  log(`Runner account id=${myId}  (${RUNNER_NAME})`)

  await topupBots()

  // Snapshot total chips before games begin (runner + all bots)
  const { rows: [snapRow] } = await query(
    `SELECT COALESCE(SUM(balance), 0)::bigint AS total FROM users WHERE username = $1 OR is_bot = true`,
    [RUNNER_NAME],
  )
  const startTotal = Number(snapRow.total)
  log(`Chip snapshot  : ${startTotal.toLocaleString()} (runner + bots)`)

  let ws = await wsConnect(token)
  log('WebSocket connected')

  for (let g = 1; g <= TARGET_GAMES; g++) {
    // Reconnect if socket dropped
    if (ws.readyState !== WebSocket.OPEN) {
      warn(`WS not open before game ${g}, reconnecting...`)
      try {
        ws = await wsConnect(token)
      } catch (err) {
        recordError(`Game ${g} reconnect`, err)
        await sleep(3000)
        continue
      }
    }

    try {
      log(`▶ Game ${g}/${TARGET_GAMES}`)
      await runGame(ws, myId, g)
      stats.played++
    } catch (err) {
      recordError(`Game ${g}`, err)
      stats.played++
      // Reconnect after error — previous WS may be in bad state
      try { ws.terminate() } catch {}
      await sleep(2000)
      try { ws = await wsConnect(token) } catch (e) { recordError('reconnect after error', e) }
    }

    // Top up every 30 games
    if (g % 30 === 0) await topupBots()

    // Progress log every 10 games
    if (g % 10 === 0) {
      const mins = ((Date.now() - stats.t0) / 60_000).toFixed(1)
      log(`── ${g}/${TARGET_GAMES} games  ${mins}min  ${stats.errors.length} errors ──`)
    }

    await sleep(700)
  }

  // ── Final report ──────────────────────────────────────────────────────
  const mins = ((Date.now() - stats.t0) / 60_000).toFixed(1)
  console.log('\n')
  log('═══════════ REPORT ═══════════')
  log(`Games played : ${stats.played} / ${TARGET_GAMES}`)
  log(`Errors       : ${stats.errors.length}`)
  log(`Bot top-ups  : ${stats.topups}`)
  log(`Duration     : ${mins} min`)

  if (stats.errors.length > 0) {
    log('\n── Error List ──')
    for (const e of stats.errors) {
      log(`  [${e.time.slice(11, 19)}] ${e.context} — ${e.msg}`)
    }
  }

  // Zero-sum check: compare total balance (runner + all bots) vs start + topups injected
  try {
    const runStartIso = new Date(stats.t0).toISOString()
    const { rows: [zs] } = await query(`
      SELECT
        (SELECT COALESCE(SUM(balance), 0)::bigint FROM users WHERE username = $1 OR is_bot = true) AS end_total,
        (SELECT COALESCE(SUM(amount),  0)::bigint FROM ledger WHERE type = 'bot_topup' AND created_at >= $2) AS topup_injected
    `, [RUNNER_NAME, runStartIso])
    const endTotal       = Number(zs.end_total)
    const topupInjected  = Number(zs.topup_injected)
    const expectedEnd    = startTotal + topupInjected
    const delta          = endTotal - expectedEnd
    log('\n── Zero-sum check (balance method) ──')
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
