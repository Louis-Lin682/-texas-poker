import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useBlackjackSocket } from '../hooks/useBlackjackSocket'
import { useAudio, getAudioSettings } from '../hooks/useAudio'
import PlayingCard from '../components/PlayingCard'

function fmt(n) { return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n) }
function fmtNum(n) { return new Intl.NumberFormat('en-US').format(n) }

function resultColor(r) {
  if (r === 'win' || r === 'blackjack' || r === 'fivecard') return '#57d46f'
  if (r === 'push') return '#f0c96b'
  return '#f06060'
}
function resultLabel(r) {
  if (r === 'blackjack') return 'BJ!'
  if (r === 'fivecard') return '五關!'
  if (r === 'win') return '勝'
  if (r === 'push') return '平'
  if (r === 'lose') return '輸'
  if (r === 'bust') return '爆'
  return ''
}
function cardFaceVal(card) {
  if (!card) return 0
  const r = card.slice(0, -1)
  if (['T', 'J', 'Q', 'K'].includes(r)) return 10
  if (r === 'A') return 11
  return parseInt(r)
}
function useCountdown(deadline) {
  const [left, setLeft] = useState(0)
  useEffect(() => {
    if (!deadline) { setLeft(0); return }
    const tick = () => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)))
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [deadline])
  return left
}

// Returns how many cards position `posIdx` should show after K cards have been dealt.
// slots = number of bettors + 1 (dealer).  posIdx 0..N-1 = bettors, posIdx N = dealer.
function dealVisCount(K, posIdx, slots) {
  if (K <= 0) return 0
  const round   = Math.floor((K - 1) / slots)
  const inRound = (K - 1) % slots
  return round + (inRound >= posIdx ? 1 : 0)
}

function chipImgForBet(amount) {
  if (amount >= 1000) return '/chip-blackgold.png'
  if (amount >= 500)  return '/chip-purple.png'
  if (amount >= 100)  return '/chip-gold.png'
  return '/chip-red.png'
}

// ── Stacked hand: cards overlap showing only each card's corner ──
function StackedHand({ cards, size = 'xs', activeHand = false, forceDown = false }) {
  const OFFSET = 14
  const W = 34  // both xs and sm are 34 px wide
  const H = size === 'md' ? 80 : 48
  return (
    <div style={{
      position: 'relative',
      width: W + Math.max(0, cards.length - 1) * OFFSET,
      height: H,
      flexShrink: 0,
      borderRadius: 6,
      outline: activeHand ? '1px solid rgba(226,206,135,0.55)' : '1px solid transparent',
      boxShadow: activeHand ? '0 0 10px rgba(226,206,135,0.2)' : 'none',
      padding: 2,
    }}>
      {cards.map((card, i) => (
        <div key={i} style={{
          position: 'absolute',
          left: 2 + i * OFFSET,
          top: 2,
          zIndex: i + 1,
        }}>
          <PlayingCard card={card} faceDown={forceDown || !card} size={size} />
        </div>
      ))}
    </div>
  )
}

const PHASE_LABEL = {
  waiting: '等待玩家', betting: '下注中', playing: '遊戲中',
  dealer: '莊家出牌', result: '結算',
}

function getSeats(players, myId) {
  const others = players.filter(p => p.id !== myId)
  while (others.length < 4) others.push(null)
  return others.slice(0, 4)
}

const CHIP_DEFS = [
  { value: 50,    img: '/chip-red.png' },
  { value: 100,   img: '/chip-gold.png' },
  { value: 500,   img: '/chip-purple.png' },
  { value: 1000,  img: '/chip-blackgold.png' },
  { value: 5000,  img: '/chip-red.png' },
  { value: 10000, img: '/chip-gold.png' },
]

// buyIn is the minimum balance required (and chips taken from account) for this tier.
const MAX_BET_PRESETS = [
  { label: '低限', maxBet: 1000,  buyIn: 3000  },
  { label: '高限', maxBet: 5000,  buyIn: 10000 },
  { label: '豪華', maxBet: 10000, buyIn: 30000 },
]

// ── Image action button (blackjack UI) ────────────────────
function BjBtn({ src, alt, onClick, disabled, amount, amountStyle, style }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{
      position: 'relative', background: 'none', border: 'none', padding: 0,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.4 : 1, flexShrink: 0, ...style,
    }}>
      <img src={src} alt={alt} style={{ display: 'block', height: 44, width: 'auto', maxWidth: '100%' }} />
      {amount != null && (
        <span style={{
          position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
          fontSize: 11, fontWeight: 800, color: '#f0c96b',
          textShadow: '0 1px 3px #000', pointerEvents: 'none',
          ...amountStyle,
        }}>
          {fmtNum(amount)}
        </span>
      )}
    </button>
  )
}

// ── Chip button (betting UI) ───────────────────────────────
function ChipBtn({ value, img, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{
      position: 'relative', width: 50, height: 50,
      background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0,
    }}>
      <img src={img} alt={String(value)} style={{ width: 50, height: 50, display: 'block' }} />
      <span style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontWeight: 800, fontSize: value >= 1000 ? 10 : 12,
        textShadow: '0 1px 3px #000, 0 0 6px #000', pointerEvents: 'none',
      }}>
        {value >= 1000 ? `${value / 1000}K` : value}
      </span>
    </button>
  )
}

