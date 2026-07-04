import { readdir, readFile, writeFile } from 'fs/promises'
import { join, extname } from 'path'

// PNG 圖片保留 .png（WebP 反而更大）
const KEEP_PNG = new Set([
  'DragonTiger/frame.png',
  'DragonTiger/ruleIcon.png',
  'leave-room-button.png',
  'slot-imgs/10.png',
  'slot-imgs/A.png',
  'slot-imgs/bell.png',
  'slot-imgs/blue-lightning.png',
  'slot-imgs/blue7.png',
  'slot-imgs/clownhat-blue.png',
  'slot-imgs/clownhat-golden.png',
  'slot-imgs/clownhat-purple.png',
  'slot-imgs/clownhat-red.png',
  'slot-imgs/gemstone-blue.png',
  'slot-imgs/gemstone-green.png',
  'slot-imgs/gemstone-purple.png',
  'slot-imgs/gemstone-red.png',
  'slot-imgs/green7.png',
  'slot-imgs/info.png',
  'slot-imgs/iron.png',
  'slot-imgs/J.png',
  'slot-imgs/K.png',
  'slot-imgs/lightningx10.png',
  'slot-imgs/lightningx2.png',
  'slot-imgs/lightningx3.png',
  'slot-imgs/lightningx5.png',
  'slot-imgs/list.png',
  'slot-imgs/max.png',
  'slot-imgs/purple-lightning.png',
  'slot-imgs/Q.png',
  'slot-imgs/red7.png',
  'slot-imgs/scatter.png',
  'slot-imgs/slot-img.png',
  'slot-imgs/slot-img2.png',
  'slot-imgs/spin.png',
  'slot-imgs/star.png',
  'slot-imgs/unmute.png',
  'slot-imgs/wild.png',
])

const SOURCE_EXTS = new Set(['.jsx', '.js', '.tsx', '.ts', '.css', '.html'])
const SEARCH_ROOTS = ['frontend/src', 'packages']

async function walk(dir) {
  let files = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory() && e.name !== 'node_modules' && e.name !== '.git') {
      files.push(...await walk(full))
    } else if (e.isFile() && SOURCE_EXTS.has(extname(e.name))) {
      files.push(full)
    }
  }
  return files
}

// 取代 .png → .webp，但跳過 KEEP_PNG 清單
function replacePng(content) {
  return content.replace(/(['"`/])([^'"`\s]*?\.png)(['"`\s?#])/g, (match, pre, path, post) => {
    // 取出 public 路徑部分（去掉開頭 /）
    const rel = path.replace(/^\//, '')
    if (KEEP_PNG.has(rel)) return match
    return `${pre}${path.replace(/\.png$/, '.webp')}${post}`
  })
}

let totalFiles = 0
for (const root of SEARCH_ROOTS) {
  const files = await walk(root)
  for (const file of files) {
    const original = await readFile(file, 'utf8')
    const updated = replacePng(original)
    if (updated !== original) {
      await writeFile(file, updated, 'utf8')
      console.log(`  updated: ${file}`)
      totalFiles++
    }
  }
}

console.log(`\nDone: ${totalFiles} files updated`)
