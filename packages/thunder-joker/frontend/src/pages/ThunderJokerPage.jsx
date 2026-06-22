import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from '../services/apiClient.js'
import { useSlotSounds } from '../hooks/useSlotSounds.js'
import { getAudioSettings } from '../hooks/useAudio.js'
import { CoinLayer } from '../components/CoinLayer.jsx'
import { LightningLayer } from '../components/LightningLayer.jsx'
import LeaveConfirmModal from '../components/LeaveConfirmModal.jsx'

// ── Symbol definitions ──────────────────────────────────────────────────────
const SYMS = {
  wild:       { src: '/slot-imgs/wild.png',       v: [0, 0, 150,  750, 3500], isWild: true    },
  joker:      { src: '/slot-imgs/joker.png',       v: [0, 0, 100,  600, 2000], isJoker: true   },
  bell:       { src: '/slot-imgs/bell.png',         v: [0, 0,  22,   75,  300]                   },
  'clownhat-red':    { src: '/slot-imgs/clownhat-red.png',    v: [0, 0,  12,   40,  150]                   },
  'clownhat-purple': { src: '/slot-imgs/clownhat-purple.png', v: [0, 0,   8,   22,   90]                   },
  'clownhat-blue':   { src: '/slot-imgs/clownhat-blue.png',   v: [0, 0,   6,   15,   60]                   },
  'clownhat-golden': { src: '/slot-imgs/clownhat-golden.png', v: [0, 0,   4,   12,   45]                   },
  A:          { src: '/slot-imgs/A.png',              v: [0, 0,   3,    8,   30]                   },
  K:          { src: '/slot-imgs/K.png',              v: [0, 0,   2,    6,   22]                   },
  Q:          { src: '/slot-imgs/Q.png',              v: [0, 0,   2,    5,   18]                   },
  J:          { src: '/slot-imgs/J.png',              v: [0, 0,   1,    4,   15]                   },
  '10':       { src: '/slot-imgs/10.png',             v: [0, 0,   1,    2,   10]                   },
  scatter:    { src: '/slot-imgs/scatter.png',        v: [0, 0,   0,    0,    0], isScatter: true  },
}

const POOL = [
  // DEV MODE: boosted joker/wild/scatter for testing win animations
  ...Array(3).fill('10'), ...Array(3).fill('J'), ...Array(3).fill('Q'),
  ...Array(3).fill('K'), ...Array(3).fill('A'), ...Array(3).fill('clownhat-blue'),
  ...Array(3).fill('clownhat-golden'), ...Array(3).fill('clownhat-purple'), ...Array(3).fill('clownhat-red'),
  ...Array(8).fill('bell'), ...Array(15).fill('joker'),
  ...Array(8).fill('wild'), ...Array(5).fill('scatter'),
]

// 20 paylines: [row per reel], rows 0(top)~4(bottom)
const PAYLINES = [
  [0,0,0,0,0], [1,1,1,1,1], [2,2,2,2,2], [3,3,3,3,3], [4,4,4,4,4], // horizontals
  [0,1,2,3,4], [4,3,2,1,0],                                           // diagonals
  [0,1,2,1,0], [0,2,4,2,0], [2,3,4,3,2],                             // V
  [4,3,2,3,4], [4,2,0,2,4], [2,1,0,1,2],                             // ∧
  [0,2,0,2,0], [4,2,4,2,4],                                           // gentle waves
]
const PAYLINE_COLORS = [
  '#ff4455','#ff8844','#ffcc00','#88dd22','#22ccff',
  '#cc44ff','#ff44cc',
  '#ff6633','#ff8833','#ffaa33',
  '#3366ff','#5544ff','#33aaff',
  '#22ddcc','#22bb99',
]

const CELL_PX  = 70
const CELL_GAP = 2
const REEL_PAD = 6
const SVG_DIM  = REEL_PAD * 2 + 5 * CELL_PX + 4 * CELL_GAP  // 370

function cellCenter(reel, row) {
  return {
    x: REEL_PAD + reel * (CELL_PX + CELL_GAP) + CELL_PX / 2,
    y: REEL_PAD + row  * (CELL_PX + CELL_GAP) + CELL_PX / 2,
  }
}

function polyToPath(pts) {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
}

function calcPathLength(pts) {
  let len = 0
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i-1].x
    const dy = pts[i].y - pts[i-1].y
    len += Math.sqrt(dx*dx + dy*dy)
  }
  return Math.ceil(len) + 2
}


// Standard steps between min_bet and max_bet; min_bet itself is always prepended.
const BET_STEPS     = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]
const DEFAULT_MIN   = 10
const DEFAULT_MAX   = 1000

function buildBetOptions(minBet, maxBet) {
  const above = BET_STEPS.filter(b => b > minBet && b <= maxBet)
  return [minBet, ...above]
}
const SPIN_BASE    = 1000
const REEL_STAGGER = 150   // ms between reels
const FS_MULTS     = [2, 3]
const BASE_MULTS   = [2, 2, 3]
const JOKER_MULTS  = [1, 1, 2, 3, 5]

function rnd(pool)  { return pool[Math.floor(Math.random() * pool.length)] }
function genCol()   { return [rnd(POOL), rnd(POOL), rnd(POOL), rnd(POOL), rnd(POOL)] }
function genGrid()  { return Array.from({ length: 5 }, genCol) }

function calcWins(grid, bet) {
  let total = 0
  const hits = []
  for (let li = 0; li < PAYLINES.length; li++) {
    const syms = PAYLINES[li].map((row, reel) => grid[reel][row])
    const key  = syms.find(s => !SYMS[s]?.isWild && !SYMS[s]?.isScatter) ?? 'wild'
    let cnt = 0
    for (const s of syms) {
      if (s === key || SYMS[s]?.isWild) cnt++
      else break
    }
    if (cnt >= 3) {
      const mult = SYMS[key]?.v[cnt - 1] ?? 0
      if (mult > 0) { const w = mult * bet; total += w; hits.push({ li, key, cnt, w }) }
    }
  }
  let scatters = 0
  for (let r = 0; r < 5; r++) for (let row = 0; row < 5; row++) if (grid[r][row] === 'scatter') scatters++
  return { total, hits, scatters }
}

function fsCountEase(p) {
  if (p < 0.3)  return (p / 0.3) * 0.15
  if (p < 0.75) return 0.15 + ((p - 0.3) / 0.45) * 0.45
  return 0.60 + ((p - 0.75) / 0.25) * 0.40
}

function winLevel(win, bet, thresholds) {
  const r = win / bet
  if (r >= thresholds.super) return 'super'
  if (r >= thresholds.epic)  return 'epic'
  if (r >= thresholds.mega)  return 'mega'
  if (r >= thresholds.big)   return 'big'
  return null
}

function jokerImgKey(mult) {
  return Math.min(Math.max(Math.round(mult), 1), 10)
}

// Reels 0-2 have 3+ of-a-kind → anticipation
function checkPartialWin(grid) {
  for (let li = 0; li < PAYLINES.length; li++) {
    const syms = [0,1,2].map(r => grid[r][PAYLINES[li][r]])
    const key  = syms.find(s => !SYMS[s]?.isWild && !SYMS[s]?.isScatter)
    if (!key) continue
    let cnt = 0
    for (const s of syms) { if (s === key || SYMS[s]?.isWild) cnt++; else break }
    if (cnt >= 3) return true
  }
  return false
}

// Reels 0-3 have 4+ of-a-kind but reel 4 doesn't match → near-miss
function checkNearMiss(grid) {
  for (let li = 0; li < PAYLINES.length; li++) {
    const syms03 = [0,1,2,3].map(r => grid[r][PAYLINES[li][r]])
    const key    = syms03.find(s => !SYMS[s]?.isWild && !SYMS[s]?.isScatter)
    if (!key) continue
    let cnt = 0
    for (const s of syms03) { if (s === key || SYMS[s]?.isWild) cnt++; else break }
    if (cnt >= 4) {
      const sym4 = grid[4][PAYLINES[li][4]]
      if (sym4 !== key && !SYMS[sym4]?.isWild)
        return { li, key, row: PAYLINES[li][4] }
    }
  }
  return null
}

// Reels 0-3 have 4+ of-a-kind (win will extend to reel 4)
function checkFirst4(grid) {
  for (let li = 0; li < PAYLINES.length; li++) {
    const syms = [0,1,2,3].map(r => grid[r][PAYLINES[li][r]])
    const key  = syms.find(s => !SYMS[s]?.isWild && !SYMS[s]?.isScatter)
    if (!key) continue
    let cnt = 0
    for (const s of syms) { if (s === key || SYMS[s]?.isWild) cnt++; else break }
    if (cnt >= 4) return true
  }
  return false
}

// Cells on reels 0-2 that form a 3-of-a-kind (to highlight during anticipation)
function calcPartialCells(grid) {
  const seen = new Set()
  const cells = []
  for (let li = 0; li < PAYLINES.length; li++) {
    const syms = [0,1,2].map(r => grid[r][PAYLINES[li][r]])
    const key  = syms.find(s => !SYMS[s]?.isWild && !SYMS[s]?.isScatter)
    if (!key) continue
    let cnt = 0
    for (const s of syms) { if (s === key || SYMS[s]?.isWild) cnt++; else break }
    if (cnt >= 3) {
      for (let r = 0; r < 3; r++) {
        const row = PAYLINES[li][r]
        const k = `${r},${row}`
        if (!seen.has(k)) { seen.add(k); cells.push({ reel: r, row }) }
      }
    }
  }
  return cells
}


