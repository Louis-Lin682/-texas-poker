import 'dotenv/config'
import pg from 'pg'
import { writeFileSync } from 'node:fs'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

function escape(v) {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'number') return String(v)
  if (v instanceof Date) return `'${v.toISOString()}'`
  return `'${String(v).replace(/'/g, "''")}'`
}

async function exportTable(client, table, columns, orderBy) {
  const { rows } = await client.query(
    `SELECT ${columns.join(', ')} FROM ${table} ORDER BY ${orderBy}`
  )
  if (rows.length === 0) return `-- ${table}: (empty)\n`
  const lines = rows.map(row => {
    const vals = columns.map(col => escape(row[col]))
    return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${vals.join(', ')}) ON CONFLICT DO NOTHING;`
  })
  return `-- ${table} (${rows.length} rows)\n` + lines.join('\n') + '\n'
}

let client
try {
  console.log('連線中…')
  client = await pool.connect()
  console.log('連線成功，開始匯出…')
  const parts = [
    '-- Texas Poker DB export\n-- Run import-db.js against the new DB after this.\n',
    await exportTable(client, 'users',     ['id','username','password_hash','balance','is_bot','created_at'], 'created_at'),
    await exportTable(client, 'sessions',  ['token','user_id','created_at'], 'created_at'),
    await exportTable(client, 'favorites', ['id','user_id','game_id','created_at'], 'created_at'),
    await exportTable(client, 'check_ins', ['user_id','streak','last_check_in','updated_at'], 'user_id'),
    await exportTable(client, 'ledger',    ['id','user_id','type','amount','room_id','game','created_at'], 'created_at'),
  ]
  writeFileSync('export.sql', parts.join('\n'), 'utf8')
  console.log('匯出完成 → export.sql')
} catch (err) {
  console.error('匯出失敗:', err.message)
  process.exit(1)
} finally {
  client?.release()
  await pool.end()
}