// ── Betting zone: circle on the felt + chip when bet placed ──
function BettingZone({ bet, chipKey, animClass, hasPlayer }) {
  return (
    <div style={{
      width: 44, height: 44, borderRadius: '50%',
      border: `1.5px dashed rgba(226,206,135,${hasPlayer ? 0.55 : 0.2})`,
      background: 'rgba(0,0,0,0.22)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: hasPlayer ? '0 0 8px rgba(226,206,135,0.12)' : 'none',
    }}>
      {bet > 0 && (
        <div key={chipKey} className={animClass} style={{ position: 'relative', width: 34, height: 34 }}>
          <img src={chipImgForBet(bet)} alt="" style={{
            width: 34, height: 34, display: 'block',
            filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.9))',
          }} />
          <span style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 900, fontSize: 8,
            textShadow: '0 1px 2px #000',
          }}>{fmt(bet)}</span>
        </div>
      )}
    </div>
  )
}

// Absolute positions in pt-table-center for each betting zone circle
// translate(-50%,-50%) centers the 44px circle on the point
// Order: [p2 upper-left, p1 lower-left, me bottom-center, p3 upper-right, p4 lower-right]
const BZ_POSITIONS = [
  { left: '14%', top: '26%', transform: 'translate(-50%,-50%)' },
  { left: '14%', top: '66%', transform: 'translate(-50%,-50%)' },
  { left: '50%', top: '80%', transform: 'translate(-50%,-50%)' },
  { left: '86%', top: '26%', transform: 'translate(-50%,-50%)' },
  { left: '86%', top: '66%', transform: 'translate(-50%,-50%)' },
]

// ── Dealer seat (top center) ───────────────────────────────
// dealVisible: Infinity = show normally; finite number = show that many cards face-down (deal anim)
function DealerSeat({ dealer, dealVisible = Infinity }) {
  const allCards = dealer?.cards ?? []
  const animating = Number.isFinite(dealVisible)
  const score = dealer?.score ?? 0
  const bust  = score > 21
  const displayCards = animating
    ? allCards.slice(0, Math.min(allCards.length, dealVisible))
    : (allCards.length === 0 ? [null, null] : allCards)
  return (
    <div className="pt-seat">
      <div className="pt-badges">
        <span className="pt-badge pt-badge-d">D</span>
      </div>
      <div className="pt-avatar">莊</div>
      <span className="pt-name">莊家</span>
      <div className="pt-opp-cards">
        <StackedHand
          cards={displayCards.length > 0 ? displayCards : [null, null]}
          forceDown={animating && displayCards.length > 0}
        />
      </div>
      {score > 0 && !animating && (
        <span className="pt-chips" style={{ color: bust ? '#f06060' : undefined }}>
          {score}{bust ? ' 爆' : ''}
        </span>
      )}
    </div>
  )
}