export default function ThunderJokerPage({ auth, onLogout }) {
  const [grid,           setGrid]           = useState(genGrid)
  const [reelSpin,       setReelSpin]       = useState([0,0,0,0,0])
  const [spinning,       setSpinning]       = useState(false)
  const [balance,        setBalance]        = useState(() => auth?.user?.balance ?? 10000)
  const [displayBalance, setDisplayBalance] = useState(() => auth?.user?.balance ?? 10000)
  const [betOptions,      setBetOptions]      = useState(() => buildBetOptions(DEFAULT_MIN, DEFAULT_MAX))
  const [bet,             setBet]             = useState(DEFAULT_MIN)
  const [winThresholds,   setWinThresholds]   = useState({ big: 2, mega: 10, epic: 50, super: 200 })
  const winThresholdsRef = useRef({ big: 2, mega: 10, epic: 50, super: 200 })
  const [lastWin,      setLastWin]      = useState(0)
  const [displayWin,   setDisplayWin]   = useState(0)
  const [winHits,      setWinHits]      = useState([])
  const [linePhase,    setLinePhase]    = useState(null)  // null | 0..N-1 | 'all'
  const [winOverlay,   setWinOverlay]   = useState(null)
  const [freeSpins,    setFreeSpins]    = useState(0)
  const [inFreeSpins,  setInFreeSpins]  = useState(false)
  const [scene,        setScene]        = useState('base')
  const [isAuto,       setIsAuto]       = useState(false)
  const [isBgmMuted,   setIsBgmMuted]   = useState(false)
  const [lightning,    setLightning]    = useState(null)
  const [jokerMult,    setJokerMult]    = useState(1)
  const [jokerFlash,   setJokerFlash]   = useState(null)
  const [fsSessionWin, setFsSessionWin] = useState(0)
  const [fsEndPhase,     setFsEndPhase]     = useState(null)
  const [fsCountDisplay, setFsCountDisplay] = useState(0)
  const [fsWinBadge,     setFsWinBadge]     = useState(null)
  const [fsFlash,        setFsFlash]        = useState(false)
  const [anticipateCells, setAnticipateCells] = useState(null)
  const [lightningFly, setLightningFly] = useState(null)  // { fromX, fromY, dx, dy, mult }
  const [winPhase,          setWinPhase]          = useState(null)
  const [screenShake,       setScreenShake]        = useState(false)
  const [overlayDisplayWin, setOverlayDisplayWin] = useState(0)
  const [overlayCanDismiss, setOverlayCanDismiss] = useState(false)
  const [showPaytable,      setShowPaytable]      = useState(false)
  const [showInfo,          setShowInfo]          = useState(false)
  const [autoCount,         setAutoCount]         = useState(null)   // null = ∞
  const [showAutoMenu,      setShowAutoMenu]      = useState(false)
  const [showLeaveConfirm,  setShowLeaveConfirm]  = useState(false)
  const [showBrokeModal,    setShowBrokeModal]    = useState(false)

  const [showSuspendModal, setShowSuspendModal] = useState(false)

  useEffect(() => {
    if (!auth?.token) onLogout()
  }, [auth?.token])

  useEffect(() => {
    if (auth?.user?.suspended_at) setShowSuspendModal(true)
  }, [auth?.user?.suspended_at])

  const lockRef      = useRef(false)
  const betRef       = useRef(DEFAULT_MIN)
  const balRef       = useRef(auth?.user?.balance ?? 10000)
  const initServerBalRef = useRef(null)
  const fsRef        = useRef(0)
  const inFsRef      = useRef(false)
  const autoRef      = useRef(false)
  const jokerMultRef    = useRef(1)
  const fsSessionWinRef = useRef(0)
  const spinRef      = useRef(null)
  const ivRefs       = useRef([])
  const tmRefs       = useRef([])
  const lineIvRef    = useRef(null)
  const winRafRef    = useRef(null)
  const resultRef    = useRef(null)   // holds spin result from API or local
  const spinGenRef    = useRef(0)      // incremented each spin to guard stale callbacks
  const overlayRafRef = useRef(null)
  const overlayCtRef  = useRef(null)   // ref to the overlay auto-close timer
  const overlayLockRef = useRef(null)  // ref to the 2-second dismiss-lock timer
  const burstIntervalRef = useRef(null) // recurring coin burst during big win hold
  const winPhaseTimers = useRef([])    // t1-t4 of the cinematic win sequence
  const autoCountRef  = useRef(null)
  const longPressRef  = useRef(null)
  const coinLayerRef      = useRef(null)
  const lightningLayerRef = useRef(null)
  const floatLayerRef   = useRef(null)
  const fsRafRef        = useRef(null)
  const balAnimRafRef   = useRef(null)
  const pageRef         = useRef(null)
  const reelsRef     = useRef(null)
  const multBarRef   = useRef(null)

  const { play: splay, stop: sstop, startLoop, stopLoop, fadeOutLoop, playNearMiss } = useSlotSounds(isBgmMuted)
  const sndRef = useRef({})
  sndRef.current = { play: splay, stop: sstop, startLoop, stopLoop, fadeOutLoop, playNearMiss }

  useEffect(() => { betRef.current = bet },           [bet])
  useEffect(() => { autoRef.current = isAuto },       [isAuto])
  useEffect(() => { fsRef.current = freeSpins },      [freeSpins])
  useEffect(() => { inFsRef.current = inFreeSpins },  [inFreeSpins])

  useEffect(() => {
    if (auth?.user?.balance != null) {
      balRef.current = auth.user.balance
      setBalance(auth.user.balance)
      setDisplayBalance(auth.user.balance)
    }
  }, [auth?.user?.balance])

  // Restore free spin session after page navigation
  const sessionRestoredRef = useRef(false)
  useEffect(() => {
    apiRequest('/slots/config')
      .then(cfg => {
        const opts = buildBetOptions(cfg.min_bet ?? DEFAULT_MIN, cfg.max_bet ?? DEFAULT_MAX)
        setBetOptions(opts)
        setBet(opts[0])
        const t = {
          big:   cfg.win_level_big   ?? 2,
          mega:  cfg.win_level_mega  ?? 10,
          epic:  cfg.win_level_epic  ?? 50,
          super: cfg.win_level_super ?? 200,
        }
        setWinThresholds(t)
        winThresholdsRef.current = t
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (sessionRestoredRef.current) return
    const token = auth?.token
    if (!token) return
    sessionRestoredRef.current = true
    apiRequest('/slots/session', { headers: { Authorization: `Bearer ${token}` } })
      .then(data => {
        if (data.freeSpinsLeft > 0) {
          const fs = data.freeSpinsLeft
          const jm = Math.min(data.jokerMult ?? 1, 10)
          fsRef.current = fs;         setFreeSpins(fs)
          inFsRef.current = true;     setInFreeSpins(true)
          jokerMultRef.current = jm;  setJokerMult(jm)
          setScene('bonus')
        }
      })
      .catch(() => {})
  }, [auth?.token])


  // BGM: start base music on mount, swap on scene changes
  useEffect(() => {
    sndRef.current.startLoop('bgm-base')
    return () => { sndRef.current.stopLoop('bgm-base'); sndRef.current.stopLoop('bgm-bonus') }
  }, [])
  useEffect(() => {
    if (scene === 'transition') {
      sndRef.current.play('scene-transition')
      sndRef.current.fadeOutLoop('bgm-base', 600)
    } else if (scene === 'bonus') {
      sndRef.current.stopLoop('bgm-base')
      sndRef.current.startLoop('bgm-bonus')
    } else if (scene === 'base') {
      sndRef.current.fadeOutLoop('bgm-bonus', 600)
      sndRef.current.startLoop('bgm-base')
    }
  }, [scene])

  // Win counter count-up animation
  useEffect(() => {
    if (winRafRef.current) cancelAnimationFrame(winRafRef.current)
    if (lastWin <= 0) { setDisplayWin(0); return }
    const target   = lastWin
    const duration = Math.min(1600, 400 + target * 0.04)
    const start    = performance.now()
    sndRef.current.startLoop('shot')
    const step = (now) => {
      const t = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplayWin(Math.round(eased * target))
      if (t < 1) winRafRef.current = requestAnimationFrame(step)
      else { setDisplayWin(target); sndRef.current.stopLoop('shot') }
    }
    winRafRef.current = requestAnimationFrame(step)
    return () => {
      if (winRafRef.current) cancelAnimationFrame(winRafRef.current)
      sndRef.current.stopLoop('shot')
    }
  }, [lastWin])

  // Sequential payline reveal: draw each line left-to-right, then all together
  useEffect(() => {
    if (lineIvRef.current) { clearTimeout(lineIvRef.current); lineIvRef.current = null }
    if (winHits.length === 0) { setLinePhase(null); return }
    setLinePhase(0)
    if (winHits.length === 1) return  // single line: draw once, no loop
    // Multi-line: 0 → 1 → … → N-1 → 'all' → 0 → loop
    let idx = 0
    function advance() {
      idx = (idx + 1) % (winHits.length + 1)
      const next = idx === winHits.length ? 'all' : idx
      setLinePhase(next)
      lineIvRef.current = setTimeout(advance, next === 'all' ? 800 : 650)
    }
    lineIvRef.current = setTimeout(advance, 650)
    return () => { if (lineIvRef.current) { clearTimeout(lineIvRef.current); lineIvRef.current = null } }
  }, [winHits])

  const clearAll = useCallback(() => {
    ivRefs.current.forEach(clearInterval); ivRefs.current = []
    tmRefs.current.forEach(clearTimeout);  tmRefs.current = []
    if (lineIvRef.current) { clearTimeout(lineIvRef.current); lineIvRef.current = null }
    if (winRafRef.current) { cancelAnimationFrame(winRafRef.current); winRafRef.current = null }
    if (overlayRafRef.current) { cancelAnimationFrame(overlayRafRef.current); overlayRafRef.current = null }
    if (fsRafRef.current) { cancelAnimationFrame(fsRafRef.current); fsRafRef.current = null }
    if (balAnimRafRef.current) { cancelAnimationFrame(balAnimRafRef.current); balAnimRafRef.current = null }
    overlayCtRef.current = null
  }, [])

  useEffect(() => () => clearAll(), [clearAll])

  useEffect(() => {
    if (winPhase === 'badge') {
      clearTimeout(overlayLockRef.current)
      overlayLockRef.current = setTimeout(() => setOverlayCanDismiss(true), 2000)
    } else {
      clearTimeout(overlayLockRef.current)
      setOverlayCanDismiss(false)
    }
    return () => clearTimeout(overlayLockRef.current)
  }, [winPhase])

  const startFsEndSequence = useCallback((totalWon) => {
    const snd = sndRef.current
    coinLayerRef.current?.stopRain()
    setFsEndPhase('appear')
    setFsCountDisplay(0)
    setFsWinBadge(null)
    setFsFlash(false)
    coinLayerRef.current?.startRain()

    const t1 = setTimeout(() => {
      setFsEndPhase('frame')
      snd.play('scene-transition')
    }, 800)
    tmRefs.current.push(t1)

    const t2 = setTimeout(() => {
      setFsEndPhase('count')
      snd.startLoop('shot')
      const start = performance.now()
      const dur   = Math.min(4000, 2000 + Math.floor(totalWon * 0.002))
      const step  = (now) => {
        const p     = Math.min((now - start) / dur, 1)
        const eased = fsCountEase(p)
        setFsCountDisplay(Math.round(eased * totalWon))
        if (p >= 0.78 && p < 0.82) setScreenShake(true)
        else if (p >= 0.82)        setScreenShake(false)
        if (p < 1) {
          fsRafRef.current = requestAnimationFrame(step)
        } else {
          fsRafRef.current = null
          setFsCountDisplay(totalWon)
          snd.stopLoop('shot')
          setFsFlash(true)
          setScreenShake(true)
          const lv = winLevel(totalWon, betRef.current, winThresholdsRef.current)
          if (lv) { setFsWinBadge(lv); snd.play(lv + '-win') }
          const tb = setTimeout(() => { setFsFlash(false); setScreenShake(false) }, 500)
          tmRefs.current.push(tb)

          // Multi-wave fireworks — position, count, timing all randomised
          const pg = pageRef.current
          const pw = pg?.offsetWidth  ?? 390
          const ph = pg?.offsetHeight ?? 700
          const fwCfg = {
            super: { waves: [6, 9], minC: 55, maxC: 90 },
            epic:  { waves: [4, 7], minC: 40, maxC: 70 },
            mega:  { waves: [3, 5], minC: 28, maxC: 52 },
            big:   { waves: [2, 4], minC: 18, maxC: 38 },
          }[lv] ?? { waves: [1, 2], minC: 10, maxC: 20 }
          const numWaves = fwCfg.waves[0] + Math.floor(Math.random() * (fwCfg.waves[1] - fwCfg.waves[0] + 1))
          let elapsed = 0
          for (let i = 0; i < numWaves; i++) {
            const delay = i === 0 ? 0 : elapsed + 120 + Math.floor(Math.random() * 220)
            elapsed = delay
            const x = pw * (0.15 + Math.random() * 0.70)
            const y = ph * (0.25 + Math.random() * 0.45)
            const c = fwCfg.minC + Math.floor(Math.random() * (fwCfg.maxC - fwCfg.minC + 1))
            const fw = setTimeout(() => {
              coinLayerRef.current?.burst(x, y, c)
              snd.play('coin-burst')
            }, delay)
            tmRefs.current.push(fw)
          }

          const th = setTimeout(() => setFsEndPhase('hold'), 800)
          tmRefs.current.push(th)

          const te = setTimeout(() => setFsEndPhase('exit'), 800 + 2500)
          tmRefs.current.push(te)

          const tc = setTimeout(() => {
            setFsEndPhase(null); setFsCountDisplay(0); setFsWinBadge(null)
            coinLayerRef.current?.clear()
            inFsRef.current = false; setInFreeSpins(false)
            jokerMultRef.current = 1; setJokerMult(1)
            fsSessionWinRef.current = 0; setFsSessionWin(0)
            setScene('base')
            if (autoRef.current) {
              if (balRef.current >= betRef.current) {
                const at = setTimeout(() => spinRef.current?.(), 800)
                tmRefs.current.push(at)
              } else {
                autoRef.current = false; setIsAuto(false)
                autoCountRef.current = null; setAutoCount(null)
              }
            }
          }, 800 + 2500 + 800)
          tmRefs.current.push(tc)
        }
      }
      fsRafRef.current = requestAnimationFrame(step)
    }, 800 + 600)
    tmRefs.current.push(t2)
  }, [])  // all deps are stable refs / setters

  const doSpin = useCallback(() => {
    if (lockRef.current) return
    const isFree = inFsRef.current
    const curBet = betRef.current
    if (!isFree && balRef.current < curBet) {
      autoRef.current = false; setIsAuto(false); return
    }

    lockRef.current = true
    const snd = sndRef.current
    if (balAnimRafRef.current) { cancelAnimationFrame(balAnimRafRef.current); balAnimRafRef.current = null }
    // Cancel any in-flight win phase timers from the previous spin
    winPhaseTimers.current.forEach(clearTimeout); winPhaseTimers.current = []
    // Cut any lingering one-shot sounds from the previous spin
    snd.stop('win-small'); snd.stop('payline-draw'); snd.stop('coin-burst'); snd.stop('reel-stop')
    snd.play('spin-click')
    snd.startLoop('reel-spin')
    const myGen = ++spinGenRef.current
    if (overlayCtRef.current) { clearTimeout(overlayCtRef.current); overlayCtRef.current = null }
    if (overlayRafRef.current) { cancelAnimationFrame(overlayRafRef.current); overlayRafRef.current = null }
    if (burstIntervalRef.current) { clearInterval(burstIntervalRef.current); burstIntervalRef.current = null }
    lightningLayerRef.current?.stopFlashing()
    lightningLayerRef.current?.clear()

    function tickAuto() {
      if (!autoRef.current) return false
      if (autoCountRef.current === null) return true   // infinite
      const n = autoCountRef.current - 1
      if (n <= 0) {
        autoRef.current = false; setIsAuto(false)
        autoCountRef.current = null; setAutoCount(null)
        return false
      }
      autoCountRef.current = n; setAutoCount(n)
      return true
    }
    resultRef.current = null   // clear previous result
    setSpinning(true)
    setLastWin(0)
    setDisplayWin(0)
    setWinHits([])
    setLinePhase(null)
    setWinOverlay(null)
    setWinPhase(null)
    setScreenShake(false)
    setOverlayDisplayWin(0)
    setLightning(null)
    setAnticipateCells(null)

    if (!isFree) {
      balRef.current -= curBet
      setBalance(balRef.current)
      setDisplayBalance(balRef.current)
    }

    // Fire API request (authenticated) or compute locally (guest / fallback)
    const token = auth?.token
    apiRequest('/slots/spin', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ bet: curBet }),
    }).then(result => {
      resultRef.current = result
    }).catch(() => {
      // API failed: stop all reels, unlock spin, restore balance
      ivRefs.current.forEach(clearInterval); ivRefs.current = []
      tmRefs.current.forEach(clearTimeout);  tmRefs.current = []
      snd.stopLoop('reel-spin')
      if (!isFree) { balRef.current += curBet; setBalance(balRef.current) }
      setReelSpin([0,0,0,0,0])
      setSpinning(false)
      lockRef.current = false
    })

    // Poll until result is ready (API usually returns in <500ms, reels stop at 1000ms+)
    function waitForResult(cb) {
      if (resultRef.current) { cb(); return }
      const t = setTimeout(() => waitForResult(cb), 50)
      tmRefs.current.push(t)
    }

    const ivs = [null, null, null, null, null]
    for (let r = 0; r < 5; r++) {
      setReelSpin(prev => { const n = [...prev]; n[r] = 1; return n })
      ivs[r] = setInterval(() => {
        setGrid(prev => { const n = prev.map(c => [...c]); n[r] = genCol(); return n })
      }, 70)
      ivRefs.current.push(ivs[r])
    }

    function stopReelVisual(r) {
      if (!resultRef.current) {
        // API not back yet — keep spinning until result arrives, then stop
        waitForResult(() => stopReelVisual(r))
        return
      }
      clearInterval(ivs[r])
      ivRefs.current = ivRefs.current.filter(i => i !== ivs[r])
      setReelSpin(prev => { const n = [...prev]; n[r] = 0; return n })
      setGrid(prev => { const n = prev.map(c => [...c]); n[r] = resultRef.current.grid[r]; return n })
    }

    function slowStop(r, onDone) {
      clearInterval(ivs[r])
      ivRefs.current = ivRefs.current.filter(i => i !== ivs[r])
      let delay = 70; let steps = 0
      function tick() {
        steps++
        if (steps > 6) {
          snd.play('reel-stop')
          setReelSpin(prev => { const n = [...prev]; n[r] = 0; return n })
          setGrid(prev => { const n = prev.map(c => [...c]); n[r] = resultRef.current.grid[r]; return n })
          onDone(); return
        }
        setGrid(prev => { const n = prev.map(c => [...c]); n[r] = genCol(); return n })
        delay = Math.min(delay * 1.4, 400)
        const t = setTimeout(tick, delay); tmRefs.current.push(t)
      }
      tick()
    }

    function finalize() {
      lockRef.current = false
      setSpinning(false)
      setAnticipateCells(null)
      snd.stopLoop('reel-spin')
      snd.stopLoop('anticipate')

      const result = resultRef.current
      const { hits, winTotal, scatters, freeSpinsLeft, freeSpinsGranted,
              jokerMult: newJokerMult, jokerMultGained, jokerImgKey: jimgKey,
              newBalance, lightningCell } = result

      if (lightningCell && winTotal > 0) {
        snd.play('lightning-appear')
        setLightning(lightningCell)
        // Fly animation: badge visible first, then animate to multiplier bar
        const flyT = setTimeout(() => {
          try {
            const pg = pageRef.current?.getBoundingClientRect()
            const rl = reelsRef.current?.getBoundingClientRect()
            const mb = multBarRef.current?.getBoundingClientRect()
            if (!pg || !rl || !mb) return
            const hw = 20  // half of 40px element
            const fromX = rl.left - pg.left + REEL_PAD + lightningCell.reel * (CELL_PX + CELL_GAP) + CELL_PX / 2 - hw
            const fromY = rl.top  - pg.top  + REEL_PAD + lightningCell.row  * (CELL_PX + CELL_GAP) + CELL_PX / 2 - hw
            const toX   = mb.left - pg.left + mb.width  / 2 - hw
            const toY   = mb.top  - pg.top  + mb.height / 2 - hw
            setLightningFly({ fromX, fromY, dx: toX - fromX, dy: toY - fromY, mult: lightningCell.mult })
            snd.play('lightning-fly')
            const clearFly = setTimeout(() => setLightningFly(null), 750)
            tmRefs.current.push(clearFly)
          } catch (_) {}
        }, 380)
        tmRefs.current.push(flyT)
      }

      const displayBal = newBalance
      const prevDisplayBal = balRef.current
      balRef.current = displayBal
      setBalance(displayBal)
      if (winTotal > 0 && displayBal > prevDisplayBal) {
        const from = prevDisplayBal
        const to   = displayBal
        const dur  = Math.min(1600, 400 + winTotal * 0.04)
        const start = performance.now()
        if (balAnimRafRef.current) cancelAnimationFrame(balAnimRafRef.current)
        const step = (now) => {
          const p = Math.min((now - start) / dur, 1)
          const eased = 1 - Math.pow(1 - p, 3)
          setDisplayBalance(Math.round(from + eased * (to - from)))
          if (p < 1) balAnimRafRef.current = requestAnimationFrame(step)
          else { balAnimRafRef.current = null; setDisplayBalance(to) }
        }
        balAnimRafRef.current = requestAnimationFrame(step)
      } else {
        setDisplayBalance(displayBal)
      }

      // Joker flash (free spins only)
      if (jokerMultGained > 0 && jimgKey) {
        jokerMultRef.current = newJokerMult
        setJokerMult(newJokerMult)
        setJokerFlash(jimgKey)
        snd.play('joker-flash')
        const pg = pageRef.current
        coinLayerRef.current?.burst(
          (pg?.offsetWidth  ?? 390) / 2,
          (pg?.offsetHeight ?? 700) * 0.42,
          40,
        )
        coinLayerRef.current?.rainBurst(18)
        const jt = setTimeout(() => setJokerFlash(null), 2000)
        tmRefs.current.push(jt)
      }

      let bigWinLv = null
      if (winTotal > 0) {
        setLastWin(winTotal)
        setWinHits(hits)                // paylines draw immediately
        bigWinLv = winLevel(winTotal, curBet, winThresholdsRef.current)
        // During free spins, all per-spin wins play win-small; fsEndSequence handles the total reveal
        if (!bigWinLv || isFree) {
          snd.play('win-small')
        }
        // Staggered payline draw sounds
        hits.forEach((_, i) => {
          const pt = setTimeout(() => snd.play('payline-draw'), i * 200)
          tmRefs.current.push(pt)
        })
        if (bigWinLv && !freeSpinsGranted && !isFree) {
          // Cinematic phased win sequence
          const holdDur = bigWinLv === 'super' ? 3200 : bigWinLv === 'epic' ? 2400 : 1800

          // Phase 1: dark screen
          const t1 = setTimeout(() => {
            if (spinGenRef.current !== myGen) return
            setWinOverlay(bigWinLv)
            setWinPhase('dark')
            setOverlayDisplayWin(0)
          }, 150)
          winPhaseTimers.current.push(t1)

          // Phase 2: coin rain + slow counter
          const t2 = setTimeout(() => {
            if (spinGenRef.current !== myGen) return
            setWinPhase('rain')
            const rainIntensity = bigWinLv === 'super' ? 'storm' : bigWinLv === 'epic' ? 'heavy' : 'normal'
            coinLayerRef.current?.startRain(rainIntensity)
            if (bigWinLv === 'super') lightningLayerRef.current?.startFlashing(2, 750, '#88EEFF')
            else if (bigWinLv === 'epic') lightningLayerRef.current?.startFlashing(1, 1100, '#88EEFF')
            snd.startLoop('shot')
            const t0 = performance.now()
            const dur = 2000
            const step = (now) => {
              const p = Math.min((now - t0) / dur, 1)
              setOverlayDisplayWin(Math.round(p * p * winTotal))
              if (p < 1) overlayRafRef.current = requestAnimationFrame(step)
              else overlayRafRef.current = null
            }
            overlayRafRef.current = requestAnimationFrame(step)
          }, 400)
          winPhaseTimers.current.push(t2)

          // Phase 3: badge slam + win sound
          const t3 = setTimeout(() => {
            if (spinGenRef.current !== myGen) return
            if (overlayRafRef.current) { cancelAnimationFrame(overlayRafRef.current); overlayRafRef.current = null }
            snd.stopLoop('shot')
            setOverlayDisplayWin(winTotal)
            setWinPhase('badge')
            snd.play(bigWinLv + '-win')
            // Dramatic lightning burst on badge slam
            const boltCount = { super: 6, epic: 4, mega: 3, big: 1 }[bigWinLv] ?? 1
            lightningLayerRef.current?.flash(boltCount, '#88EEFF')
          }, 2500)
          winPhaseTimers.current.push(t3)

          // Phase 4: coin burst + screen shake + recurring burst (tiered)
          const t4 = setTimeout(() => {
            if (spinGenRef.current !== myGen) return
            setWinPhase('burst')
            setScreenShake(true)
            setTimeout(() => setScreenShake(false), 600)
            snd.play('coin-burst')
            coinLayerRef.current?.stopRain()
            lightningLayerRef.current?.stopFlashing()

            const pg = pageRef.current
            const pw = pg?.offsetWidth  ?? 390
            const ph = pg?.offsetHeight ?? 700
            const cx = pw / 2
            const cy = ph * 0.38

            const BURST_CFG = {
              super: { count: 80, intervalMs: 400, boltsPer: 3 },
              epic:  { count: 60, intervalMs: 520, boltsPer: 2 },
              mega:  { count: 40, intervalMs: 700, boltsPer: 1 },
              big:   { count: 24, intervalMs: 950, boltsPer: 0 },
            }[bigWinLv]
            const BURST_ORIGIN = { x: cx, y: cy }

            // Initial burst from center
            coinLayerRef.current?.burst(BURST_ORIGIN.x, BURST_ORIGIN.y, BURST_CFG.count)
            if (BURST_CFG.boltsPer > 0) {
              lightningLayerRef.current?.flash(BURST_CFG.boltsPer, '#88EEFF')
            }

            if (burstIntervalRef.current) clearInterval(burstIntervalRef.current)
            burstIntervalRef.current = setInterval(() => {
              if (spinGenRef.current !== myGen) {
                clearInterval(burstIntervalRef.current); burstIntervalRef.current = null; return
              }
              const bc = Math.round(BURST_CFG.count * (0.5 + Math.random() * 0.4))
              coinLayerRef.current?.burst(BURST_ORIGIN.x, BURST_ORIGIN.y, bc)
              if (BURST_CFG.boltsPer > 0) {
                lightningLayerRef.current?.flash(
                  Math.ceil(BURST_CFG.boltsPer * (0.5 + Math.random() * 0.5)),
                  '#88EEFF',
                )
              }
            }, BURST_CFG.intervalMs)
          }, 2800)
          winPhaseTimers.current.push(t4)

          // Phase 5: hold → exit animation → clear
          overlayCtRef.current = setTimeout(() => {
            if (spinGenRef.current !== myGen) return
            if (burstIntervalRef.current) { clearInterval(burstIntervalRef.current); burstIntervalRef.current = null }
            lightningLayerRef.current?.stopFlashing()

            // Final coin burst + optional lightning on exit
            const p5  = pageRef.current
            const p5x = (p5?.offsetWidth  ?? 390) / 2
            const p5y = (p5?.offsetHeight ?? 700) * 0.38
            const exitCount = { super: 55, epic: 40, mega: 28, big: 16 }[bigWinLv] ?? 16
            coinLayerRef.current?.burst(p5x, p5y, exitCount)
            if (bigWinLv !== 'big') {
              lightningLayerRef.current?.flash(bigWinLv === 'super' ? 4 : bigWinLv === 'epic' ? 3 : 1, '#88EEFF')
            }

            // Switch to exit phase — CSS handles scale-up + fade-out of badge & amount
            setWinPhase('exit')

            const exitT = setTimeout(() => {
              if (spinGenRef.current !== myGen) return
              lightningLayerRef.current?.clear()
              coinLayerRef.current?.clear()
              setWinPhase(null)
              setWinOverlay(null)
              overlayCtRef.current = null
              if (inFsRef.current && fsRef.current > 0) {
                const at = setTimeout(() => spinRef.current?.(), 500)
                tmRefs.current.push(at)
              } else if (inFsRef.current && fsRef.current === 0) {
                startFsEndSequence(fsSessionWinRef.current)
              } else if (autoRef.current && !inFsRef.current) {
                if (balRef.current >= betRef.current) {
                  if (tickAuto()) { const at = setTimeout(() => spinRef.current?.(), 500); tmRefs.current.push(at) }
                } else { autoRef.current = false; setIsAuto(false); autoCountRef.current = null; setAutoCount(null) }
              }
            }, 550)
            tmRefs.current.push(exitT)
          }, 2800 + holdDur)
          tmRefs.current.push(overlayCtRef.current)
        }
      }

      if (isFree) {
        fsSessionWinRef.current += winTotal
        setFsSessionWin(fsSessionWinRef.current)
        // Per-spin: float text + small coin burst
        if (winTotal > 0) {
          coinLayerRef.current?.rainBurst(10)
          const layer = floatLayerRef.current
          if (layer) {
            const el = document.createElement('div')
            el.className = 'tj-float-win'
            el.textContent = `+${winTotal.toLocaleString()}`
            el.style.left = `${50 + (Math.random() * 30 - 15)}%`
            el.style.top  = '55%'
            layer.appendChild(el)
            const removeEl = setTimeout(() => el.remove(), 700)
            tmRefs.current.push(removeEl)
          }
        }
        fsRef.current = freeSpinsLeft; setFreeSpins(freeSpinsLeft)
        if (freeSpinsGranted > 0) {
          // Retrigger: scatter during free spins → extra rounds
          snd.play('free-spins-trigger')
          setWinOverlay('freespins')
          const rft = setTimeout(() => {
            setWinOverlay(null)
            const delay = bigWinLv ? 2000 : 400
            const gt = setTimeout(() => spinRef.current?.(), delay)
            tmRefs.current.push(gt)
          }, 2000)
          tmRefs.current.push(rft)
        } else if (freeSpinsLeft <= 0) {
          startFsEndSequence(fsSessionWinRef.current)
        } else {
          // Big wins get a longer pause so paylines stay visible before next spin
          const nt = setTimeout(() => spinRef.current?.(), bigWinLv ? 2500 : 1000)
          tmRefs.current.push(nt)
        }
      } else if (freeSpinsGranted > 0) {
        snd.play('free-spins-trigger')
        setWinOverlay('freespins')
        jokerMultRef.current = 1; setJokerMult(1)
        fsSessionWinRef.current = 0; setFsSessionWin(0)
        const fst = setTimeout(() => {
          setWinOverlay(null)
          fsRef.current = freeSpinsLeft; setFreeSpins(freeSpinsLeft)
          inFsRef.current = true; setInFreeSpins(true)
          setScene('transition')
          const bt = setTimeout(() => {
            setScene('bonus')
            const gt = setTimeout(() => spinRef.current?.(), 600); tmRefs.current.push(gt)
          }, 900); tmRefs.current.push(bt)
        }, 2500); tmRefs.current.push(fst)
      } else if (autoRef.current && !bigWinLv) {
        if (balRef.current >= betRef.current) {
          // Small win: pause long enough for paylines to be visible; no win: proceed quickly
          const autoDelay = winTotal > 0 ? 1800 : 700
          if (tickAuto()) { const at = setTimeout(() => spinRef.current?.(), autoDelay); tmRefs.current.push(at) }
        } else { autoRef.current = false; setIsAuto(false); autoCountRef.current = null; setAutoCount(null) }
      }
    }

    // After reel 3 stops: near-miss check or final reel stop
    function onReel3Stopped() {
      waitForResult(() => {
        const finalGrid = resultRef.current.grid
        const nm   = checkNearMiss(finalGrid)
        const has4 = !nm && checkFirst4(finalGrid)

        if (nm || has4) {
          // Slow-stop reel 4 for dramatic effect — actual result, no symbol swap
          const delay = nm ? REEL_STAGGER + 100 : 280
          const ta = setTimeout(() => {
            if (nm) snd.playNearMiss()
            slowStop(4, () => {
              const fd = setTimeout(() => finalize(), 180); tmRefs.current.push(fd)
            })
          }, delay)
          tmRefs.current.push(ta)
        } else {
          const t4 = setTimeout(() => {
            snd.play('reel-stop'); stopReelVisual(4)
            const fd = setTimeout(() => finalize(), 180); tmRefs.current.push(fd)
          }, REEL_STAGGER + 350)
          tmRefs.current.push(t4)
        }
      })
    }

    // After reel 2 stops: check for 3+ and decide reel 3 speed
    function onReel2Stopped() {
      waitForResult(() => {
        const finalGrid = resultRef.current.grid
        if (checkPartialWin(finalGrid)) {
          snd.startLoop('anticipate')
          setAnticipateCells(calcPartialCells(finalGrid))
          const ta = setTimeout(() => slowStop(3, onReel3Stopped), 200)
          tmRefs.current.push(ta)
        } else {
          const t3 = setTimeout(() => { snd.play('reel-stop'); stopReelVisual(3); onReel3Stopped() }, REEL_STAGGER)
          tmRefs.current.push(t3)
        }
      })
    }

    // Schedule stops for reels 0, 1, 2: sound fires 60ms before visual
    for (let r = 0; r < 3; r++) {
      const ri = r
      const stopAt = SPIN_BASE + ri * REEL_STAGGER
      const ts = setTimeout(() => snd.play('reel-stop'), stopAt - 60)
      tmRefs.current.push(ts)
      const t = setTimeout(() => {
        stopReelVisual(ri)
        if (ri === 2) onReel2Stopped()
      }, stopAt)
      tmRefs.current.push(t)
    }
  }, [auth?.token])  // re-create if token changes

  useEffect(() => { spinRef.current = doSpin }, [doSpin])

  const handleSpin = () => {
    if (spinning) return
    if (!inFreeSpins && balance < bet) return
    doSpin()
  }

  const handleAuto = () => {
    if (inFreeSpins) return
    if (isAuto) {
      autoRef.current = false; setIsAuto(false)
      autoCountRef.current = null; setAutoCount(null)
    } else if (autoCount !== null) {
      // Paused by big win — resume with remaining count
      autoRef.current = true; setIsAuto(true)
      if (!spinning && balRef.current >= betRef.current) doSpin()
    } else {
      setShowAutoMenu(v => !v)
    }
  }

  const startAuto = (count) => {
    setShowAutoMenu(false)
    autoCountRef.current = count
    setAutoCount(count)
    autoRef.current = true; setIsAuto(true)
    if (!spinning && balRef.current >= betRef.current) doSpin()
  }

  const handleSpinPointerDown = (e) => {
    if (!canSpin) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    longPressRef.current = setTimeout(() => {
      longPressRef.current = null
      setShowAutoMenu(true)
    }, 400)
  }

  const handleSpinPointerUp = () => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current)
      longPressRef.current = null
      if (!spinning) doSpin()
    }
  }

  const handleSpinPointerLeave = () => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current)
      longPressRef.current = null
    }
  }

  const handleBetDown = () => {
    if (spinning) return
    const i = betOptions.indexOf(bet); if (i > 0) setBet(betOptions[i - 1])
  }
  const handleBetUp = () => {
    if (spinning) return
    const i = betOptions.indexOf(bet); if (i < betOptions.length - 1) setBet(betOptions[i + 1])
  }

  const bgSrc = scene === 'bonus'     ? '/slot-imgs/Scene/feature_bonus.png'
    : scene === 'transition'          ? '/slot-imgs/Scene/transition.png'
    : '/slot-imgs/Scene/basegame.png'

  const canSpin = !spinning && (inFreeSpins || balance >= bet)

  useEffect(() => {
    if (!spinning && !inFreeSpins && balance < betOptions[0])
      setShowBrokeModal(true)
  }, [balance, spinning, inFreeSpins])

  const displayMult = lightning?.mult ?? 1
  const isWinning   = winHits.length > 0

  // Check if a specific cell should be highlighted based on the current linePhase
  function getCellWin(r, row, sym) {
    if (!isWinning || linePhase === null) return false
    const hitsToCheck = linePhase === 'all' ? winHits
      : (typeof linePhase === 'number' && winHits[linePhase] ? [winHits[linePhase]] : [])
    for (const hit of hitsToCheck) {
      if (r < hit.cnt && PAYLINES[hit.li][r] === row && (hit.key === sym || SYMS[sym]?.isWild))
        return true
    }
    return false
  }

  function devTriggerWin(level) {
    const winTotal = { big: 500, mega: 2000, epic: 8000, super: 30000 }[level] ?? 500
    const myGen    = ++spinGenRef.current
    const snd      = sndRef.current
    setLastWin(winTotal)
    setTimeout(() => { if (spinGenRef.current !== myGen) return; setWinOverlay(level); setWinPhase('dark'); setOverlayDisplayWin(0) }, 150)
    setTimeout(() => {
      if (spinGenRef.current !== myGen) return
      setWinPhase('rain'); coinLayerRef.current?.startRain(); snd.startLoop('shot')
      const t0 = performance.now()
      const step = (now) => {
        const p = Math.min((now - t0) / 2000, 1)
        setOverlayDisplayWin(Math.round(p * p * winTotal))
        if (p < 1) overlayRafRef.current = requestAnimationFrame(step)
      }
      overlayRafRef.current = requestAnimationFrame(step)
    }, 400)
    setTimeout(() => {
      if (spinGenRef.current !== myGen) return
      if (overlayRafRef.current) { cancelAnimationFrame(overlayRafRef.current); overlayRafRef.current = null }
      snd.stopLoop('shot'); setOverlayDisplayWin(winTotal); setWinPhase('badge'); snd.play(level + '-win')
    }, 2500)
    setTimeout(() => {
      if (spinGenRef.current !== myGen) return
      setWinPhase('burst'); setScreenShake(true); setTimeout(() => setScreenShake(false), 500)
      snd.play('coin-burst'); coinLayerRef.current?.stopRain()
      const pg = pageRef.current
      coinLayerRef.current?.burst(
        (pg?.offsetWidth ?? 390) / 2,
        (pg?.offsetHeight ?? 700) * 0.38,
        level === 'super' ? 65 : level === 'epic' ? 45 : 28,
      )
    }, 2800)
    const devHoldDur = level === 'super' ? 7000 : level === 'epic' ? 5500 : 4000
    setTimeout(() => {
      if (spinGenRef.current !== myGen) return
      coinLayerRef.current?.clear(); setWinPhase(null); setWinOverlay(null)
    }, 2800 + devHoldDur)
  }

  return (
    <div className={`tj-page${screenShake ? ' is-shake' : ''}`} ref={pageRef}>
      <img className="tj-bg" src={bgSrc} alt="" key={scene} />


      {showSuspendModal && (
        <div className="auth-modal-backdrop" role="presentation" onClick={() => { setShowSuspendModal(false); onLogout() }}>
          <div
            className="auth-modal enter-game-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="auth-modal-kicker" style={{ color: '#ff4d4f' }}>帳號停權</p>
            <h3>您已被停權</h3>
            <p>如有疑問，請聯繫客服。</p>
            <div className="auth-modal-actions" style={{ gridTemplateColumns: '1fr' }}>
              <button type="button" className="auth-modal-button" onClick={() => { setShowSuspendModal(false); onLogout() }}>
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DEV: win sequence test buttons */}
      {false && (
        <div style={{ position: 'absolute', top: 4, left: '50%', transform: 'translateX(-50%)', zIndex: 999, display: 'flex', gap: 4 }}>
          {['big','mega','epic','super'].map(lv => (
            <button key={lv} onClick={() => devTriggerWin(lv)}
              style={{ fontSize: 10, padding: '2px 6px', background: '#222', color: '#ffd700', border: '1px solid #555', borderRadius: 4, cursor: 'pointer' }}>
              {lv}
            </button>
          ))}
          <button
            onClick={() => {
              sndRef.current.play('free-spins-trigger')
              setWinOverlay('freespins')
              const t = setTimeout(() => setWinOverlay(null), 2500)
              tmRefs.current.push(t)
            }}
            style={{ fontSize: 10, padding: '2px 6px', background: '#222', color: '#88eeff', border: '1px solid #555', borderRadius: 4, cursor: 'pointer' }}
          >
            free
          </button>
          <button
            onClick={() => {
              // Enter fake free spins mode to test joker badge + flash
              const cur = jokerMultRef.current <= 1 ? 1 : jokerMultRef.current
              if (cur <= 1) {
                setFreeSpins(8); setInFreeSpins(true); inFsRef.current = true
                setScene('bonus')
                jokerMultRef.current = 1; setJokerMult(1)
              }
              const inc = JOKER_MULTS[Math.floor(Math.random() * JOKER_MULTS.length)]
              const next = Math.min(jokerMultRef.current + inc, 10)
              jokerMultRef.current = next; setJokerMult(next)
              setJokerFlash(jokerImgKey(inc))
              sndRef.current.play('joker-flash')
              const pg = pageRef.current
              coinLayerRef.current?.burst(
                (pg?.offsetWidth  ?? 390) / 2,
                (pg?.offsetHeight ?? 700) * 0.42,
                40,
              )
              coinLayerRef.current?.rainBurst(18)
              const jt = setTimeout(() => setJokerFlash(null), 2000)
              tmRefs.current.push(jt)
            }}
            style={{ fontSize: 10, padding: '2px 6px', background: '#222', color: '#ff88ff', border: '1px solid #555', borderRadius: 4, cursor: 'pointer' }}
          >
            joker+
          </button>
          <button
            onClick={() => {
              if (inFsRef.current) return
              jokerMultRef.current = 1; setJokerMult(1)
              fsSessionWinRef.current = 0; setFsSessionWin(0)
              fsRef.current = 3; setFreeSpins(3)
              inFsRef.current = true; setInFreeSpins(true)
              setScene('bonus')
              const gt = setTimeout(() => spinRef.current?.(), 500)
              tmRefs.current.push(gt)
            }}
            style={{ fontSize: 10, padding: '2px 6px', background: '#222', color: '#44ffaa', border: '1px solid #555', borderRadius: 4, cursor: 'pointer' }}
          >
            FS入
          </button>
          {[
            { label: 'FS-B', color: '#ffaa44', mult: 2 },
            { label: 'FS-M', color: '#44ffcc', mult: 7 },
            { label: 'FS-E', color: '#ff88ff', mult: 20 },
            { label: 'FS-S', color: '#ffdd44', mult: 60 },
          ].map(({ label, color, mult }) => (
            <button
              key={label}
              onClick={() => {
                const win = betRef.current * mult
                fsSessionWinRef.current = win; setFsSessionWin(win)
                if (inFsRef.current) { fsRef.current = 0; setFreeSpins(0) }
                startFsEndSequence(win)
              }}
              style={{ fontSize: 10, padding: '2px 6px', background: '#222', color, border: '1px solid #555', borderRadius: 4, cursor: 'pointer' }}
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => {
              tmRefs.current.forEach(clearTimeout); tmRefs.current = []
              if (fsRafRef.current) { cancelAnimationFrame(fsRafRef.current); fsRafRef.current = null }
              setFreeSpins(0); setInFreeSpins(false); inFsRef.current = false
              setScene('base'); jokerMultRef.current = 1; setJokerMult(1); setJokerFlash(null)
              fsSessionWinRef.current = 0; setFsSessionWin(0)
              setFsEndPhase(null); setFsCountDisplay(0); setFsWinBadge(null); setFsFlash(false)
              coinLayerRef.current?.clear()
            }}
            style={{ fontSize: 10, padding: '2px 6px', background: '#333', color: '#aaa', border: '1px solid #555', borderRadius: 4, cursor: 'pointer' }}
          >
            reset
          </button>
        </div>
      )}

      {/* Header */}
      <header className="tj-header">
        <img src="/arrow.png" alt="返回" className="tj-back" onClick={() => setShowLeaveConfirm(true)} />
        <span className="tj-title"><img src="/slot-imgs/title.png" alt="返回" /></span>
        <div className="tj-header-right">
          {inFreeSpins && (
            <div className="tj-fs-badge">
              <img src="/slot-imgs/free-spins.png" alt="" />
              <span>{freeSpins} 次</span>
            </div>
          )}
          {inFreeSpins && jokerMult > 1 && (
            <div className="tj-joker-badge">
              <img src={`/slot-imgs/jokerx${jokerImgKey(jokerMult)}.png`} alt="" />
              <span>×{jokerMult}</span>
            </div>
          )}
          {inFreeSpins && fsSessionWin > 0 && (
            <div className="tj-fs-win-badge">
              <span>+{fsSessionWin.toLocaleString()}</span>
            </div>
          )}
          <button type="button" className="tj-mute-btn" onClick={() => setIsBgmMuted(m => !m)}>
            <img src={isBgmMuted ? '/slot-imgs/mute.png' : '/slot-imgs/unmute.png'} alt="" />
          </button>
        </div>
      </header>

      {/* Reel grid */}
      <div className="tj-reels-wrap">
        <div className={`tj-reels${isWinning ? ' is-win' : ''}`} ref={reelsRef}>
          {grid.map((col, r) => (
            <div key={r} className={`tj-reel${reelSpin[r] ? ' is-spinning' : ''}`}>
              {col.map((sym, row) => {
                const isWin         = getCellWin(r, row, sym)
                const isDim         = isWinning && linePhase !== null && !isWin && !reelSpin[r]
                const isAnticipate  = spinning && !isWin && !reelSpin[r] && anticipateCells?.some(c => c.reel === r && c.row === row)
                const cls    = `tj-cell${isWin ? ' is-win' : isDim ? ' is-dim' : isAnticipate ? ' is-anticipate' : ''}`
                return (
                  <div key={row} className={cls}>
                    <img src={SYMS[sym]?.src} alt={sym} />
                    {lightning?.reel === r && lightning?.row === row && (
                      <img
                        className="tj-lightning-badge"
                        src={`/slot-imgs/lightningx${lightning.mult}.png`}
                        alt={`×${lightning.mult}`}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          ))}

          {/* Payline win lines — one line drawn L→R at a time, then all together */}
          {winHits.length > 0 && linePhase !== null && (
            <svg className="tj-payline-svg" viewBox={`0 0 ${SVG_DIM} ${SVG_DIM}`} xmlns="http://www.w3.org/2000/svg">
              <defs>
                <filter id="tj-glow" x="-10" y="-10" width={SVG_DIM + 20} height={SVG_DIM + 20} filterUnits="userSpaceOnUse">
                  <feGaussianBlur in="SourceGraphic" stdDeviation="3.5" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>
              {linePhase === 'all'
                ? winHits.map(({ li, cnt }) => {
                    const pts = PAYLINES[li].slice(0, cnt).map((row, reel) => cellCenter(reel, row))
                    return (
                      <path
                        key={li}
                        className="tj-payline-all"
                        d={polyToPath(pts)}
                        stroke={PAYLINE_COLORS[li]}
                        strokeWidth="1.8"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        filter="url(#tj-glow)"
                      />
                    )
                  })
                : (() => {
                    const hit = winHits[linePhase]
                    if (!hit) return null
                    const pts = PAYLINES[hit.li].slice(0, hit.cnt).map((row, reel) => cellCenter(reel, row))
                    const pLen = calcPathLength(pts)
                    return (
                      <path
                        key={`${hit.li}-${linePhase}`}
                        className="tj-payline-draw"
                        d={polyToPath(pts)}
                        stroke={PAYLINE_COLORS[hit.li]}
                        strokeWidth="2.5"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ strokeDasharray: pLen, strokeDashoffset: pLen }}
                        filter="url(#tj-glow)"
                      />
                    )
                  })()
              }
            </svg>
          )}

          {/* Decorative joker frame overlay */}
          <img className="tj-frame" src="/slot-imgs/joker_frame.png" alt="" aria-hidden="true" />
        </div>

        {/* Payline indicator dots (20) */}
        <div className="tj-pl-dots">
          {PAYLINES.map((_, li) => {
            const isWin = winHits.some(h => h.li === li)
            const isActiveDot = linePhase === 'all'
              ? isWin
              : (typeof linePhase === 'number' && winHits[linePhase]?.li === li)
            return (
              <div
                key={li}
                className={`tj-pl-dot${isWin ? ' is-win' : ''}`}
                style={isActiveDot ? { background: PAYLINE_COLORS[li], boxShadow: `0 0 7px ${PAYLINE_COLORS[li]}` } : {}}
              />
            )
          })}
        </div>
      </div>

      {/* Bottom panel */}
      <div className="tj-bottom">
        {/* Multiplier bar */}
        <div className={`tj-mult-bar${displayMult > 1 ? ' is-active' : ''}`} ref={multBarRef}>
          <span className="tj-mult-label"><img src="/slot-imgs/multiplier.png" alt="" /></span>
          <img
            className="tj-mult-val"
            src={`/slot-imgs/lightningx${[2,3].includes(displayMult) ? displayMult : 1}.png`}
            alt={`×${displayMult}`}
          />
        </div>
        <div className="tj-stats">
          <div className="tj-stat">
            <img className="tj-stat-bg" src="/slot-imgs/balance.png" alt="" aria-hidden="true" />
            <span className="tj-stat-val">{displayBalance.toLocaleString()}</span>
          </div>
          <div className="tj-stat">
            <img className="tj-stat-bg" src="/slot-imgs/bet.png" alt="" aria-hidden="true" />
            <div className="tj-bet-ctrl">
              {/* <img className="tj-bet-ctrl-bg" src="/slot-imgs/betting-amount.png" alt="" aria-hidden="true" /> */}
              <button type="button" onClick={handleBetDown} disabled={spinning}></button>
              <span className="tj-stat-val">{bet.toLocaleString()}</span>
              <button type="button" onClick={handleBetUp} disabled={spinning}></button>
            </div>
          </div>
          <div className="tj-stat">
            <img className="tj-stat-bg" src="/slot-imgs/total_win.png" alt="" aria-hidden="true" />
            <span className={`tj-stat-val${lastWin > 0 ? ' is-win' : ''}`}>
              {displayWin.toLocaleString()}
            </span>
          </div>
        </div>

        <div className="tj-controls">
          <button type="button" className="tj-ctrl-btn" onClick={() => setShowInfo(true)}>
            <img src="/slot-imgs/info.png" alt="info" />
          </button>
          <button
            type="button"
            className={`tj-ctrl-btn${isAuto ? ' is-active' : ''}`}
            onClick={handleAuto}
            disabled={inFreeSpins}
            style={{ position: 'relative' }}
          >
            <img src={isAuto ? '/slot-imgs/auto_on.png' : '/slot-imgs/auto_off.png'} alt="auto" />
            {autoCount !== null && (
              <span className={`tj-auto-badge${!isAuto ? ' is-paused' : ''}`}>{autoCount}</span>
            )}
          </button>
          <button
            type="button"
            className={`tj-spin-btn${!canSpin ? ' is-off' : ''}`}
            onPointerDown={handleSpinPointerDown}
            onPointerUp={handleSpinPointerUp}
            onPointerLeave={handleSpinPointerLeave}
            onPointerCancel={handleSpinPointerLeave}
          >
            <img src="/slot-imgs/spin.png" alt="spin" />
          </button>
          <button
            type="button"
            className="tj-ctrl-btn"
            onClick={() => { if (!spinning) setBet(betOptions[betOptions.length - 1]) }}
            disabled={spinning}
          >
            <img src="/slot-imgs/max.png" alt="max" />
          </button>
          <button type="button" className="tj-ctrl-btn" onClick={() => setShowPaytable(true)}>
            <img src="/slot-imgs/list.png" alt="paytable" />
          </button>
        </div>
      </div>

      {/* Win / Free Spins overlay */}
      {winOverlay && (
        <div
          className={`tj-overlay-win${winPhase ? ` phase-${winPhase}` : ''}${winOverlay && winOverlay !== 'freespins' ? ` lv-${winOverlay}` : ''}`}
          onClick={() => {
            if (winOverlay === 'freespins') return
            if (!overlayCanDismiss) return
            if (overlayCtRef.current) { clearTimeout(overlayCtRef.current); overlayCtRef.current = null }
            if (overlayRafRef.current) { cancelAnimationFrame(overlayRafRef.current); overlayRafRef.current = null }
            if (burstIntervalRef.current) { clearInterval(burstIntervalRef.current); burstIntervalRef.current = null }
            winPhaseTimers.current.forEach(clearTimeout); winPhaseTimers.current = []
            sndRef.current.stopLoop('shot')
            lightningLayerRef.current?.stopFlashing()
            lightningLayerRef.current?.clear()
            coinLayerRef.current?.clear()
            setWinPhase(null)
            setScreenShake(false)
            setWinOverlay(null)
            if (inFsRef.current && fsRef.current > 0) {
              const at = setTimeout(() => spinRef.current?.(), 300)
              tmRefs.current.push(at)
            } else if (inFsRef.current && fsRef.current === 0) {
              startFsEndSequence(fsSessionWinRef.current)
            } else if (autoRef.current && !inFsRef.current) {
              if (balRef.current >= betRef.current) {
                const cnt = autoCountRef.current
                if (cnt === null || cnt > 1) {
                  if (cnt !== null) { autoCountRef.current = cnt - 1; setAutoCount(cnt - 1) }
                  const at = setTimeout(() => spinRef.current?.(), 300); tmRefs.current.push(at)
                } else { autoRef.current = false; setIsAuto(false); autoCountRef.current = null; setAutoCount(null) }
              } else { autoRef.current = false; setIsAuto(false); autoCountRef.current = null; setAutoCount(null) }
            }
          }}
        >
          {winOverlay === 'freespins' ? (
            <img src="/slot-imgs/free-spins.png" alt="FREE SPINS" className="tj-overlay-freespins" />
          ) : (
            <>
              {(winPhase === 'badge' || winPhase === 'burst') && (
                <img className="tj-overlay-badge" src={`/slot-imgs/${winOverlay}-win.png`} alt={winOverlay} />
              )}
              {(winPhase === 'rain' || winPhase === 'badge' || winPhase === 'burst') && (
                <div className="tj-overlay-amt-wrap">
                  <img src={`/slot-imgs/${winOverlay}-win-bonus.png`} className="tj-overlay-amt-bg" alt="" aria-hidden="true" />
                  <div className="tj-overlay-amt">{overlayDisplayWin.toLocaleString()}</div>
                </div>
              )}
              {overlayCanDismiss && (
                <div className="tj-overlay-tap-hint">點擊繼續</div>
              )}
            </>
          )}
        </div>
      )}

      {/* Atlas-based coin animation layer — always mounted, coins rendered imperatively */}
      <CoinLayer ref={coinLayerRef} />

      {/* Lightning canvas layer — above coins, pointer-events:none */}
      <LightningLayer ref={lightningLayerRef} />

      {/* Float text layer for per-spin win popups */}
      <div ref={floatLayerRef} className="tj-float-layer" aria-hidden="true" />

      {/* Free spins end cinematic overlay */}
      {fsEndPhase && (
        <div className={`tj-fs-end-overlay${fsFlash ? ' is-flash' : ''}`}>
          <div className={`tj-fs-end-backdrop${fsEndPhase === 'exit' ? ' is-exit' : ''}`} />
          {fsEndPhase !== 'appear' && (
            <div className={`tj-fs-end-frame-wrap${fsEndPhase === 'exit' ? ' is-exit' : ''}`}>
              {fsWinBadge && (
                <img
                  className="tj-fs-end-win-badge"
                  src={`/slot-imgs/${fsWinBadge}-win.png`}
                  alt={fsWinBadge}
                />
              )}
              <div className="tj-overlay-amt-wrap">
                <img
                  src={`/slot-imgs/${fsWinBadge ? `${fsWinBadge}-win-bonus` : 'free-spins-bonus'}.png`}
                  className="tj-overlay-amt-bg"
                  alt=""
                  aria-hidden="true"
                />
                <div className="tj-overlay-amt">{fsCountDisplay.toLocaleString()}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 集鴻運: Joker multiplier flash */}
      {jokerFlash && (
        <div className="tj-joker-flash">
          <img src={`/slot-imgs/jokerx${jokerFlash}.png`} alt={`×${jokerFlash}`} />
        </div>
      )}

      {/* Auto spin count picker */}
      {showAutoMenu && (
        <div className="tj-auto-menu-wrap">
          <button className="tj-auto-menu-backdrop" onClick={() => setShowAutoMenu(false)} aria-label="取消" />
          <div className="tj-auto-menu">
            <img className="tj-auto-menu-bg" src="/slot-imgs/auto_bg.png" alt="" aria-hidden="true" />
            {[
              [10,   'auto10'],
              [20,   'auto20'],
              [30,   'auto30'],
              [50,   'auto50'],
              [100,  'auto100'],
              [null, 'auto_unlimited'],
            ].map(([count, img]) => (
              <button
                key={count ?? 'inf'}
                className="tj-auto-chip"
                onClick={() => startAuto(count)}
              >
                <img src={`/slot-imgs/${img}.png`} alt={count ?? '∞'} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Paytable panel */}
      {showPaytable && (
        <div className="tj-panel-overlay">
          <button className="tj-panel-backdrop" onClick={() => setShowPaytable(false)} aria-label="關閉" />
          <div className="tj-panel">
            <button className="tj-panel-close" onClick={() => setShowPaytable(false)}>✕</button>
            <img className="tj-panel-frame" src="/slot-imgs/Outer_frame.png" alt="" aria-hidden="true" />
            <div className="tj-panel-content">
              <div className="tj-panel-header">
                <span className="tj-panel-title">賠率表</span>
              </div>
              <div className="tj-pt-col-hdr">
                <span style={{width:32}} />
                <span className="tj-pt-name" />
                <div className="tj-pt-vals">
                  <span>×3</span><span>×4</span><span>×5</span>
                </div>
              </div>
              <div className="tj-paytable">
                <div className="tj-pt-row">
                  <img src={SYMS.wild.src} alt="Wild" />
                  <div className="tj-pt-vals">
                    <span>{SYMS.wild.v[2]}</span>
                    <span>{SYMS.wild.v[3]}</span>
                    <span>{SYMS.wild.v[4]}</span>
                  </div>
                  <span className="tj-pt-wild-tag">替代</span>
                </div>
                {[
                  ['joker','Joker'],['bell','Bell'],
                  ['clownhat-red','Red Hat'],['clownhat-purple','Purple Hat'],['clownhat-blue','Blue Hat'],
                  ['clownhat-golden','Golden Hat'],['A','A'],['K','K'],['Q','Q'],['J','J'],['10','10'],
                ].map(([key, label]) => (
                  <div key={key} className="tj-pt-row">
                    <img src={SYMS[key].src} alt={label} />
                    <div className="tj-pt-vals">
                      <span>{SYMS[key].v[2]}</span>
                      <span>{SYMS[key].v[3]}</span>
                      <span>{SYMS[key].v[4]}</span>
                    </div>
                  </div>
                ))}
                <div className="tj-pt-row tj-pt-scatter-row">
                  <img src={SYMS.scatter.src} alt="scatter" />
                  {/* <span className="tj-pt-name">Scatter</span> */}
                  <span className="tj-pt-scatter-text">3/4/5 張 → 8/12/15 次 Free Spins</span>
                </div>
              </div>
              <div className="tj-pt-note">押注 × 賠率倍數 = 贏得籌碼</div>
            </div>
          </div>
        </div>
      )}

      {/* Info / Rules panel */}
      {showInfo && (
        <div className="tj-panel-overlay">
          <button className="tj-panel-backdrop" onClick={() => setShowInfo(false)} aria-label="關閉" />
          <div className="tj-panel">
            <button className="tj-panel-close" onClick={() => setShowInfo(false)}>✕</button>
            <img className="tj-panel-frame" src="/slot-imgs/Outer_frame.png" alt="" aria-hidden="true" />
            <div className="tj-panel-content">
              <div className="tj-panel-header">
                <span className="tj-panel-title">遊戲說明</span>
              </div>
              <div className="tj-info-list">
                <div className="tj-info-row">
                  <img src={SYMS.wild.src} alt="wild" />
                  <div>
                    <strong>Wild（萬能牌）</strong>
                    <p>可替代所有符號（除 Scatter 外），協助完成連線賠付</p>
                  </div>
                </div>
                <div className="tj-info-row">
                  <img src={SYMS.joker.src} alt="joker" />
                  <div>
                    <strong>Joker（乘倍累積）</strong>
                    <p>每出現一張累積乘倍器（最高×10）；Free Spins 期間套用全局賠付（不與閃電疊加）</p>
                  </div>
                </div>
                <div className="tj-info-row">
                  <img src={SYMS.scatter.src} alt="scatter" />
                  <div>
                    <strong>Scatter（免費旋轉）</strong>
                    <p>任意位置出現 3 張以上觸發 Free Spins：3張=6次，4張=9次，5張=12次</p>
                  </div>
                </div>
                <div className="tj-info-row">
                  <img src="/slot-imgs/free-spins.png" alt="free spins" />
                  <div>
                    <strong>Free Spins</strong>
                    <p>免費旋轉不扣押注，贏分乘上加成倍率（×2～×10），Joker 乘倍器持續累積</p>
                  </div>
                </div>
                <div className="tj-info-row">
                  <img src="/slot-imgs/lightningx2.png" alt="lightning" />
                  <div>
                    <strong>閃電乘倍</strong>
                    <p>每局隨機一格出現閃電加成（×2/×3/×5/×10）；中獎時套用至本局總贏分</p>
                  </div>
                </div>
                <div className="tj-info-row">
                  <img src="/slot-imgs/blue-lightning.png" alt="multiplier" />
                  <div>
                    <strong>基礎乘倍器</strong>
                    <p>一般旋轉隨機出現 ×2/×3/×5；Free Spins 期間可達 ×10</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Leave confirm */}
      {showLeaveConfirm && (
        <LeaveConfirmModal
          body={inFreeSpins ? 'Free Spins 進行中，離開後本局進度將會遺失。' : '確定要離開 Thunder Joker？'}
          onCancel={() => setShowLeaveConfirm(false)}
          onConfirm={() => {
            clearAll()
            onLogout()
          }}
        />
      )}

      {/* Broke modal */}
      {showBrokeModal && (
        <div className="pt-modal-overlay">
          <div className="pt-modal">
            <p className="pt-modal-title">籌碼已用完</p>
            <p className="pt-modal-body">本次帶入的籌碼已全部用完，無法繼續遊戲。</p>
            <div className="pt-modal-btns" style={{ gridTemplateColumns: '1fr' }}>
              <button type="button" className="pt-modal-confirm" onClick={() => {
                clearAll()
                onLogout()
              }}>返回大廳</button>
            </div>
          </div>
        </div>
      )}

      {/* Lightning fly-to-multiplier animation */}
      {lightningFly && (
        <div
          className="tj-lightning-fly"
          style={{
            left: `${lightningFly.fromX}px`,
            top:  `${lightningFly.fromY}px`,
            '--dx': `${lightningFly.dx}px`,
            '--dy': `${lightningFly.dy}px`,
          }}
        >
          <img src={`/slot-imgs/lightningx${lightningFly.mult}.png`} alt="" />
        </div>
      )}
    </div>
  )
}
