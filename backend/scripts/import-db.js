import 'dotenv/config'
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { initDb } from '../db.js'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

// Step 1: create schema
console.log('建立資料表結構…')
await initDb()
console.log('結構建立完成')

// Step 2: import data
const sql = readFileSync('export.sql', 'utf8')
const statements = sql
  .split('\n')
  .filter(line => !line.startsWith('--') && line.trim())
  .join('\n')
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0)

const client = await pool.connect()
try {
  await client.query('BEGIN')
  for (const stmt of statements) {
    await client.query(stmt)
  }
  await client.query('COMMIT')
  console.log(`匯入完成，共 ${statements.length} 筆`)
} catch (err) {
  await client.query('ROLLBACK')
  console.error('匯入失敗:', err.message)
  process.exit(1)
} finally {
  client.release()
  await pool.end()
}
