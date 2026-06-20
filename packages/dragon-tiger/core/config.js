import { query } from './db.js'
import { EventEmitter } from 'node:events'

export const configBus = new EventEmitter()

const GAME = 'dragon-tiger'

const DEFAULT_CONFIG = {
  'payout.dragon':      1,
  'payout.tiger':       1,
  'payout.tie':         8,
  'payout.tie_refund':  0.5,
  'payout.big':         1,
  'payout.small':       1,
  'payout.odd':         1,
  'payout.even':        1,
  'payout.suit':        3,
  'seven_rule':        'push',
  'min_bet':            20,
  'max_bet':            10000,
  'bet_time_ms':        20000,
}

let _cache = { ...DEFAULT_CONFIG }
let _versionId = null

export function getConfig() {
  return _cache
}

export function getVersionId() {
  return _versionId
}

export async function loadConfig() {
  const { rows } = await query(
    `SELECT gcv.id, gcv.config
     FROM game_config_current gcc
     JOIN game_config_versions gcv ON gcv.id = gcc.version_id
     WHERE gcc.game = $1`,
    [GAME]
  )
  if (rows.length > 0) {
    _cache     = { ...DEFAULT_CONFIG, ...rows[0].config }
    _versionId = rows[0].id
  }
}

// Called by admin-server after saving new config
export async function reloadConfig() {
  await loadConfig()
  configBus.emit('updated', _cache)
}

export async function saveConfig(config, changedBy, note = '') {
  const { rows: cur } = await query(
    'SELECT version_id FROM game_config_current WHERE game = $1',
    [GAME]
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

  await reloadConfig()
  return newId
}
