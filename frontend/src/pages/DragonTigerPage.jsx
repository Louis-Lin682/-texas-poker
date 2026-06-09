import { useEffect, useRef, useState, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useDragonTigerSocket } from '../hooks/useDragonTigerSocket'
import { useAudio, getAudioSettings } from '../hooks/useAudio'
import { API_BASE_URL } from '../services/apiClient'

// Pre-load SFX at module import time for reliable playback
function _mkAudio(src) { const a = new Audio(src); a.preload = 'auto'; a.load(); return a }
function _mkImg(src)   { const i = new Image(); i.src = src; return i }
const _dragonWinImg = _mkImg('/DragonTiger/win/dragon_win.png')
const _tigerWalkImg = _mkImg('/DragonTiger/win/tiger_walk.png')
const _stamp1  = _mkAudio('/audio/DragonTiger/stamp.mp3')
const _winSfx  = _mkAudio('/audio/DragonTiger/win.mp3')
const _loseSfx = _mkAudio('/audio/DragonTiger/lose.mp3')
const _dingding = _mkAudio('/audio/DragonTiger/dingding.mp3')
const _chipSrc = _mkAudio('/audio/game/poker-chips.mp3')
const _dealSfx      = _mkAudio('/audio/game/fly_card.mp3')
const _flip1        = _mkAudio('/audio/game/flip_card.mp3')
const _flip2        = _mkAudio('/audio/game/flip_card.mp3')
const _dragonWinSfx = _mkAudio('/audio/DragonTiger/dragonWin.mp3')
const _tigerWinSfx  = _mkAudio('/audio/DragonTiger/tigerWin.mp3')

const CHIPS = [
  { value: 20,   img: '/chip-red.png',       label: '20' },
  { value: 50,   img: '/chip-blue.png',      label: '50' },
  { value: 100,  img: '/chip-green.png',     label: '100' },
  { value: 500,  img: '/chip-purple.png',    label: '500' },
  { value: 1000, img: '/chip-blackgold.png', label: '1K' },
]

const ZONE_KEYS = [
  'dragon', 'tie', 'tiger',
  'dragon_big', 'dragon_small', 'dragon_odd', 'dragon_even',
  'dragon_spade', 'dragon_heart', 'dragon_club', 'dragon_diamond',
  'tiger_big', 'tiger_small', 'tiger_odd', 'tiger_even',
  'tiger_spade', 'tiger_heart', 'tiger_club', 'tiger_diamond',
]

const BET_LABELS = {
  dragon: '龍', tiger: '虎', tie: '和',
  dragon_big: '龍大', dragon_small: '龍小', dragon_odd: '龍單', dragon_even: '龍雙',
  dragon_spade: '龍♠', dragon_heart: '龍♥', dragon_club: '龍♣', dragon_diamond: '龍♦',
  tiger_big: '虎大', tiger_small: '虎小', tiger_odd: '虎單', tiger_even: '虎雙',
  tiger_spade: '虎♠', tiger_heart: '虎♥', tiger_club: '虎♣', tiger_diamond: '虎♦',
}

// Absolute positions within .dt-zones-area (covers top:29%–bottom:17% of table)
// Tune these percentages to align with the background image zones
const ZONE_DEFS = {
  dragon:        { left: '4%',     top: '0%',   width: '31%',   height: '58%' },
  tie:           { left: '39%',    top: '0%',   width: '21%',   height: '100%' },
  tiger:         { left: '65%',    top: '0%',   width: '31%',   height: '58%' },
  dragon_big:    { left: '4%',     top: '60%',  width: '17.5%', height: '13%' },
  dragon_small:  { left: '21.5%',  top: '60%',  width: '17.5%', height: '13%' },
  dragon_odd:    { left: '4%',     top: '73%',  width: '17.5%', height: '12%' },
  dragon_even:   { left: '21.5%',  top: '73%',  width: '17.5%', height: '12%' },
  dragon_spade:  { left: '5%',     top: '86%',  width: '7.75%', height: '18%' },
  dragon_heart:  { left: '12.75%',  top: '86%',  width: '7.75%', height: '18%' },
  dragon_club:   { left: '22%',  top: '86%',  width: '7.75%', height: '18%' },
  dragon_diamond:{ left: '30.25%', top: '86%',  width: '7.75%', height: '18%' },
  tiger_big:     { left: '61%',    top: '59%',  width: '15.5%', height: '13%' },
  tiger_small:   { left: '78.5%',  top: '59%',  width: '15.5%', height: '13%' },
  tiger_odd:     { left: '61%',    top: '72%',  width: '15.5%', height: '13%' },
  tiger_even:    { left: '79.5%',  top: '72%',  width: '15.5%', height: '13%' },
  tiger_spade:   { left: '61%',    top: '87%',  width: '7.75%', height: '16%' },
  tiger_heart:   { left: '69.5%', top: '87%',  width: '7.75%', height: '16%' },
  tiger_club:    { left: '78.5%',  top: '87%',  width: '7.75%', height: '16%' },
  tiger_diamond: { left: '87.25%', top: '87%',  width: '7.75%', height: '16%' },
}

const SUIT_RED   = new Set(['♥', '♦'])
const MAX_VISIBLE = 5

function fmt(n) {
  return new Intl.NumberFormat('en-US').format(n ?? 0)
}

function emptyPlacements() {
  return Object.fromEntries(ZONE_KEYS.map(z => [z, []]))
}

