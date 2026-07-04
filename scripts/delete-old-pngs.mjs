import { readdir, unlink, access } from 'fs/promises'
import { join, extname } from 'path'

const KEEP_PNG = new Set([
  'DragonTiger/frame.png', 'DragonTiger/ruleIcon.png', 'leave-room-button.png',
  'slot-imgs/10.png', 'slot-imgs/A.png', 'slot-imgs/bell.png', 'slot-imgs/blue-lightning.png',
  'slot-imgs/blue7.png', 'slot-imgs/clownhat-blue.png', 'slot-imgs/clownhat-golden.png',
  'slot-imgs/clownhat-purple.png', 'slot-imgs/clownhat-red.png', 'slot-imgs/gemstone-blue.png',
  'slot-imgs/gemstone-green.png', 'slot-imgs/gemstone-purple.png', 'slot-imgs/gemstone-red.png',
  'slot-imgs/green7.png', 'slot-imgs/info.png', 'slot-imgs/iron.png', 'slot-imgs/J.png',
  'slot-imgs/K.png', 'slot-imgs/lightningx10.png', 'slot-imgs/lightningx2.png',
  'slot-imgs/lightningx3.png', 'slot-imgs/lightningx5.png', 'slot-imgs/list.png',
  'slot-imgs/max.png', 'slot-imgs/purple-lightning.png', 'slot-imgs/Q.png', 'slot-imgs/red7.png',
  'slot-imgs/scatter.png', 'slot-imgs/slot-img.png', 'slot-imgs/slot-img2.png',
  'slot-imgs/spin.png', 'slot-imgs/star.png', 'slot-imgs/unmute.png', 'slot-imgs/wild.png',
])

const ROOT = 'frontend/public'

async function walk(dir) {
  const files = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) files.push(...await walk(full))
    else if (extname(e.name).toLowerCase() === '.png') files.push(full)
  }
  return files
}

async function exists(p) {
  try { await access(p); return true } catch { return false }
}

let count = 0
for (const f of await walk(ROOT)) {
  const rel = f.replace(ROOT + '\\', '').replace(ROOT + '/', '').replaceAll('\\', '/')
  if (KEEP_PNG.has(rel)) continue
  const webp = f.replace(/\.png$/i, '.webp')
  if (await exists(webp)) {
    await unlink(f)
    console.log('deleted: ' + rel)
    count++
  }
}

// backend/public/player
for (const e of await readdir('backend/public/player', { withFileTypes: true })) {
  if (!e.name.endsWith('.png')) continue
  const src = join('backend/public/player', e.name)
  const webp = src.replace(/\.png$/, '.webp')
  if (await exists(webp)) {
    await unlink(src)
    console.log('deleted: backend/public/player/' + e.name)
    count++
  }
}

console.log(`\nDone: ${count} PNGs removed`)