// ── BJ Seat (other players) — no bet chip here ─────────────
// dealVisible: Infinity = show normally; finite number = show that many cards face-down (deal anim)
function BJSeat({ player, isActing, dealVisible = Infinity }) {
  if (!player) return <div className="pt-seat pt-seat-empty">空位</div>
  const hands = player.hands ?? []
  const hasBet = player.bet > 0
  const animating = Number.isFinite(dealVisible)

  return (
    <div className={`pt-seat${isActing ? ' is-acting' : ''}`}>
      <div className="pt-avatar">{player.username[0].toUpperCase()}</div>
      <span className="pt-name">{player.username}</span>
      <span className="pt-chips">{fmt(player.balance)}</span>

      {hands.length === 0 && (
        <div className="pt-opp-cards">
          {hasBet
            ? <StackedHand cards={[null, null]} />
            : <span style={{ fontSize: 9, color: player.ready ? '#57d46f' : '#555' }}>
                {player.ready ? '✓ 準備' : '等待中'}
              </span>
          }
        </div>
      )}

      {hands.map((hand, i) => {
        const displayCards = animating
          ? hand.cards.slice(0, Math.min(hand.cards.length, dealVisible))
          : hand.cards
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, marginTop: 2 }}>
            <div style={{ position: 'relative', display: 'inline-flex' }}>
              <StackedHand cards={displayCards} forceDown={animating && displayCards.length > 0} />
              {!animating && hand.result && (
                <span style={{
                  position: 'absolute', top: -8, right: -6, fontSize: 9, fontWeight: 700,
                  color: resultColor(hand.result), background: '#000a',
                  borderRadius: 4, padding: '1px 3px',
                }}>{resultLabel(hand.result)}</span>
              )}
            </div>
            {!animating && (hand.score ?? 0) > 0 && (
              <span style={{
                fontSize: 9, fontWeight: 700, lineHeight: 1,
                color: hand.score > 21 ? '#f06060' : '#e2ce87',
              }}>
                {hand.score > 21 ? '爆' : hand.score}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Lobby ──────────────────────────────────────────────────
// minBuyIn = chips the player is configured to bring; used to gate higher tiers
function LobbyView({ status, rooms, onCreateRoom, onJoinRoom, onRefresh, userBalance = 0, minBuyIn = 3000 }) {
  const [isSpinning, setIsSpinning] = useState(false)
  // A preset is locked when the configured bring-in (minBuyIn) is below that tier's required buy-in
  // OR when the user simply doesn't have enough balance
  const isLocked = (p) => minBuyIn < p.buyIn || userBalance < p.buyIn

  // Default to first unlocked preset
  const defaultIdx = MAX_BET_PRESETS.findIndex(p => !isLocked(p))
  const [selectedMaxBet, setSelectedMaxBet] = useState(defaultIdx < 0 ? 0 : defaultIdx)

  function handleRefresh() {
    if (isSpinning) return
    setIsSpinning(true); onRefresh()
    setTimeout(() => setIsSpinning(false), 700)
  }

  const selectedPreset = MAX_BET_PRESETS[selectedMaxBet]
  const canCreate = status === 'connected' && !isLocked(selectedPreset)

  return (
    <div className="pt-lobby">
      <div className="pt-lobby-head">
        <span className="pt-lobby-title">選擇房間</span>
        <button type="button" className={`pt-lobby-refresh${isSpinning ? ' is-spinning' : ''}`}
          onClick={handleRefresh} title="重新整理">
          <img src="/reload.png" alt="重整" />
        </button>
      </div>
      <div className="pt-bet-unit-row">
        <span className="pt-bet-unit-label">最大下注</span>
        <div className="pt-bet-unit-btns">
          {MAX_BET_PRESETS.map((p, i) => {
            const locked = isLocked(p)
            return (
              <button key={i} type="button"
                className={`pt-bet-unit-btn${selectedMaxBet === i ? ' is-active' : ''}${locked ? ' is-locked' : ''}`}
                onClick={() => !locked && setSelectedMaxBet(i)}
                disabled={locked}
                title={locked ? `需要帶入 ${fmtNum(p.buyIn)} 籌碼` : undefined}>
                {locked ? '🔒 ' : ''}{p.label}
                <span style={{ fontSize: 10, opacity: 0.75, marginLeft: 2 }}>
                  ({p.maxBet >= 1000 ? `${p.maxBet / 1000}K` : p.maxBet})
                </span>
              </button>
            )
          })}
        </div>
      </div>
      <button type="button" className="pt-lobby-create"
        onClick={() => onCreateRoom({ maxBet: selectedPreset.maxBet, buyIn: minBuyIn })}
        disabled={!canCreate}
        title={!canCreate && status === 'connected' ? `需要帶入 ${fmtNum(selectedPreset.buyIn)} 籌碼才能開桌` : undefined}>
        + 建立新房間
      </button>
      <div className="pt-room-list">
        {rooms.length === 0 ? (
          <div className="pt-room-empty">目前沒有房間，來建立第一間吧！</div>
        ) : rooms.map(r => {
          const roomMaxBet = r.maxBet ?? 0
          const requiredBuyIn = MAX_BET_PRESETS.find(p => p.maxBet === roomMaxBet)?.buyIn ?? roomMaxBet
          const affordable = minBuyIn >= requiredBuyIn && userBalance >= requiredBuyIn
          const canJoin = status === 'connected' && r.phase === 'waiting' &&
            r.playerCount < r.maxPlayers && affordable
          return (
            <div key={r.id} className="pt-room-item">
              <div className="pt-room-meta">
                <span className="pt-room-id-tag">#{r.id}</span>
                <span className="pt-room-phase">{PHASE_LABEL[r.phase] ?? r.phase}</span>
                {roomMaxBet > 0 && (
                  <span style={{ fontSize: 10, color: '#aaa', marginLeft: 4 }}>
                    上限 {roomMaxBet >= 1000 ? `${roomMaxBet / 1000}K` : roomMaxBet}
                  </span>
                )}
              </div>
              <div className="pt-room-bottom">
                <span className="pt-room-players">{r.playerCount} / {r.maxPlayers} 玩家</span>
                {(() => {
                  const isInsufficient = !affordable && r.phase === 'waiting' && r.playerCount < r.maxPlayers
                  return (
                    <button type="button"
                      className={`pt-room-join${isInsufficient ? ' is-locked' : ''}`}
                      onClick={() => onJoinRoom(r.id, minBuyIn)}
                      disabled={!canJoin}
                      title={isInsufficient ? `需要帶入 ${fmtNum(requiredBuyIn)} 籌碼` : undefined}>
                      {isInsufficient ? '🔒 籌碼不足' : '加入'}
                    </button>
                  )
                })()}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Waiting view ───────────────────────────────────────────
function WaitingView({ gameState, myId, onReady, onUnready, onLeaveRoom }) {
  const players = gameState?.players ?? []
  const me = players.find(p => p.id === myId)
  const startLeft = useCountdown(gameState?.startDeadline)
  const countingDown = !!gameState?.startDeadline && startLeft > 0
  const lockedIn = !!me?.ready && countingDown && startLeft <= 10

  return (
    <div className="pt-wait">
      <div className="pt-wait-title">等待玩家</div>
      <div className="pt-wait-players">
        {players.map(p => (
          <div key={p.id} className={`pt-wait-player${p.id === myId ? ' is-me' : ''}`}>
            <span className={`pt-wait-dot${p.ready ? ' is-ready' : ''}`} />
            <span className="pt-wait-av">{p.username[0].toUpperCase()}</span>
            <span className="pt-wait-name">{p.username}</span>
            <span className="pt-wait-chips">{fmt(p.balance)}</span>
            {p.ready && <span className="pt-wait-ready-tag">已準備</span>}
          </div>
        ))}
      </div>

      {countingDown ? (
        <div className="pt-wait-countdown">
          <span className="pt-wait-cd-num">{startLeft}</span>
          <span className="pt-wait-cd-label">秒後自動開始</span>
        </div>
      ) : (
        <p className="pt-wait-hint">
          {players.length < 2 ? `還需要 ${2 - players.length} 名玩家` : '等待所有人準備'}
        </p>
      )}

      <button type="button"
        className={`pt-wait-start${me?.ready ? ' is-ready' : ''}`}
        onClick={me?.ready ? onUnready : onReady}
        disabled={lockedIn}>
        {me?.ready ? '✓ 已準備好' : '我準備好了'}
      </button>
      <button type="button" className="pt-wait-leave" onClick={onLeaveRoom}>離開房間</button>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────
export default function BlackjackTablePage({ auth }) {
  const navigate = useNavigate()
  const location = useLocation()
  const minBuyIn = location.state?.buyIn ?? parseInt(localStorage.getItem('cfg_min_buy_in') || '3000', 10)

  const { play, preload } = useAudio()
  const bgmRef = useRef(null)

  const [isGameMuted, setIsGameMuted] = useState(false)
  const toggleGameMute = () => setIsGameMuted(m => !m)

  useEffect(() => {
    preload(['bj_win', 'bj_blackjack', 'bj_tie', 'bj_bust', 'bj_lose', 'bj_fivecard', 'bj_dealerBust', 'bj_nowYou', 'bj_insurance'])
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Game BGM — same track as Texas Hold'em table
  useEffect(() => {
    const { bgmVolume } = getAudioSettings()
    const audio = new Audio('/audio/game/gameBgSound.mp3')
    audio.loop   = true
    audio.muted  = false
    audio.volume = 0.28 * bgmVolume
    bgmRef.current = audio
    const tryPlay = () => { if (!bgmRef.current?.paused) return; bgmRef.current?.play().catch(() => {}) }
    document.addEventListener('click', tryPlay, { once: true })
    tryPlay()
    return () => {
      document.removeEventListener('click', tryPlay)
      audio.pause(); audio.src = ''; bgmRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!bgmRef.current) return
    const { bgmVolume } = getAudioSettings()
    bgmRef.current.muted  = isGameMuted
    bgmRef.current.volume = isGameMuted ? 0 : 0.28 * bgmVolume
  }, [isGameMuted])

  const {
    status, rooms, roomId, myId, gameState, error,
    cashoutBalance, refreshRooms, createRoom, joinRoom, leaveRoom, setReady, unready, doAction,
  } = useBlackjackSocket({ minBuyIn })

  const [betAmount, setBetAmount] = useState(0)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [isEntering, setIsEntering] = useState(false)
  const [dealStep, setDealStep] = useState(0)  // 0 = normal; 1..total = deal anim (face-down)

  // chipAnimKeys: playerId → incrementing key (re-mount triggers fresh animation)
  const [chipAnimKeys, setChipAnimKeys] = useState({})
  // resultAnimMap: playerId → 'win' | 'lose'
  const [resultAnimMap, setResultAnimMap] = useState(new Map())
  const prevBetsRef = useRef({})
  const prevPhaseRef = useRef(null)
  const prevDealPhaseRef = useRef(null)
  const dealIntervalRef = useRef(null)
  const lastBetRef = useRef(0)  // stores last confirmed bet for repeat-bet button

  const cashoutShown = useRef(false)
  const prevRoomIdRef = useRef(null)
  const prevCardCountRef = useRef(0)
  const hasCardBaselineRef = useRef(false)

  const timeLeft       = useCountdown(gameState?.betDeadline)
  const resultTimeLeft = useCountdown(gameState?.resultDeadline)
  const actionLeft     = useCountdown(gameState?.actionDeadline)

  // Synchronously start deal animation before browser paints (betting→playing only).
  // The interval is also started here so it isn't disrupted by the immediate
  // re-render that setDealStep(1) triggers (useEffect deps wouldn't re-fire then).
  useLayoutEffect(() => {
    const phase = gameState?.phase
    if (phase !== 'playing') hasCardBaselineRef.current = false

    if (phase === 'playing' && prevDealPhaseRef.current === 'betting') {
      setDealStep(1)
      const bettorCount = (gameState?.players ?? []).filter(p => p.bet > 0).length
      const slots = bettorCount + 1
      const total = slots * 2
      let step = 1
      const id = setInterval(() => {
        step++
        setDealStep(step)
        if (step >= total) {
          clearInterval(id)
          dealIntervalRef.current = null
          setTimeout(() => setDealStep(0), 500)
        }
      }, 150)
      dealIntervalRef.current = id
    }
    prevDealPhaseRef.current = phase ?? null

    return () => {
      if (dealIntervalRef.current) {
        clearInterval(dealIntervalRef.current)
        dealIntervalRef.current = null
      }
    }
  }, [gameState?.phase]) // eslint-disable-line react-hooks/exhaustive-deps

  // Play deal sound for each card revealed (dealStep > 0 = one card just appeared)
  useEffect(() => {
    if (dealStep > 0) play('cardDeal')
  }, [dealStep, play])

  // Hit / dealer-draw sounds (only when deal animation is done)
  useEffect(() => {
    if (!gameState || dealStep > 0) return
    const count =
      (gameState.players ?? []).reduce((s, p) =>
        s + (p.hands ?? []).reduce((s2, h) => s2 + (h.cards ?? []).filter(Boolean).length, 0), 0
      ) + (gameState.dealer?.cards ?? []).filter(Boolean).length
    if (!hasCardBaselineRef.current) {
      prevCardCountRef.current = count; hasCardBaselineRef.current = true; return
    }
    const diff = count - prevCardCountRef.current
    prevCardCountRef.current = count
    if (diff <= 0) return
    for (let i = 0; i < diff; i++) setTimeout(() => play('cardDeal'), i * 100)
  }, [gameState, play, dealStep]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (cashoutBalance != null && !cashoutShown.current) {
      cashoutShown.current = true; auth?.refreshUser?.()
    }
  }, [cashoutBalance]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Blackjack voice ──────────────────────────────────────
  const bjPrevActorRef = useRef(null)
  useEffect(() => {
    const current = gameState?.currentActorId
    if (current === myId && bjPrevActorRef.current !== myId) play('bj_nowYou')
    bjPrevActorRef.current = current ?? null
  }, [gameState?.currentActorId, myId]) // eslint-disable-line react-hooks/exhaustive-deps

  const bjPrevInsuranceRef = useRef(false)
  useEffect(() => {
    const dealerShowsAce = gameState?.dealer?.cards?.[0]?.slice(0, -1) === 'A'
    const cur = !!(gameState?.currentActorId === myId && dealerShowsAce)
    if (cur && !bjPrevInsuranceRef.current) play('bj_insurance')
    bjPrevInsuranceRef.current = cur
  }, [gameState?.currentActorId, gameState?.dealer?.cards, myId]) // eslint-disable-line react-hooks/exhaustive-deps

  const bjPrevPhaseRef = useRef(null)
  useEffect(() => {
    const phase = gameState?.phase
    if (phase === 'result' && bjPrevPhaseRef.current !== 'result') {
      const dealerBust = (gameState?.dealer?.score ?? 0) > 21
      if (dealerBust) {
        play('bj_dealerBust')
      } else {
        const myP = gameState?.players?.find(p => p.id === myId)
        const results = (myP?.hands ?? []).map(h => h.result).filter(Boolean)
        const priority = ['blackjack', 'fivecard', 'win', 'push', 'bust', 'lose']
        const best = priority.find(r => results.includes(r))
        const keyMap = { blackjack: 'bj_blackjack', fivecard: 'bj_fivecard', win: 'bj_win', push: 'bj_tie', bust: 'bj_bust', lose: 'bj_lose' }
        if (best && keyMap[best]) play(keyMap[best])
      }
    }
    bjPrevPhaseRef.current = phase ?? null
  }, [gameState?.phase]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const prev = prevRoomIdRef.current
    prevRoomIdRef.current = roomId
    if (roomId && !prev) {
      lastBetRef.current = 0  // clear repeat-bet when entering a new room
      setIsEntering(true)
      const t = setTimeout(() => setIsEntering(false), 1100)
      return () => clearTimeout(t)
    }
  }, [roomId])

  useEffect(() => {
    if (status === 'connected' && !roomId) {
      refreshRooms()
      const id = setInterval(refreshRooms, 5000)
      return () => clearInterval(id)
    }
  }, [status, roomId, refreshRooms])

  useEffect(() => {
    if (gameState?.phase !== 'betting') setBetAmount(0)
  }, [gameState?.phase])

  // Detect new bets → trigger "place" animation (bump key to re-mount)
  useEffect(() => {
    if (!gameState?.players) return
    const prev = prevBetsRef.current
    const updates = {}
    for (const p of gameState.players) {
      if (p.bet > 0 && !(prev[p.id] > 0)) {
        updates[p.id] = (chipAnimKeys[p.id] ?? 0) + 1
      }
      prev[p.id] = p.bet
    }
    if (Object.keys(updates).length > 0) {
      setChipAnimKeys(k => ({ ...k, ...updates }))
    }
  }, [gameState?.players]) // eslint-disable-line react-hooks/exhaustive-deps

  // Phase → face-down animation on initial deal + result animations
  useEffect(() => {
    const phase = gameState?.phase
    // deal animation driven by dealStep (set by useLayoutEffect + interval)
    if (phase === 'result' && prevPhaseRef.current !== 'result') {
      const m = new Map()
      for (const p of (gameState?.players ?? [])) {
        if (p.result === 'win') m.set(p.id, 'win')
        else if (p.result === 'lose') m.set(p.id, 'lose')
      }
      if (m.size > 0) setResultAnimMap(m)
    }
    if (phase === 'betting') {
      setResultAnimMap(new Map())
      setChipAnimKeys({})
      prevBetsRef.current = {}
    }
    prevPhaseRef.current = phase ?? null
  }, [gameState?.phase, gameState?.players]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived state ─────────────────────────────────────
  const phase = gameState?.phase ?? 'waiting'
  const myPlayer = gameState?.players?.find(p => p.id === myId)
  const [p1, p2, p3, p4] = getSeats(gameState?.players ?? [], myId)
  // Ordered for table positions: [p2, p1, me, p3, p4]
  const tablePlayers = [p2, p1, myPlayer ?? null, p3, p4]

  // Deal animation: dealStep > 0 means animation is running
  const isDealingFaceDown = dealStep > 0

  // Map each visual seat to a position in the deal sequence
  const activeDealSeats = tablePlayers.filter(p => p && p.bet > 0)
  const dealSlots = activeDealSeats.length + 1  // bettors + dealer
  const playerDealVis = (player) => {
    if (!isDealingFaceDown || !player) return Infinity
    const idx = activeDealSeats.findIndex(p => p.id === player.id)
    return idx < 0 ? Infinity : dealVisCount(dealStep, idx, dealSlots)
  }
  const dealerDealVis = isDealingFaceDown
    ? dealVisCount(dealStep, activeDealSeats.length, dealSlots)
    : Infinity

  const isMyTurn = gameState?.currentActorId === myId
  const myCurrentHandIdx = isMyTurn ? (gameState?.currentHandIdx ?? 0) : (myPlayer?.currentHandIdx ?? 0)
  const myCurrentHand = myPlayer?.hands?.[myCurrentHandIdx]
  const isPlaying = !!roomId && phase !== 'waiting'
  const isWaiting = !!roomId && phase === 'waiting'

  const canDouble = isMyTurn && myCurrentHand?.status === 'active' &&
    myCurrentHand?.cards?.length === 2 && (myPlayer?.balance ?? 0) >= (myCurrentHand?.bet ?? 0)
  const canSplit = isMyTurn && myCurrentHand?.status === 'active' &&
    myCurrentHand?.cards?.length === 2 &&
    myCurrentHand?.cards?.[0] && myCurrentHand?.cards?.[1] &&
    cardFaceVal(myCurrentHand.cards[0]) === cardFaceVal(myCurrentHand.cards[1]) &&
    (myPlayer?.balance ?? 0) >= (myCurrentHand?.bet ?? 0) && (myPlayer?.hands?.length ?? 0) < 4
  const dealerShowsAce = gameState?.dealer?.cards?.[0]?.slice(0, -1) === 'A'
  const canInsurance = isMyTurn && dealerShowsAce && !myPlayer?.insuranceDecided &&
    myCurrentHand?.cards?.length === 2 && myCurrentHand?.status === 'active' &&
    (myPlayer?.balance ?? 0) >= Math.floor((myCurrentHand?.bet ?? 0) / 2)

  const handleBack = useCallback(() => {
    if (isPlaying) { setShowLeaveConfirm(true); return }
    if (roomId) leaveRoom()
    else navigate('/')
  }, [isPlaying, roomId, leaveRoom, navigate])

  const confirmLeave = () => { setShowLeaveConfirm(false); leaveRoom() }

  const maxBet = gameState?.maxBet ?? 5000
  const activeChips = CHIP_DEFS.filter(c => c.value <= maxBet)

  const addChip = (v) => {
    const p = gameState?.players?.find(p => p.id === myId)
    if (!p) return
    setBetAmount(prev => Math.min(prev + v, Math.min(maxBet, prev + p.balance)))
  }
  const confirmBet = () => {
    if (betAmount < (gameState?.minBet ?? 50)) return
    lastBetRef.current = betAmount
    doAction('bet', betAmount)
  }

  const iMeWinner = myId != null && resultAnimMap.get(myId) === 'win'
  const acting = (id) => !!id && gameState?.currentActorId === id

  return (
    <div className="pt-page">

      {showLeaveConfirm && (
        <div className="pt-modal-overlay">
          <div className="pt-modal">
            <p className="pt-modal-title">確定離開遊戲？</p>
            <p className="pt-modal-body">遊戲進行中，離開後本局視為棄牌。</p>
            <div className="pt-modal-btns">
              <button type="button" className="pt-modal-cancel" onClick={() => setShowLeaveConfirm(false)}>繼續遊戲</button>
              <button type="button" className="pt-modal-confirm" onClick={confirmLeave}>確定離開</button>
            </div>
          </div>
        </div>
      )}

      {isEntering && (
        <div className="bt-enter-overlay">
          <div className="bt-enter-content">
            <div className="bt-enter-label">進入房間</div>
            <div className="bt-enter-id">#{roomId}</div>
          </div>
        </div>
      )}

      <header className="pt-header">
        <button type="button" className="pt-back" onClick={handleBack}>
          <img src="/arrow.png" alt="返回" />
        </button>
        <div className="pt-header-info">
          {roomId
            ? <span className="pt-room-label">房間 #{roomId}</span>
            : <img src="/blackjack/blackjack.png" alt="21點" className="pt-room-label-img" />
          }
          {roomId && <span className="pt-blinds">最低下注 {gameState?.minBet ?? 50}</span>}
        </div>
        {isPlaying && <span className="pt-phase-badge">{PHASE_LABEL[phase]}</span>}
        <button type="button" className="pt-mute-btn" onClick={toggleGameMute}
          title={isGameMuted ? '開啟音樂' : '關閉音樂'}>
          <img src={isGameMuted ? '/enable-sound.png' : '/volume.png'} alt="" />
        </button>
      </header>

      {error && <div className="pt-error-bar">{error}</div>}

      {(status === 'idle' || status === 'connecting') && (
        <div className="pt-connecting-overlay">
          <div className="pt-connecting-spinner" />
          <span className="pt-connecting-text">連線中…</span>
        </div>
      )}

      {!roomId && status === 'connected' && (
        <LobbyView
          status={status} rooms={rooms}
          onCreateRoom={(opts) => createRoom({ buyIn: opts.buyIn ?? minBuyIn, ...opts })}
          onJoinRoom={(id, buyIn) => joinRoom(id, buyIn ?? minBuyIn)}
          onRefresh={refreshRooms}
          userBalance={auth?.user?.balance ?? 0}
          minBuyIn={minBuyIn}
        />
      )}

      {isWaiting && (
        <WaitingView gameState={gameState} myId={myId} onReady={setReady} onUnready={unready} onLeaveRoom={leaveRoom} />
      )}

      {isPlaying && (
        <>
          {/* ── Result modal ───────────────────────────────── */}
          {phase === 'result' && (
            <div className="bt-result-overlay">
              <div className="bt-result-card">
                <div className="bt-result-title">本局結算</div>
                <table className="bt-result-table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>玩家</th>
                      <th>點數</th>
                      <th>結果</th>
                      <th>增減</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Dealer row */}
                    <tr>
                      <td style={{ textAlign: 'left', color: '#666' }}>莊家</td>
                      <td style={{ color: (gameState?.dealer?.score ?? 0) > 21 ? '#f06060' : '#888' }}>
                        {gameState?.dealer?.score ?? 0}
                        {(gameState?.dealer?.score ?? 0) > 21 ? ' 爆' : gameState?.dealer?.blackjack ? ' BJ' : ''}
                      </td>
                      <td style={{ color: '#555' }}>—</td>
                      <td style={{ color: '#555' }}>—</td>
                    </tr>
                    {/* Player rows */}
                    {(gameState?.players ?? []).filter(p => p.bet > 0).map(p => {
                      let profit = 0
                      for (const hand of (p.hands ?? [])) {
                        if (hand.result === 'win' || hand.result === 'fivecard') profit += hand.bet
                        else if (hand.result === 'blackjack') profit += Math.floor(hand.bet * 1.5)
                        else if (hand.result === 'lose' || hand.result === 'bust') profit -= hand.bet
                      }
                      // Insurance profit/loss
                      if ((p.insuranceBet ?? 0) > 0) {
                        if (gameState?.dealer?.blackjack) profit += p.insuranceBet * 2
                        else profit -= p.insuranceBet
                      }
                      const allHandResults = (p.hands ?? []).map(h => h.result)
                      const bestResult = allHandResults.includes('blackjack') ? 'blackjack'
                        : allHandResults.includes('fivecard') ? 'fivecard'
                        : allHandResults.includes('win') ? 'win'
                        : allHandResults.includes('push') && allHandResults.every(r => r === 'push') ? 'push'
                        : allHandResults.includes('bust') ? 'bust'
                        : 'lose'
                      const displayScore = Math.max(...(p.hands ?? []).map(h => h.score ?? 0), 0)
                      const isMe = p.id === myId
                      return (
                        <tr key={p.id} className={profit > 0 && isMe ? 'bt-result-winner' : ''}>
                          <td style={{ textAlign: 'left', fontWeight: isMe ? 700 : 400 }}>
                            {p.username}
                          </td>
                          <td style={{ color: displayScore > 21 ? '#f06060' : undefined }}>
                            {displayScore > 0 ? displayScore : '—'}
                            {displayScore > 21 ? ' 爆' : ''}
                          </td>
                          <td style={{ color: resultColor(bestResult), fontWeight: 700 }}>
                            {resultLabel(bestResult)}
                          </td>
                          <td className={profit > 0 ? 'bt-positive' : profit < 0 ? 'bt-negative' : ''}>
                            {profit > 0 ? '+' : ''}{fmtNum(profit)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div style={{ textAlign: 'center', marginTop: 12, color: '#555', fontSize: 11 }}>
                  {resultTimeLeft} 秒後進入下一局…
                </div>
              </div>
            </div>
          )}

          <div className="pt-top-container">

            {/* Dealer at top center */}
            <div className="pt-top-center">
              <DealerSeat dealer={gameState?.dealer} dealVisible={dealerDealVis} />
            </div>

            <div className="pt-middle">
              <div className="pt-side-col">
                <BJSeat player={p2} isActing={acting(p2?.id)} dealVisible={playerDealVis(p2)} />
                <BJSeat player={p1} isActing={acting(p1?.id)} dealVisible={playerDealVis(p1)} />
              </div>

              <div className="pt-table-center">
                {/* Betting zones — one per player position, spread around the oval */}
                {tablePlayers.map((player, i) => {
                  const animKey = chipAnimKeys[player?.id] ?? 1
                  const resultAnim = player ? resultAnimMap.get(player.id) : undefined
                  let animClass = 'bj-chip-place'
                  if (resultAnim === 'win') animClass = 'bj-chip-win'
                  else if (resultAnim === 'lose') animClass = iMeWinner ? 'bj-chip-lose-down' : 'bj-chip-lose'
                  const chipKey = resultAnim
                    ? `${player?.id}-${resultAnim}`
                    : `${player?.id}-${animKey}`
                  return (
                    <div key={i} style={{
                      position: 'absolute', zIndex: 3, pointerEvents: 'none',
                      ...BZ_POSITIONS[i],
                    }}>
                      <BettingZone
                        bet={player?.bet ?? 0}
                        chipKey={chipKey}
                        animClass={animClass}
                        hasPlayer={!!player}
                      />
                    </div>
                  )
                })}

                <div className="pt-overlay">
                  {/* Center status: whose turn / dealer playing */}
                  {phase === 'playing' && (
                    <div style={{
                      background: isMyTurn ? 'rgba(240,201,107,0.12)' : 'rgba(0,0,0,0.65)',
                      border: `1px solid ${isMyTurn ? 'rgba(226,206,135,0.4)' : 'rgba(255,255,255,0.1)'}`,
                      borderRadius: 20, padding: '4px 14px', backdropFilter: 'blur(4px)',
                    }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: isMyTurn ? '#f0c96b' : '#bbb' }}>
                        {isMyTurn ? '你的回合'
                          : `輪到 ${(gameState?.players ?? []).find(p => p.id === gameState?.currentActorId)?.username ?? '…'}`}
                      </span>
                    </div>
                  )}
                  {phase === 'dealer' && (
                    <div style={{
                      background: 'rgba(0,0,0,0.65)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 20, padding: '4px 14px', backdropFilter: 'blur(4px)',
                    }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#bbb', whiteSpace: 'nowrap' }}>莊家出牌中…</span>
                    </div>
                  )}
                  <div className="pt-pot">
                    <span className="pt-pot-label">21點</span>
                  </div>
                </div>
              </div>

              <div className="pt-side-col">
                <BJSeat player={p3} isActing={acting(p3?.id)} dealVisible={playerDealVis(p3)} />
                <BJSeat player={p4} isActing={acting(p4?.id)} dealVisible={playerDealVis(p4)} />
              </div>
            </div>

            {/* Me at bottom */}
            <div className="pt-bottom-center">
              <div className={`pt-seat pt-seat-me${isMyTurn ? ' is-acting' : ''}`}>
                <div className="pt-avatar">{myPlayer?.username?.[0]?.toUpperCase() ?? 'M'}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-start' }}>
                  <span className="pt-name">{myPlayer?.username}</span>
                  <span className="pt-chips">{fmt(myPlayer?.balance ?? 0)}</span>
                </div>

                {(myPlayer?.hands?.length ?? 0) > 0 && (
                  <div style={{
                    display: 'flex', gap: 8, justifyContent: 'center',
                    flexWrap: 'wrap', marginTop: 4,
                  }}>
                    {myPlayer.hands.map((hand, i) => {
                      const myDealVis = playerDealVis(myPlayer)
                      const animating = Number.isFinite(myDealVis)
                      const displayCards = animating
                        ? hand.cards.slice(0, Math.min(hand.cards.length, myDealVis))
                        : hand.cards
                      return (
                        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                          {myPlayer.hands.length > 1 && (
                            <span style={{ fontSize: 9, color: '#888' }}>#{i + 1}</span>
                          )}
                          <StackedHand
                            cards={displayCards}
                            size="sm"
                            activeHand={isMyTurn && i === myCurrentHandIdx}
                            forceDown={animating && displayCards.length > 0}
                          />
                          {!animating && (
                            <span style={{ fontSize: 9, color: hand.result ? resultColor(hand.result) : '#aaa' }}>
                              {hand.score > 0 ? hand.score : ''}
                              {hand.result ? ` ${resultLabel(hand.result)}` : ''}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {(myPlayer?.hands?.length ?? 0) === 0 && (myPlayer?.bet ?? 0) > 0 && (
                  <div className="pt-opp-cards">
                    <StackedHand cards={[null, null]} size="sm" />
                  </div>
                )}
              </div>

              {/* Countdown below seat */}
              {phase === 'betting' && (myPlayer?.bet ?? 0) > 0 && (
                <div className="pt-countdown-wrap" style={{ width: '100%', marginTop: 4 }}>
                  <span className="pt-waiting-inline" style={{ color: '#57d46f' }}>
                    ✓ 已下注 {fmtNum(myPlayer.bet)}，等待其他玩家…
                  </span>
                </div>
              )}
              {phase === 'betting' && (myPlayer?.bet ?? 0) === 0 && (
                <div className="pt-countdown-wrap" style={{ width: '100%', marginTop: 4 }}>
                  <div className="pt-countdown-bar" style={{ width: `${Math.max(0, (timeLeft / 15) * 100)}%` }} />
                  <span className="pt-countdown-num">{timeLeft}s</span>
                </div>
              )}
              {phase === 'playing' && isMyTurn && actionLeft > 0 && (
                <div className="pt-countdown-wrap" style={{ width: '100%', marginTop: 4 }}>
                  <div className="pt-countdown-bar" style={{
                    width: `${Math.max(0, (actionLeft / 30) * 100)}%`,
                    background: actionLeft <= 10 ? '#f06060' : undefined,
                  }} />
                  <span className="pt-countdown-num" style={{ color: actionLeft <= 10 ? '#f06060' : undefined }}>
                    {actionLeft}s
                  </span>
                </div>
              )}

            </div>

            {/* Action bar — betting phase: chips + confirm */}
            {phase === 'betting' && (myPlayer?.bet ?? 0) === 0 && (
              <div className="pt-actions">
                <div style={{ display: 'flex', gap: 6, justifyContent: 'center', padding: '4px 0' }}>
                  {activeChips.map(({ value, img }) => (
                    <ChipBtn key={value} value={value} img={img} onClick={() => addChip(value)} />
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '0 16px' }}>
                  <span style={{ fontSize: 12, color: '#aaa', flexShrink: 0 }}>
                    下注: <span style={{ color: '#f0c96b', fontWeight: 700 }}>{fmtNum(betAmount)}</span>
                  </span>
                  <BjBtn src="/blackjack/Clear.png" alt="清除" onClick={() => setBetAmount(0)} />
                  {lastBetRef.current > 0 && betAmount === 0 && (
                    <BjBtn
                      src="/blackjack/repeat.png" alt="重複"
                      amount={lastBetRef.current}
                      amountStyle={{ right: '20%', top: '35%', transform: 'none' }}
                      onClick={() => {
                        const p = gameState?.players?.find(p => p.id === myId)
                        if (p) setBetAmount(Math.min(lastBetRef.current, Math.min(maxBet, p.balance)))
                      }}
                    />
                  )}
                  <BjBtn
                    src="/blackjack/Betting.png" alt="確認下注"
                    disabled={betAmount < (gameState?.minBet ?? 50)}
                    onClick={confirmBet}
                  />
                </div>
              </div>
            )}

            {/* Action bar — playing phase: stop/hit/double/split + insurance */}
            {phase === 'playing' && isMyTurn && (
              <div className="pt-actions">
                {canInsurance && (
                  <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 4 }}>
                    <BjBtn
                      src="/blackjack/Insurance.png" alt="買保險"
                      amount={Math.floor((myCurrentHand?.bet ?? 0) / 2)}
                      amountStyle={{ right: '15%', top: '25%', transform: 'none' }}
                      onClick={() => doAction('insurance')}
                    />
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
                  <BjBtn src="/blackjack/stop.png" alt="停牌" onClick={() => doAction('stand')} />
                  <BjBtn src="/blackjack/hold.png" alt="要牌" onClick={() => doAction('hit')} />
                  {canDouble && (
                    <BjBtn src="/blackjack/double.png" alt="加倍" onClick={() => doAction('double')} />
                  )}
                  {canSplit && (
                    <BjBtn src="/blackjack/Split.png" alt="分牌" onClick={() => doAction('split')} />
                  )}
                </div>
              </div>
            )}

          </div>
        </>
      )}

    </div>
  )
}
