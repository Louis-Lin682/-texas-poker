import sharp from 'sharp'
import { readdir, stat, unlink } from 'fs/promises'
import { join, extname, basename } from 'path'

const ROOT = 'frontend/public'
const QUALITY = 85
const SKIP = [
  // spritesheet — 保留 PNG，部分 Canvas API 需要
]

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) files.push(...await walk(full))
    else if (extname(e.name).toLowerCase() === '.png') files.push(full)
  }
  return files
}

const pngs = await walk(ROOT)
let saved = 0
let count = 0

for (const src of pngs) {
  const name = basename(src, '.png')
  if (SKIP.some(s => src.includes(s))) continue

  const dest = src.replace(/\.png$/i, '.webp')
  const before = (await stat(src)).size

  try {
    await sharp(src).webp({ quality: QUALITY }).toFile(dest)
    const after = (await stat(dest)).size
    saved += before - after
    count++
    if (after >= before) {
      // WebP 比原檔大（罕見），刪掉 webp 保留 png
      await unlink(dest)
      console.log(`  skip (webp larger) ${src}`)
    } else {
      console.log(`  ${src.replace('frontend/public/', '')}  ${(before/1024).toFixed(0)}KB → ${(after/1024).toFixed(0)}KB`)
    }
  } catch (err) {
    console.error(`  ERROR ${src}:`, err.message)
  }
}

console.log(`\nDone: ${count} files, saved ${(saved/1024/1024).toFixed(1)} MB`)
