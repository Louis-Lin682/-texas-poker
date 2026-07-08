import { query } from '../db.js'
import { EventEmitter } from 'node:events'

export const configBus = new EventEmitter()

const GAME = 'thunder-joker'

export const DEFAULT_CONFIG = {
  'min_bet':   10,
  'max_bet':   1000,

  // Symbol pool weights (copies per reel position)
  'weight.10':              3,
  'weight.J':               3,
  'weight.Q':               3,
  'weight.K':               3,
  'weight.A':               3,
  'weight.clownhat-blue':   3,
  'weight.clownhat-golden': 3,
  'weight.clownhat-purple': 3,
  'weight.clownhat-red':    3,
  'weight.bell':            8,
  'weight.joker':           15,
  'weight.wild':            8,
  'weight.scatter':         2,

  // Payout table [1x,2x,3x,4x,5x] — multiplier applied to bet per payline
  'payout.wild':              [0,0,150,750,3500],
  'payout.joker':             [0,0,100,600,2000],
  'payout.bell':              [0,0,22,75,300],
  'payout.clownhat-red':      [0,0,12,40,150],
  'payout.clownhat-purple':   [0,0,8,22,90],
  'payout.clownhat-blue':     [0,0,6,15,60],
  'payout.clownhat-golden':   [0,0,4,12,45],
  'payout.A':                 [0,0,3,8,30],
  'payout.K':                 [0,0,2,6,22],
  'payout.Q':                 [0,0,2,5,18],
  'payout.J':                 [0,0,1,4,15],
  'payout.10':                [0,0,1,2,10],

  // Lightning multiplier
  'lightning.base_prob':  5,
  'lightning.free_prob':  14,
  'lightning.base_mults': [2,2,3],
  'lightning.free_mults': [2,3],

  // Free spins
  'free.spins_3scatter':     6,
  'free.spins_4scatter':     9,
  'free.spins_5scatter':     12,
  'free.retrigger_3scatter': 4,
  'free.retrigger_4scatter': 6,
  'free.retrigger_5scatter': 8,
  'free.max_total':          30,

  // Joker multiplier accumulation during free spins
  'joker.mults': [1,1,2,3,5],
  'joker.max':   10,

  // Win level thresholds (win / bet ratio)
  'win_level.big':   2,
  'win_level.mega':  10,
  'win_level.epic':  50,
  'win_level.super': 200,
}

let _cache   = { ...DEFAULT_CONFIG }
let _version = 0

export function getConfig()   { return _cache   }
export function getVersion()  { return _version }

export async function loadConfig() {
  const { rows } = await query(
    `SELECT gcv.config, gcv.version
     FROM game_config_current gcc
     JOIN game_config_versions gcv ON gcv.id = gcc.version_id
     WHERE gcc.game = $1`,
    [GAME]
  )
  if (rows.length > 0) {
    _cache   = { ...DEFAULT_CONFIG, ...rows[0].config }
    _version = rows[0].version ?? 0
  }
}

export async function saveConfig(config, changedBy, note = '') {
  const { rows: cur } = await query(
    'SELECT version_id FROM game_config_current WHERE game = $1', [GAME]
  )
  const prevVersion = cur[0]
    ? (await query('SELECT version FROM game_config_versions WHERE id = $1', [cur[0].version_id])).rows[0]?.version ?? 0
    : 0

  const merged = { ...DEFAULT_CONFIG, ..._cache, ...config }
  const { rows } = await query(
    `INSERT INTO game_config_versions (game, version, config, changed_by, note)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [GAME, prevVersion + 1, JSON.stringify(merged), changedBy, note]
  )
  const newId = rows[0].id

  await query(
    `INSERT INTO game_config_current (game, version_id)
     VALUES ($1, $2)
     ON CONFLICT (game) DO UPDATE SET version_id = EXCLUDED.version_id`,
    [GAME, newId]
  )

  _cache   = merged
  _version = prevVersion + 1
  configBus.emit('updated', _cache)
  return newId
}
