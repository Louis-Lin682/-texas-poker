import axios from 'axios'
import * as cheerio from 'cheerio'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

async function fetchHtml(url) {
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8' },
    timeout: 20000,
  })
  return data
}

function extractNumbers(text) {
  return text.match(/\d+/g)?.map(Number).filter(n => n >= 1 && n <= 99) ?? []
}

/** 從 span/div 的文字中抽出期號（如 114000054 → "114000054"） */
function extractPeriod($) {
  let period = ''
  $('span, div, td').each((_, el) => {
    const txt = $(el).text().trim()
    const m = txt.match(/第\s*([\d]+)\s*期/) || txt.match(/期別[：:\s]*([\d]+)/)
    if (m && m[1].length >= 5) { period = m[1]; return false }
  })
  return period
}

// ── 今彩539 ──────────────────────────────────────────────────────────────────

export async function scrapeLotto539() {
  const html = await fetchHtml('https://www.taiwanlottery.com.tw/Lotto/Lotto539/')
  const $ = cheerio.load(html)

  const numbers = []

  // Primary: spans inside the winning number section
  $('[class*="Lotto539"] [class*="ball"], .ball_tx').each((_, el) => {
    const n = parseInt($(el).text().trim(), 10)
    if (!isNaN(n) && n >= 1 && n <= 39) numbers.push(n)
  })

  // Fallback: any element whose text is a number 01-39 inside a result container
  if (numbers.length !== 5) {
    numbers.length = 0
    $('[id*="539"], [class*="539"]').find('[class*="ball"], span, td').each((_, el) => {
      const n = parseInt($(el).text().trim(), 10)
      if (!isNaN(n) && n >= 1 && n <= 39) numbers.push(n)
    })
  }

  if (numbers.length !== 5) throw new Error(`Lotto539 parse failed: got ${numbers.length} numbers`)

  return {
    numbers: [...new Set(numbers)].sort((a, b) => a - b),
    period:  extractPeriod($),
  }
}

// ── 大樂透 ───────────────────────────────────────────────────────────────────

export async function scrapeLotto649() {
  const html = await fetchHtml('https://www.taiwanlottery.com.tw/lotto/Lotto649/')
  const $ = cheerio.load(html)

  const numbers = []
  let bonus = null

  $('[class*="Lotto649"] [class*="ball"], [class*="ball_b"], .ball_tx').each((_, el) => {
    const cls = $(el).attr('class') ?? ''
    const n   = parseInt($(el).text().trim(), 10)
    if (isNaN(n) || n < 1 || n > 49) return
    if (/bonus|special|sp/i.test(cls)) bonus = n
    else numbers.push(n)
  })

  if (numbers.length !== 6) {
    numbers.length = 0; bonus = null
    $('[id*="649"], [class*="649"]').find('[class*="ball"], span, td').each((_, el) => {
      const cls = $(el).attr('class') ?? ''
      const n   = parseInt($(el).text().trim(), 10)
      if (isNaN(n) || n < 1 || n > 49) return
      if (/bonus|special|sp/i.test(cls)) bonus = n
      else numbers.push(n)
    })
  }

  if (numbers.length !== 6) throw new Error(`Lotto649 parse failed: got ${numbers.length} numbers`)

  return {
    numbers: [...new Set(numbers)].sort((a, b) => a - b),
    bonusNumber: bonus,
    period: extractPeriod($),
  }
}

// ── 威力彩 ───────────────────────────────────────────────────────────────────

export async function scrapeLotto638() {
  const html = await fetchHtml('https://www.taiwanlottery.com.tw/Lotto/Lotto638/')
  const $ = cheerio.load(html)

  const numbers = []
  let extra = null

  $('[class*="Lotto638"] [class*="ball"], .ball_red, .ball_tx').each((_, el) => {
    const cls = $(el).attr('class') ?? ''
    const n   = parseInt($(el).text().trim(), 10)
    if (isNaN(n)) return
    if (/power|red|extra|sp/i.test(cls) && n >= 1 && n <= 8) extra = n
    else if (n >= 1 && n <= 38) numbers.push(n)
  })

  if (numbers.length !== 6) {
    numbers.length = 0; extra = null
    $('[id*="638"], [class*="638"]').find('[class*="ball"], span, td').each((_, el) => {
      const cls = $(el).attr('class') ?? ''
      const n   = parseInt($(el).text().trim(), 10)
      if (isNaN(n)) return
      if (/power|red|extra|sp/i.test(cls) && n >= 1 && n <= 8) extra = n
      else if (n >= 1 && n <= 38) numbers.push(n)
    })
  }

  if (numbers.length !== 6) throw new Error(`Lotto638 parse failed: got ${numbers.length} numbers`)

  return {
    numbers:     [...new Set(numbers)].sort((a, b) => a - b),
    extraNumber: extra,
    period:      extractPeriod($),
  }
}

export const SCRAPERS = {
  lotto539: scrapeLotto539,
  lotto649: scrapeLotto649,
  lotto638: scrapeLotto638,
}