function isSuitZone(zone) {
  return zone.endsWith('_spade') || zone.endsWith('_heart') ||
    zone.endsWith('_club')  || zone.endsWith('_diamond')
}

// ── Floating draggable chip tray ───────────────────────────
function DraggableChipTray({ selectedChip, onSelectChip, visible }) {
  const trayRef    = useRef(null)
  const isDragging = useRef(false)
  const wasDragged = useRef(false) // suppresses chip onClick after a drag gesture
  const origin     = useRef({ px: 0, py: 0, ex: 0, ey: 0 })
  const [pos, setPos] = useState(null) // null = CSS default (bottom-right)

  function onPointerDown(e) {
    const el = trayRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    isDragging.current = false
    wasDragged.current = false
    origin.current = { px: e.clientX, py: e.clientY, ex: rect.left, ey: rect.top }
    el.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e) {
    const dx = e.clientX - origin.current.px
    const dy = e.clientY - origin.current.py
    // Start drag only after moving > 6px
    if (!isDragging.current && Math.sqrt(dx * dx + dy * dy) > 6) {
      isDragging.current = true
      wasDragged.current = true
    }
    if (!isDragging.current || !trayRef.current) return
    const { width, height } = trayRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(window.innerWidth  - width,  origin.current.ex + dx))
    const y = Math.max(0, Math.min(window.innerHeight - height, origin.current.ey + dy))
    setPos({ x, y })
    e.preventDefault()
  }

  function onPointerUp() { isDragging.current = false }

  if (!visible) return null
  return (
    <div
      ref={trayRef}
      className={`dt-chip-float${pos ? ' is-placed' : ''}`}
      style={pos ? { left: pos.x, top: pos.y } : {}}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      data-no-global-click="true"
    >
      <div className="dt-chip-tray">
        {CHIPS.map(chip => (
          <button
            key={chip.value}
            type="button"
            className={`dt-chip-btn ${selectedChip.value === chip.value ? 'is-selected' : ''}`}
            onClick={() => { if (wasDragged.current) return; onSelectChip(chip) }}
            data-no-global-click="true"
          >
            <img src={chip.img} alt={chip.label} className="dt-chip-img" />
            <span className={`dt-chip-label ${selectedChip.value === chip.value ? 'is-selected' : ''}`}>
              {chip.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Bead road (珠盤路) ─────────────────────────────────────
const BEAD_ROWS = 6
const RED_SUITS = new Set(['♥', '♦'])

function BeadRoad({ history, onLoadMore, hasMore }) {
  const scrollRef   = useRef(null)
  const prevWidth   = useRef(0)

  const prevLen = useRef(0)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const delta = history.length - prevLen.current
    if (delta === 1 || prevLen.current === 0) {
      // Single live round added, or initial load — scroll to show newest (rightmost)
      el.scrollLeft = el.scrollWidth
    } else if (delta > 1 && el.scrollWidth > prevWidth.current) {
      // Bulk DB load — older rounds appeared on the left, keep viewport steady
      el.scrollLeft += el.scrollWidth - prevWidth.current
    }
    prevLen.current   = history.length
    prevWidth.current = el.scrollWidth
  }, [history.length])

  function onScroll(e) {
    if (e.currentTarget.scrollLeft < 80 && hasMore) onLoadMore?.()
  }

  // history is newest-first; reverse for left(old)→right(new) display
  const items = [...history].reverse()
  const pad = (BEAD_ROWS - (items.length % BEAD_ROWS)) % BEAD_ROWS

  return (
    <div className="dt-bead-road-wrap">
      <span className="dt-bead-road-label">珠盤路</span>
      <div className="dt-bead-road-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="dt-bead-road-grid">
          {items.map((r, i) => {
            const card = r.result === 'tiger' ? r.tigerCard : r.dragonCard
            const suit = card?.suit ?? ''
            return (
              <div key={r._key ?? i} className={`dt-bead dt-bead-${r.result}`}>
                <span className="dt-bead-rank">{card?.rank ?? '—'}</span>
                <span className={`dt-bead-suit ${RED_SUITS.has(suit) ? 'is-red' : ''}`}>{suit}</span>
              </div>
            )
          })}
          {Array.from({ length: pad }).map((_, i) => (
            <div key={`pad-${i}`} className="dt-bead dt-bead-empty" />
          ))}
        </div>
      </div>
    </div>
  )
}

function PlayingCard({ card, faceDown, delay = 0 }) {
  const [flipped, setFlipped] = useState(false)

  useEffect(() => {
    if (!faceDown && card) {
      const t = setTimeout(() => setFlipped(true), delay)
      return () => clearTimeout(t)
    } else {
      setFlipped(false)
    }
  }, [faceDown, card, delay])

  const isRed = card ? SUIT_RED.has(card.suit) : false

  return (
    <div className="dt-card-wrap">
      <div className={`dt-card ${flipped ? 'is-flipped' : ''}`}>
        <div className="dt-card-inner">
          <div className="dt-card-back">
            <img src="/texas-holdem/card-blackgold.png" alt="" draggable={false} />
          </div>
          <div className={`dt-card-front ${isRed ? 'is-red' : ''}`}>
            {card && (
              <>
                <span className="dt-card-rank-top">{card.rank}</span>
                <span className="dt-card-suit-mid">{card.suit}</span>
                <span className="dt-card-rank-bot">{card.rank}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function rnd(min, max) {
  return min + Math.random() * (max - min)
}

function ZoneBetDisplay({ placements, totalBet, myBet, small }) {
  if (placements.length === 0 && totalBet === 0) return null
  return (
    <>
      {placements.map(p => (
        <img
          key={p.id}
          src={p.img}
          alt=""
          draggable={false}
          className={`dt-placed-chip${small ? ' is-small' : ''}${p.isMe ? ' is-mine' : ''}`}
          style={{
            left:      `${p.x}%`,
            top:       `${p.y}%`,
            transform: `translate(-50%, -50%) rotate(${p.rot}deg)`,
            zIndex:    p.z,
          }}
        />
      ))}
      {totalBet > 0 && (
        <div className="dt-zone-bet-label">
          <span className={`dt-zone-bet-total${small ? ' is-small' : ''}`}>
            {small
              ? (totalBet >= 1000 ? `${Math.floor(totalBet / 1000)}K` : String(totalBet))
              : fmt(totalBet)}
          </span>
          {!small && myBet > 0 && <span className="dt-zone-my-bet">我 {fmt(myBet)}</span>}
        </div>
      )}
    </>
  )
}

function DragonWinAnim({ onDone }) {
  const canvasRef = useRef(null)
  const onDoneRef = useRef(onDone)

  useEffect(() => {
    const { sfxVolume, sfxMuted } = getAudioSettings()
    if (!sfxMuted) { _dragonWinSfx.volume = 0.85 * sfxVolume; _dragonWinSfx.play().catch(() => {}) }

    const img = _dragonWinImg

    const FRAME_W = 1086, FRAME_H = 1448, COLS = 4, TOTAL = 8
    let frame = 0, animId = null, last = 0
    const INTERVAL = 100 // 10 fps

    function tick(now) {
      if (!canvasRef.current) return
      if (now - last >= INTERVAL) {
        last = now
        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d')
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        if (img.complete) {
          const col = frame % COLS
          const row = Math.floor(frame / COLS)
          ctx.drawImage(img, col * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H, 0, 0, canvas.width, canvas.height)
        }
        frame = (frame + 1) % TOTAL
      }
      animId = requestAnimationFrame(tick)
    }
    animId = requestAnimationFrame(tick)

    const t = setTimeout(() => { cancelAnimationFrame(animId); onDoneRef.current?.() }, 4000)
    return () => {
      cancelAnimationFrame(animId)
      clearTimeout(t)
      _dragonWinSfx.pause()
      _dragonWinSfx.currentTime = 0
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="dt-dragon-win-overlay">
      <canvas ref={canvasRef} className="dt-dragon-canvas" width={280} height={374} />
    </div>
  )
}

function TigerWinAnim({ onDone }) {
  const canvasRef = useRef(null)
  const [phase, setPhase] = useState('walk')
  const onDoneRef = useRef(onDone)

  // Phase 1: sprite walk-in (2s)
  useEffect(() => {
    const { sfxVolume, sfxMuted } = getAudioSettings()
    if (!sfxMuted) { _tigerWinSfx.volume = 0.85 * sfxVolume; _tigerWinSfx.play().catch(() => {}) }

    const img = _tigerWalkImg
    const FRAME_W = 1086, FRAME_H = 1448, COLS = 4, TOTAL = 8
    let frame = 0, animId = null, last = 0
    const INTERVAL = 100

    function tick(now) {
      if (!canvasRef.current) return
      if (now - last >= INTERVAL) {
        last = now
        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d')
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        if (img.complete) {
          const col = frame % COLS
          const row = Math.floor(frame / COLS)
          ctx.drawImage(img, col * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H, 0, 0, canvas.width, canvas.height)
        }
        frame = (frame + 1) % TOTAL
      }
      animId = requestAnimationFrame(tick)
    }
    animId = requestAnimationFrame(tick)

    const t = setTimeout(() => { cancelAnimationFrame(animId); setPhase('final') }, 2000)
    return () => {
      cancelAnimationFrame(animId)
      clearTimeout(t)
      _tigerWinSfx.pause()
      _tigerWinSfx.currentTime = 0
    }
  }, [])

  // Phase 2: final image burst (2s) then done
  useEffect(() => {
    if (phase !== 'final') return
    const t = setTimeout(() => onDoneRef.current?.(), 2000)
    return () => clearTimeout(t)
  }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="dt-tiger-win-overlay">
      {phase === 'walk'
        ? <canvas ref={canvasRef} className="dt-tiger-canvas" width={280} height={374} />
        : <img src="/DragonTiger/win/tiger_hand.png" alt="" className="dt-tiger-final" draggable={false} />
      }
    </div>
  )
}

const SUIT_COLOR = { '♥': '#e05050', '♦': '#e05050', '♠': '#e8e0cc', '♣': '#e8e0cc' }
const RESULT_LABEL = { dragon: '龍勝', tiger: '虎勝', tie: '和局' }
const RESULT_COLOR = { dragon: '#5b8cff', tiger: '#ff7c5b', tie: '#c8a84b' }

function HistoryModal({ history, onClose }) {
  return (
    <div className="dt-rules-overlay" onClick={onClose}>
      <div className="dt-history-modal" onClick={e => e.stopPropagation()}>
        <img src="/DragonTiger/Accounting-outline.png" alt="" className="dt-history-bg" draggable={false} />
        <div className="dt-history-inner">
          <button type="button" className="dt-history-close" onClick={onClose}></button>
          {history.length === 0 ? (
            <div className="dt-history-empty">本場尚無記錄</div>
          ) : (
          <div className="dt-history-list">
            {history.map(r => {
              const dc = r.dragonCard
              const tc = r.tigerCard
              return (
                <div key={r._key ?? `${r.roundId}-${r.ts}`} className="dt-history-row">
                  <div className="dt-history-row-top">
                    <span className="dt-history-round">第 {r.roundId} 局</span>
                    <span className="dt-history-result" style={{ color: RESULT_COLOR[r.result] }}>
                      {RESULT_LABEL[r.result]}
                    </span>
                    {r.totalBet > 0 && (
                      <span className={`dt-history-net ${r.net > 0 ? 'is-win' : r.net < 0 ? 'is-lose' : ''}`}>
                        {r.net > 0 ? `+${fmt(r.net)}` : fmt(r.net)}
                      </span>
                    )}
                  </div>
                  <div className="dt-history-cards">
                    <span className="dt-history-card-label">龍</span>
                    <span className="dt-history-card" style={{ color: SUIT_COLOR[dc?.suit] }}>
                      {dc ? `${dc.rank}${dc.suit}` : '—'}
                    </span>
                    <span className="dt-history-card-sep">vs</span>
                    <span className="dt-history-card-label">虎</span>
                    <span className="dt-history-card" style={{ color: SUIT_COLOR[tc?.suit] }}>
                      {tc ? `${tc.rank}${tc.suit}` : '—'}
                    </span>
                  </div>
                  {r.bets?.length > 0 && (
                    <div className="dt-history-bets">
                      {r.bets.map(b => (
                        <span key={b.zone} className="dt-history-bet-tag">
                          {BET_LABELS[b.zone]} {fmt(b.amount)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          )}
        </div>
      </div>
    </div>
  )
}

function RulesModal({ onClose }) {
  return (
    <div className="dt-rules-overlay" onClick={onClose}>
      <div className="dt-rules-scroll" onClick={e => e.stopPropagation()}>
        <img src="/DragonTiger/scrollTop.png.png" alt="" className="dt-scroll-top" draggable={false} />
        <div className="dt-scroll-body">
          <img src="/DragonTiger/scrollBody.png" alt="" className="dt-scroll-body-bg" draggable={false} />
          <div className="dt-scroll-content">
            <h3 className="dt-rules-title">龍虎鬥 遊戲規則</h3>

            <div className="dt-rules-section">
              <div className="dt-rules-section-title">主注賠率</div>
              <div className="dt-rules-row"><span>龍 / 虎</span><span>1 : 1（和局退半注）</span></div>
              <div className="dt-rules-row"><span>和</span><span>1 : 8</span></div>
            </div>

            <div className="dt-rules-section">
              <div className="dt-rules-section-title">大 / 小（副注）</div>
              <div className="dt-rules-row"><span>大（8–K）</span><span>1 : 1</span></div>
              <div className="dt-rules-row"><span>小（A–6）</span><span>1 : 1</span></div>
              <div className="dt-rules-note">7 點＝退注</div>
            </div>

            <div className="dt-rules-section">
              <div className="dt-rules-section-title">單 / 雙（副注）</div>
              <div className="dt-rules-row"><span>單數點</span><span>1 : 1</span></div>
              <div className="dt-rules-row"><span>雙數點</span><span>1 : 1</span></div>
              <div className="dt-rules-note">7 點＝退注</div>
            </div>

            <div className="dt-rules-section">
              <div className="dt-rules-section-title">花色（副注）</div>
              <div className="dt-rules-row"><span>♠ ♥ ♣ ♦ 任一</span><span>1 : 3</span></div>
            </div>

            <div className="dt-rules-section">
              <div className="dt-rules-section-title">下注限制</div>
              <div className="dt-rules-note">・龍與虎不可同時下注</div>
              <div className="dt-rules-note">・同側大與小不可同時下注</div>
              <div className="dt-rules-note">・同側單與雙不可同時下注</div>
              <div className="dt-rules-note">・同側四種花色不可全押</div>
            </div>
          </div>
        </div>
        <img src="/DragonTiger/scrollBottom.png.png" alt="" className="dt-scroll-bottom" draggable={false} />
      </div>
    </div>
  )
}


function ResultOverlay({ result, myPayout, myTotalBet }) {
  useEffect(() => {
    if (!result) return
    const net = myPayout - myTotalBet
    const { sfxVolume, sfxMuted } = getAudioSettings()

    function playStamp(el) {
      if (sfxMuted) return
      el.volume = 0.85 * sfxVolume
      el.currentTime = 0
      el.play().catch(() => {})
    }

    playStamp(_stamp1)
    // Tie: play win/lose quickly; dragon/tiger: delay 2s so animation
    // SFX plays first without overlap
    const delay = result === 'tie' ? 950 : 2000
    const t3 = setTimeout(() => {
      if (myTotalBet > 0) {
        if (net > 0) {
          _winSfx.volume = 0.85 * sfxVolume; _winSfx.currentTime = 0; _winSfx.play().catch(() => {})
        } else if (net < 0) {
          _loseSfx.volume = 0.85 * sfxVolume; _loseSfx.currentTime = 0; _loseSfx.play().catch(() => {})
        }
      }
    }, delay)

    return () => { clearTimeout(t3) }
  }, [result])  // eslint-disable-line react-hooks/exhaustive-deps

  if (!result) return null

  const net    = myPayout - myTotalBet
  const won    = net > 0
  const isTie  = result === 'tie'

  const resultImg  = result === 'dragon' ? '/DragonTiger/game/dragon.png'
    : result === 'tiger'  ? '/DragonTiger/game/tiger.png'
    : '/DragonTiger/game/he.png'
  const outcomeImg = isTie ? '/DragonTiger/game/ju.png' : '/DragonTiger/game/sheng.png'

  let netClass = 'is-tie'
  let netText  = '本局損益：0'
  if (myTotalBet > 0) {
    if (won)        { netClass = 'is-win';  netText = `本局損益：+${fmt(net)}` }
    else if (net < 0) { netClass = 'is-lose'; netText = `本局損益：-${fmt(Math.abs(net))}` }
  }

  return (
    <>
      <div className="dt-result-bg" />
      <div className="dt-result-overlay">
        <div className="dt-result-inner">
          <div className="dt-result-chars">
            <img src={resultImg}  alt={result}  className="dt-result-char dt-char-1" />
            <img src={outcomeImg} alt="outcome" className="dt-result-char dt-char-2" />
          </div>
          {myTotalBet > 0 && (
            <div className={`dt-result-net ${netClass}`}>{netText}</div>
          )}
        </div>
      </div>
    </>
  )
}

export default function DragonTigerPage({ auth }) {
  const navigate  = useNavigate()
  const location  = useLocation()
  const buyIn     = location.state?.buyIn ?? parseInt(localStorage.getItem('cfg_min_buy_in') || '3000', 10)
  const { play, preload } = useAudio()

  const {
    status, rooms, roomsReady, roomId, myId, gameState, error,
    cashoutBalance, refreshRooms, createRoom, joinRoom, leaveRoom,
    placeBet, cancelLastBet, cancelBets,
  } = useDragonTigerSocket({ minBuyIn: buyIn })

  const [selectedChip,    setSelectedChip]    = useState(CHIPS[0])
  const [pendingCancel,   setPendingCancel]   = useState(false)
  const [chipPlacements,  setChipPlacements]  = useState(emptyPlacements)
  const [betActivities,   setBetActivities]   = useState([])
  const [flashingPlayers, setFlashingPlayers] = useState(new Set())
  const [showAllPlayers,  setShowAllPlayers]  = useState(false)
  const [showRules,      setShowRules]      = useState(false)
  const [showHistory,    setShowHistory]    = useState(false)
  const [roundHistory,   setRoundHistory]   = useState([])
  const [hasMoreDb,      setHasMoreDb]      = useState(true)
  const [loadingDb,      setLoadingDb]      = useState(false)
  const dbCountRef = useRef(0)  // tracks how many DB rounds are loaded (for offset)
  const [showDragonWin,  setShowDragonWin]  = useState(false)
  const [showTigerWin,   setShowTigerWin]   = useState(false)
  const [dtBgmMuted,     setDtBgmMuted]     = useState(false)
  const dtBgmRef = useRef(null)

  useEffect(() => {
    if (!location.state) navigate('/', { replace: true })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const joinedRef         = useRef(false)
  const prevPhase         = useRef(null)
  const prevRound         = useRef(null)
  const chipZRef          = useRef(1)
  const dingdingFiredRef  = useRef(false)
  const prevPlayerBetsRef = useRef({})

  useEffect(() => {
    preload(['dt_deal', 'dt_chips', 'dt_flip', 'dt_dingding', 'dt_stamp', 'dt_win', 'dt_lose'])
  }, [preload])

  // Load shared DT history from backend on mount
  useEffect(() => {
    async function init() {
      setLoadingDb(true)
      try {
        const res  = await fetch(`${API_BASE_URL}/dt-history?limit=60`)
        const data = await res.json()
        dbCountRef.current = data.rounds.length
        setHasMoreDb(data.hasMore)
        setRoundHistory(data.rounds.map(r => ({
          _key:       `db-${r.dbId}`,
          result:     r.result,
          dragonCard: { rank: r.dragonRank, suit: r.dragonSuit },
          tigerCard:  { rank: r.tigerRank,  suit: r.tigerSuit  },
        })))
      } catch {}
      setLoadingDb(false)
    }
    init()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadMoreHistory = useCallback(async () => {
    if (loadingDb || !hasMoreDb) return
    setLoadingDb(true)
    try {
      const res  = await fetch(`${API_BASE_URL}/dt-history?limit=60&offset=${dbCountRef.current}`)
      const data = await res.json()
      dbCountRef.current += data.rounds.length
      setHasMoreDb(data.hasMore)
      setRoundHistory(h => [
        ...h,
        ...data.rounds.map(r => ({
          _key:       `db-${r.dbId}`,
          result:     r.result,
          dragonCard: { rank: r.dragonRank, suit: r.dragonSuit },
          tigerCard:  { rank: r.tigerRank,  suit: r.tigerSuit  },
        })),
      ])
    } catch {}
    setLoadingDb(false)
  }, [loadingDb, hasMoreDb])


  // Dragon Tiger BGM — raw Audio element with click fallback
  useEffect(() => {
    const { bgmVolume } = getAudioSettings()
    const audio = new Audio('/audio/DragonTiger/dragon-tiger-bg.mp3')
    audio.loop   = true
    audio.muted  = false
    audio.volume = 0.30 * bgmVolume
    dtBgmRef.current = audio

    const tryPlay = () => {
      if (!dtBgmRef.current || !dtBgmRef.current.paused) return
      dtBgmRef.current.play().catch(() => {})
    }
    tryPlay()
    document.addEventListener('click', tryPlay)

    return () => {
      document.removeEventListener('click', tryPlay)
      audio.pause()
      audio.src = ''
      dtBgmRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!dtBgmRef.current) return
    const { bgmVolume } = getAudioSettings()
    dtBgmRef.current.muted  = dtBgmMuted
    dtBgmRef.current.volume = dtBgmMuted ? 0 : 0.30 * bgmVolume
  }, [dtBgmMuted])

  const toggleDtBgm = () => setDtBgmMuted(m => !m)

  // When room is lost or WS reconnects, re-enable auto-join
  useEffect(() => {
    if (!roomId) joinedRef.current = false
  }, [roomId])
  useEffect(() => {
    if (!roomsReady) joinedRef.current = false
  }, [roomsReady])

  // Auto-join a dragon-tiger room — wait for first room_list before acting
  useEffect(() => {
    if (status !== 'connected' || !roomsReady || joinedRef.current || roomId) return
    const dtRoom = rooms.find(r => r.gameType === 'dragon-tiger' && r.playerCount < r.maxPlayers)
    if (dtRoom) {
      joinedRef.current = true
      joinRoom(dtRoom.id, buyIn)
    } else {
      joinedRef.current = true
      createRoom({ buyIn })
    }
  }, [status, roomsReady, rooms, roomId, buyIn, joinRoom, createRoom])

  useEffect(() => {
    if (status === 'connected' && !roomId && !joinedRef.current) {
      refreshRooms()
    }
  }, [status, roomId, refreshRooms])

  // Audio cues + chip reset on phase/round changes
  useEffect(() => {
    if (!gameState) return
    const { phase, roundId } = gameState

    if (roundId !== prevRound.current) {
      setChipPlacements(emptyPlacements())
      setPendingCancel(false)
      setShowDragonWin(false)
      setShowTigerWin(false)
      chipZRef.current       = 1
      dingdingFiredRef.current = false
      prevRound.current      = roundId
    }

    // Dingding on last second before dealing
    if (phase === 'betting' && gameState.countdown === 1 && !dingdingFiredRef.current) {
      dingdingFiredRef.current = true
      const { sfxVolume, sfxMuted } = getAudioSettings()
      if (!sfxMuted) { _dingding.volume = 0.90 * sfxVolume; _dingding.currentTime = 0; _dingding.play().catch(() => {}) }
    }

    if (phase !== prevPhase.current) {
      if (phase === 'betting' && prevPhase.current !== null) {
        const { sfxVolume, sfxMuted } = getAudioSettings()
        if (!sfxMuted) { _dealSfx.volume = 0.75 * sfxVolume; _dealSfx.currentTime = 0; _dealSfx.play().catch(() => {}) }
      }
      if (phase === 'dealing') {
        const { sfxVolume, sfxMuted } = getAudioSettings()
        if (!sfxMuted) {
          _flip1.volume = 0.75 * sfxVolume; _flip1.currentTime = 0; _flip1.play().catch(() => {})
          setTimeout(() => { _flip2.volume = 0.75 * sfxVolume; _flip2.currentTime = 0; _flip2.play().catch(() => {}) }, 600)
        }
      }
      if (phase === 'result') {
        if (gameState.result === 'dragon') setTimeout(() => setShowDragonWin(true), 700)
        if (gameState.result === 'tiger')  setTimeout(() => setShowTigerWin(true),  700)
        // Record round history
        const meNow = gameState.players.find(p => p.id === myId)
        const bets  = meNow
          ? ZONE_KEYS.filter(z => (meNow.bets[z] || 0) > 0).map(z => ({ zone: z, amount: meNow.bets[z] }))
          : []
        const totalBet = bets.reduce((s, b) => s + b.amount, 0)
        const newEntry = {
          _key:       `live-${gameState.roundId}-${Date.now()}`,
          roundId:    gameState.roundId,
          dragonCard: gameState.dragonCard,
          tigerCard:  gameState.tigerCard,
          result:     gameState.result,
          bets,
          totalBet,
          payout:     meNow?.payout ?? 0,
          net:        (meNow?.payout ?? 0) - totalBet,
          ts:         Date.now(),
        }
        setRoundHistory(h => [newEntry, ...h])
      }
      prevPhase.current = phase
    }
  }, [gameState])

  // Bet activity feed + chip visuals (all players, driven by server state_update)
  useEffect(() => {
    if (!gameState || gameState.phase !== 'betting') {
      prevPlayerBetsRef.current = {}
      return
    }
    const flashSet = new Set()

    for (const p of gameState.players) {
      const prev = prevPlayerBetsRef.current[p.id]
      if (prev) {
        let changed = false
        for (const z of ZONE_KEYS) {
          const diff = (p.bets[z] || 0) - (prev[z] || 0)
          if (diff > 0) {
            changed = true
            const chipImg = [...CHIPS].reverse().find(c => c.value <= diff)?.img ?? CHIPS[0].img
            const chipId  = Date.now() + Math.random()
            const isMe    = p.id === myId
            setChipPlacements(cp => ({
              ...cp,
              [z]: [...cp[z], {
                id:  chipId,
                img: chipImg,
                x:   rnd(30, 70),
                y:   rnd(30, 70),
                rot: rnd(-20, 20),
                z:   chipZRef.current++,
                isMe,
              }],
            }))
            if (isMe) {
              const { sfxVolume, sfxMuted } = getAudioSettings()
              if (!sfxMuted) {
                const a = _chipSrc.cloneNode()
                a.volume = 0.70 * sfxVolume; a.play().catch(() => {})
              }
            } else {
              const id   = chipId + 0.1
              const text = `${p.username} 押${BET_LABELS[z]} ${fmt(diff)}`
              setBetActivities(a => [...a.slice(-2), { id, text }])
              setTimeout(() => setBetActivities(a => a.filter(x => x.id !== id)), 2500)
            }
          }
        }
        if (changed) flashSet.add(p.id)
      }
      prevPlayerBetsRef.current[p.id] = { ...p.bets }
    }

    if (flashSet.size > 0) {
      setFlashingPlayers(flashSet)
      setTimeout(() => setFlashingPlayers(new Set()), 500)
    }
  }, [gameState, myId])

  const handleLeave = () => {
    leaveRoom()
    navigate('/')
  }

  const handleZoneTap = (zone) => {
    if (gameState?.phase !== 'betting') return
    placeBet(zone, selectedChip.value)
  }

  const handleUndoBet = () => {
    cancelLastBet()
    setChipPlacements(prev => {
      // find and remove the last isMe chip (highest z)
      let maxZ = -1, maxZone = null
      for (const z of ZONE_KEYS) {
        for (const c of prev[z]) {
          if (c.isMe && c.z > maxZ) { maxZ = c.z; maxZone = z }
        }
      }
      if (!maxZone) return prev
      return { ...prev, [maxZone]: prev[maxZone].filter(c => c.z !== maxZ) }
    })
  }

  const handleCancelBets = () => {
    cancelBets()
    setPendingCancel(true)
    setChipPlacements(prev => {
      const cleared = emptyPlacements()
      for (const z of ZONE_KEYS) {
        cleared[z] = prev[z].filter(c => !c.isMe)
      }
      return cleared
    })
    if (myId) prevPlayerBetsRef.current[myId] = Object.fromEntries(ZONE_KEYS.map(z => [z, 0]))
  }

  // ── Derived state ──────────────────────────────────────────

  const phase      = gameState?.phase ?? 'idle'
  const countdown  = gameState?.countdown ?? 0
  const players    = gameState?.players ?? []
  const dragonCard = gameState?.dragonCard ?? null
  const tigerCard  = gameState?.tigerCard  ?? null
  const result     = gameState?.result     ?? null

  const me         = players.find(p => p.id === myId)
  const _serverBets = me?.bets ?? Object.fromEntries(ZONE_KEYS.map(z => [z, 0]))
  const myBets      = pendingCancel ? Object.fromEntries(ZONE_KEYS.map(z => [z, 0])) : _serverBets
  const myPayout        = me?.payout ?? 0
  const myTotalBet      = pendingCancel ? 0 : ZONE_KEYS.reduce((s, z) => s + (myBets[z] || 0), 0)
  const myRoundTotalBet = pendingCancel ? 0 : (me?.roundTotalBet ?? myTotalBet)

  const zoneTotals = Object.fromEntries(ZONE_KEYS.map(z => [z, 0]))
  for (const p of players) {
    for (const z of ZONE_KEYS) {
      zoneTotals[z] += (p.bets?.[z] || 0)
    }
  }

  const sortedPlayers  = me ? [me, ...players.filter(p => p.id !== myId)] : [...players]
  const visiblePlayers = sortedPlayers.slice(0, MAX_VISIBLE)
  const overflowCount  = Math.max(0, sortedPlayers.length - MAX_VISIBLE)

  const isBetting = phase === 'betting'
  const isResult  = phase === 'result'
  const faceDown  = phase !== 'result' && phase !== 'dealing'

  // ── Render ─────────────────────────────────────────────────

  if (status === 'no_auth') {
    return (
      <div className="dt-page">
        <div className="dt-center-msg">請先登入才能進入遊戲</div>
      </div>
    )
  }

  return (
    <div className="dt-page">
      {/* Reconnecting overlay */}
      {status === 'connecting' && (
        <div className="dt-reconnecting-overlay">
          <span>重新連線中...</span>
        </div>
      )}

      {/* Header */}
      <div className="dt-header">
        <button type="button" className="dt-back-btn" onClick={handleLeave}>
          <img src="/arrow.png" alt="back" className="dt-back-arrow" draggable={false} />
        </button>
        <div className="dt-header-center">
          <div className="dt-status-frame">
            <img src="/DragonTiger/frame.png" alt="" className="dt-frame-img" draggable={false} />
            {isBetting && countdown > 0 && (
              <span className={`dt-countdown ${countdown <= 5 ? 'is-urgent' : ''}`}>
                {countdown}s
              </span>
            )}
            {!isBetting && phase !== 'idle' && (
              <span className="dt-phase-label">
                {phase === 'dealing' ? '翻牌中' : phase === 'result' ? '結算中' : ''}
              </span>
            )}
          </div>
        </div>
        <div className="dt-header-right">
          <span className="dt-balance-label">線上人數</span>
          <span className="dt-balance-val">{players.length}</span>
        </div>
      </div>

      {/* Error toast */}
      {error && <div className="dt-error-toast">{error}</div>}

      {/* Table area */}
      <div className="dt-table">
        <img
          src="/DragonTiger/DragonTigerBg.png"
          alt=""
          className="dt-table-bg"
          draggable={false}
        />

        {/* BGM toggle */}
        <button type="button" className="dt-bgm-btn" onClick={toggleDtBgm} data-no-global-click="true">
          <img src={dtBgmMuted ? '/enable-sound.png' : '/volume.png'} alt="bgm" draggable={false} />
        </button>

        {/* Rule button */}
        <button type="button" className="dt-rule-btn" onClick={() => setShowRules(true)} data-no-global-click="true">
          <img src="/DragonTiger/ruleIcon.png" alt="規則" draggable={false} />
        </button>

        {/* Ledger button */}
        <button type="button" className="dt-ledger-btn" onClick={() => setShowHistory(true)} data-no-global-click="true">
          <img src="/DragonTiger/accounting.png" alt="帳務" draggable={false} />
        </button>

        {/* Cards */}
        <div className="dt-cards-area">
          <img src="/DragonTiger/DragonIcon.png" alt="龍" className="dt-card-label dt-label-dragon" draggable={false} />
          <div className="dt-cards-row">
            <PlayingCard card={dragonCard} faceDown={faceDown} delay={0} />
            <PlayingCard card={tigerCard}  faceDown={faceDown} delay={600} />
          </div>
          <img src="/DragonTiger/TigerIcon.png" alt="虎" className="dt-card-label dt-label-tiger" draggable={false} />
        </div>

        {/* Bet zones — absolutely positioned over background */}
        <div className="dt-zones-area">
          {ZONE_KEYS.map(zone => (
            <button
              key={zone}
              type="button"
              className={`dt-zone dt-zone-${zone}${isBetting ? ' is-active' : ''}`}
              style={ZONE_DEFS[zone]}
              onClick={() => handleZoneTap(zone)}
              disabled={!isBetting}
              data-no-global-click="true"
            >
              <ZoneBetDisplay
                placements={chipPlacements[zone]}
                totalBet={zoneTotals[zone]}
                myBet={myBets[zone]}
                small={isSuitZone(zone)}
              />
            </button>
          ))}
        </div>

        {/* Bet action buttons — sit on the table rail */}
        {myTotalBet > 0 && isBetting && (
          <div className="dt-rail-actions">
            <button type="button" className="dt-rail-undo" onClick={handleUndoBet} data-no-global-click="true">
              <img src="/DragonTiger/undo.png" alt="撤銷" draggable={false} />
            </button>
            <button type="button" className="dt-rail-clear" onClick={handleCancelBets} data-no-global-click="true">
              <img src="/DragonTiger/clear.png" alt="全清" draggable={false} />
            </button>
          </div>
        )}

        {/* Result overlay */}
        {isResult && (
          <ResultOverlay
            result={result}
            myPayout={myPayout}
            myTotalBet={myRoundTotalBet}
          />
        )}

        {/* Floating activity feed */}
        <div className="dt-activity-feed">
          {betActivities.map(a => (
            <div key={a.id} className="dt-activity-item">{a.text}</div>
          ))}
        </div>
      </div>

      {/* Player list */}
      <div className="dt-players-bar">
        {visiblePlayers.map(p => (
          <div
            key={p.id}
            className={`dt-player-chip ${p.id === myId ? 'is-me' : ''} ${flashingPlayers.has(p.id) ? 'is-betting' : ''}`}
          >
            <span className="dt-player-name">{p.username}</span>
            <span className="dt-player-bal">{fmt(p.balance)}</span>
          </div>
        ))}
        {overflowCount > 0 && (
          <button type="button" className="dt-more-players" onClick={() => setShowAllPlayers(true)}>
            +{overflowCount}
          </button>
        )}
      </div>


      {/* My bets summary */}
      {myTotalBet > 0 && (
        <div className="dt-bet-summary-bar">
          {ZONE_KEYS.filter(z => (myBets[z] || 0) > 0).map(z => (
            <span key={z} className={`dt-bet-tag dt-bet-${z.split('_')[0]}`}>
              {BET_LABELS[z]}：{fmt(myBets[z])}
            </span>
          ))}
        </div>
      )}

      {/* Bead road — always visible at the bottom */}
      <BeadRoad history={roundHistory} onLoadMore={loadMoreHistory} hasMore={hasMoreDb} />

      {/* Floating chip tray */}
      <DraggableChipTray
        selectedChip={selectedChip}
        onSelectChip={setSelectedChip}
        visible={isBetting}
      />

      {/* Cashout notice */}
      {cashoutBalance !== null && (
        <div className="dt-cashout-notice">
          已結算 — 帳戶餘額 {fmt(cashoutBalance)}
        </div>
      )}

      {/* Dragon / Tiger win animations */}
      {showDragonWin && <DragonWinAnim onDone={() => setShowDragonWin(false)} />}
      {showTigerWin  && <TigerWinAnim  onDone={() => setShowTigerWin(false)}  />}

      {/* Rules modal */}
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}

      {/* History modal */}
      {showHistory && <HistoryModal history={roundHistory} onClose={() => setShowHistory(false)} />}

      {/* All-players modal */}
      {showAllPlayers && (
        <div className="dt-players-modal-overlay" onClick={() => setShowAllPlayers(false)}>
          <div className="dt-players-modal" onClick={e => e.stopPropagation()}>
            <div className="dt-pmodal-title">本桌玩家</div>
            {sortedPlayers.map(p => (
              <div key={p.id} className={`dt-pmodal-row ${p.id === myId ? 'is-me' : ''}`}>
                <span className="dt-pmodal-name">{p.username}</span>
                <span className="dt-pmodal-bal">{fmt(p.balance)}</span>
              </div>
            ))}
            <button type="button" className="dt-pmodal-close" onClick={() => setShowAllPlayers(false)}>
              關閉
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
