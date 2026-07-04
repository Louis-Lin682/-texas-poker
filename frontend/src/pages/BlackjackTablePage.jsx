import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useBlackjackSocket } from '../hooks/useBlackjackSocket'
import { useGameStatus } from '../hooks/useGameStatus'
import { useAudio, muteHowl } from '../hooks/useAudio'
import PlayingCard from '../components/PlayingCard'
import LeaveConfirmModal from '../components/LeaveConfirmModal'

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
  while (others.length < 5) others.push(null)
  return others.slice(0, 5)
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
  { label: '低限', maxBet: 500,   buyIn: 1500,  img: '/texas-holdem/room-green-felt-button.png',   cardImg: '/texas-holdem/room-card-green-felt.png'   },
  { label: '中限', maxBet: 1000,  buyIn: 3000,  img: '/texas-holdem/room-golden-hall-button.png',  cardImg: '/texas-holdem/room-card-golden-hall.png'  },
  { label: '高限', maxBet: 5000,  buyIn: 10000, img: '/texas-holdem/room-royal-hall-button.png',   cardImg: '/texas-holdem/room-card-royal-hall.png'   },
  { label: '豪華', maxBet: 10000, buyIn: 30000, img: '/texas-holdem/room-supreme-hall-button.png', cardImg: '/texas-holdem/room-card-supreme-hall.png' },
]

// ── Image action button (blackjack UI) ────────────────────
function BjBtn({ src, alt, onClick, disabled, amount, amountStyle, style, imgStyle }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{
      position: 'relative', background: 'none', border: 'none', padding: 0,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.4 : 1, flexShrink: 0, ...style,
    }}>
      <img src={src} alt={alt} style={{ display: 'block', height: 52, width: 'auto', maxWidth: 68, objectFit: 'contain', ...imgStyle }} />
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
function ChipBtn({ value, img, onClick, size = 50 }) {
  return (
    <button type="button" onClick={onClick} style={{
      position: 'relative', width: size, height: size,
      background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0,
    }}>
      <img src={img} alt={String(value)} style={{ width: size, height: size, display: 'block' }} />
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

// Mobile BZ positions: [p2 upper-left, p1 lower-left, me bottom-center, p3 upper-right, p4 lower-right]
const BZ_POSITIONS_MOBILE = [
  { left: '14%', top: '26%', transform: 'translate(-50%,-50%)' },
  { left: '14%', top: '66%', transform: 'translate(-50%,-50%)' },
  { left: '50%', top: '80%', transform: 'translate(-50%,-50%)' },
  { left: '86%', top: '26%', transform: 'translate(-50%,-50%)' },
  { left: '86%', top: '66%', transform: 'translate(-50%,-50%)' },
]
// PC BZ positions: [p1 top-left, p2 top-right, p3 left, p4 right, me bottom-left, p5 bottom-right]
const BZ_POSITIONS_PC = [
  { left: '20%', top: '10%', transform: 'translate(-50%,-50%)' },
  { left: '78%', top: '10%', transform: 'translate(-50%,-50%)' },
  { left: '10%', top: '50%', transform: 'translate(-50%,-50%)' },
  { left: '90%', top: '50%', transform: 'translate(-50%,-50%)' },
  { left: '28%', top: '80%', transform: 'translate(-50%,-50%)' },
  { left: '72%', top: '80%', transform: 'translate(-50%,-50%)' },
]

// ── Dealer seat (top center) ───────────────────────────────
// dealVisible: Infinity = show normally; finite number = show that many cards face-down (deal anim)
function DealerSeat({ dealer, dealVisible = Infinity, cardSize = 'xs' }) {
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
      <div className="pt-avatar" style={{ padding: 0, overflow: 'hidden', background: 'none', border: 'none' }}>
        <img src="/dealer-badge.png" alt="莊家" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
      </div>
      <span className="pt-name">莊家</span>
      <div className="pt-opp-cards">
        <StackedHand
          cards={displayCards.length > 0 ? displayCards : [null, null]}
          size={cardSize}
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
function BJSeat({ player, isActing, dealVisible = Infinity, cardSize = 'xs', side }) {
  if (!player) return <div className={`pt-seat pt-seat-empty${side === 'left' ? ' pt-seat-left' : side === 'right' ? ' pt-seat-right' : ''}`}>空位</div>
  const hands = player.hands ?? []
  const hasBet = player.bet > 0
  const animating = Number.isFinite(dealVisible)

  return (
    <div className={`pt-seat${isActing ? ' is-acting' : ''}${side === 'left' ? ' pt-seat-left' : side === 'right' ? ' pt-seat-right' : ''}`}>
      {isActing && <div className="pt-acting-arrow" />}
      <div className="pt-avatar"><img src={player.avatar} alt="" /></div>
      <span className="pt-name">{player.username}</span>
      <span className="pt-chips">{fmt(player.balance)}</span>

      {hands.length === 0 && (
        <div className="pt-opp-cards">
          {hasBet
            ? <StackedHand cards={[null, null]} size={cardSize} />
            : <span style={{ fontSize: 9, color: player.ready ? '#57d46f' : '#555' }}>
                {player.ready ? '✓ 準備' : '等待中'}
              </span>
          }
        </div>
      )}

      {hands.length > 0 && (
        <div className="pt-opp-cards" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
          {hands.map((hand, i) => {
            const displayCards = animating
              ? hand.cards.slice(0, Math.min(hand.cards.length, dealVisible))
              : hand.cards
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <div style={{ position: 'relative', display: 'inline-flex' }}>
                  <StackedHand cards={displayCards} size={cardSize} forceDown={animating && displayCards.length > 0} />
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
                    fontSize: 13, fontWeight: 700, lineHeight: 1,
                    color: hand.score > 21 ? '#f06060' : '#e2ce87',
                  }}>
                    {hand.score > 21 ? '爆' : hand.score}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Lobby ──────────────────────────────────────────────────
function LobbyView({ status, rooms, onCreateRoom, onJoinRoom, onRefresh, userBalance = 0, minBuyIn = 0 }) {
  const [isSpinning, setIsSpinning] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(0)

  function handleRefresh() {
    if (isSpinning) return
    setIsSpinning(true); onRefresh()
    setTimeout(() => setIsSpinning(false), 700)
  }

  const selectedPreset = MAX_BET_PRESETS[selectedIdx]
  const canCreate = status === 'connected'
  const filteredRooms = rooms.filter(r => r.maxBet === selectedPreset.maxBet)

  return (
    <div className="pt-lobby">
      <div className="pt-lobby-head">
        <span className="pt-lobby-title">選擇房間</span>
        <div className="pt-lobby-head-actions">
          <button type="button" className={`pt-lobby-refresh${isSpinning ? ' is-spinning' : ''}`} onClick={handleRefresh} title="重新整理">
            <img src="/reload.png" alt="重整" />
          </button>
          <button type="button" className="pt-lobby-create"
            onClick={() => onCreateRoom({ maxBet: selectedPreset.maxBet, buyIn: minBuyIn })}
            disabled={!canCreate}>
            + 建立新房間
          </button>
        </div>
      </div>

      <div className="pt-bet-unit-btns">
        {MAX_BET_PRESETS.map((p, i) => (
          <button key={i} type="button"
            className={`pt-bet-unit-btn${selectedIdx === i ? ' is-active' : ''}`}
            onClick={() => setSelectedIdx(i)}>
            <img src={p.img} alt={p.label} />
          </button>
        ))}
      </div>

      <div className="pt-room-list">
        {filteredRooms.length === 0 ? (
          <div className="pt-room-empty">此廳暫無房間，來建立第一間吧！</div>
        ) : filteredRooms.map(r => {
          const roomPreset = MAX_BET_PRESETS.find(p => p.maxBet === r.maxBet) ?? null
          return (
            <div key={r.id} className="pt-room-item">
              {roomPreset && (
                <div className="pt-room-img-wrap">
                  <img src={roomPreset.img} alt={roomPreset.label} />
                </div>
              )}
              <div className="pt-room-info">
                <div className="pt-room-left">
                  <span className="pt-room-id-tag">#{r.id.slice(0, 6).toUpperCase()}</span>
                  <span className="pt-room-blinds">上限 {r.maxBet >= 1000 ? `${r.maxBet / 1000}K` : r.maxBet}</span>
                  <span className="pt-room-players">{r.playerCount}/{r.maxPlayers} 玩家</span>
                </div>
                <div className="pt-room-right">
                  <span className="pt-room-phase">{PHASE_LABEL[r.phase] ?? r.phase}</span>
                  <button type="button" className="pt-room-join"
                    onClick={() => onJoinRoom(r.id, minBuyIn)}
                    disabled={status !== 'connected' || r.phase !== 'waiting' || r.playerCount >= r.maxPlayers}>
                    加入
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Waiting view ───────────────────────────────────────────
function WaitingView({ gameState, myId, roomId, onReady, onUnready, onLeaveRoom }) {
  const players = gameState?.players ?? []
  const me = players.find(p => p.id === myId)
  const maxPlayers = gameState?.maxPlayers ?? 6
  const maxBet = gameState?.maxBet
  const startLeft = useCountdown(gameState?.startDeadline)
  const isCountingDown = !!gameState?.startDeadline && startLeft > 0
  const lockedIn = !!me?.ready && isCountingDown && startLeft <= 10

  return (
    <div className="pt-wait">
      <div className="pt-wait-plaque">
        <img src="/waiting-player-plaque.png" alt="" className="pt-wait-plaque-img" />
        <div className="pt-wait-plaque-body">
          <div className="pt-wait-plaque-count">
            <span className="pt-wait-plaque-num">{players.length}/{maxPlayers}</span>
            <span className="pt-wait-plaque-unit">位玩家</span>
          </div>
          <div className="pt-wait-plaque-meta">
            {roomId && <span className="pt-wait-plaque-room">#{roomId.slice(0, 6).toUpperCase()}</span>}
            {maxBet && <span className="pt-wait-plaque-blinds">上限 {maxBet}</span>}
          </div>
        </div>
      </div>

      <div className="pt-wait-players">
        {players.map(p => (
          <div key={p.id} className={`pt-wait-player${p.id === myId ? ' is-me' : ''}`}>
            <span className={`pt-wait-dot${p.ready ? ' is-ready' : ''}`} />
            <div className="pt-wait-av"><img src={p.avatar} alt="" /></div>
            <div className="pt-wait-info">
              <span className="pt-wait-name">{p.username}</span>
              <span className={`pt-wait-status${p.ready ? ' is-ready' : ''}`}>{p.ready ? '已準備' : '未準備'}</span>
            </div>
            <div className="pt-wait-chips-wrap">
              <img src="/chip-gold.png" className="pt-wait-chip-img" alt="" />
              <span className="pt-wait-chips">{fmt(p.balance)}</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        {isCountingDown && (
          <div className="pt-wait-countdown">
            <span className="pt-wait-cd-num">{startLeft}</span>
            <span className="pt-wait-cd-label">秒後自動開始</span>
          </div>
        )}
        <button type="button" className="pt-wait-ready-btn"
          onClick={me?.ready ? onUnready : onReady} disabled={lockedIn}>
          <img src="/ready-button.png" alt="" className="pt-wait-ready-img" />
          <span className="pt-wait-ready-text">{me?.ready ? '✓ 已準備好' : '我準備好了'}</span>
        </button>
        <button type="button" className="pt-wait-leave-btn" onClick={onLeaveRoom}>
          <img src="/leave-room-button.png" alt="" className="pt-wait-leave-img" />
        </button>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────
export default function BlackjackTablePage({ auth }) {
  const navigate = useNavigate()
  const location = useLocation()
  const gameStatus = useGameStatus('blackjack')
  const minBuyIn = location.state?.buyIn ?? parseInt(localStorage.getItem('cfg_min_buy_in') || '3000', 10)
  const lastChipsRef = useRef(minBuyIn)

  const { play, stop, preload } = useAudio()

  const [isGameMuted, setIsGameMuted] = useState(false)
  const toggleGameMute = () => setIsGameMuted(m => !m)

  useEffect(() => {
    preload(['bj_win', 'bj_blackjack', 'bj_tie', 'bj_bust', 'bj_lose', 'bj_fivecard', 'bj_dealerBust', 'bj_nowYou', 'bj_insurance', 'bj_flip', 'bj_stand', 'bj_hit', 'bj_double', 'bj_split'])
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    play('bj_bgm', { volume: 0.28, loop: true })
    return () => stop('bj_bgm')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    muteHowl('bj_bgm', isGameMuted)
  }, [isGameMuted])

  const {
    status, rooms, roomId, myId, gameState, error,
    cashoutBalance, wasKicked, refreshRooms, createRoom, joinRoom, leaveRoom, setReady, unready, doAction,
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
  const prevDealStepRef = useRef(0)
  const isMyTurnRef = useRef(false)

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

  // Play flip sound per card during deal; play now-you when deal finishes and it's my turn
  useEffect(() => {
    if (dealStep > 0) {
      play('bj_flip')
    } else if (prevDealStepRef.current > 0 && isMyTurnRef.current) {
      play('bj_nowYou')
    }
    prevDealStepRef.current = dealStep
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
    if (!wasKicked) return
    const t = setTimeout(() => navigate('/'), 3000)
    return () => clearTimeout(t)
  }, [wasKicked]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (cashoutBalance != null && !cashoutShown.current) {
      cashoutShown.current = true
      auth?.applyBalance?.(cashoutBalance)
    }
  }, [cashoutBalance]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Blackjack voice ──────────────────────────────────────
  const bjPrevActorRef = useRef(null)
  useEffect(() => {
    bjPrevActorRef.current = gameState?.currentActorId ?? null
  }, [gameState?.currentActorId])

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
  if (myPlayer?.balance != null) lastChipsRef.current = myPlayer.balance
  const [p1, p2, p3, p4, p5] = getSeats(gameState?.players ?? [], myId)
  // Mobile order: [p2, p1, me, p3, p4]
  const tablePlayers = [p2, p1, myPlayer ?? null, p3, p4]
  // PC order: [p1, p2, p3, p4, me, p5]
  const tablePlayers_pc = [p1, p2, p3, p4, myPlayer ?? null, p5]

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
  isMyTurnRef.current = isMyTurn
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

  // Intercept browser / mobile back button
  const roomIdRef = useRef(null)
  useEffect(() => { roomIdRef.current = roomId }, [roomId])
  useEffect(() => {
    window.history.pushState(null, '', window.location.href)
    const onPop = () => {
      window.history.pushState(null, '', window.location.href)
      if (roomIdRef.current) setShowLeaveConfirm(true)
      else navigate('/')
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [navigate]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleBack = useCallback(() => {
    if (roomId) { setShowLeaveConfirm(true); return }
    navigate('/')
  }, [roomId, navigate])

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

      {(gameStatus?.status === 'maintenance' || gameStatus?.status === 'updating') && (
        <div className="game-maint-overlay">
          <div className="game-maint-box">
            <div className="mt-title">{gameStatus.status === 'maintenance' ? '遊戲維護中' : '遊戲更新中'}</div>
            {gameStatus.notice && <div className="mt-notice">{gameStatus.notice}</div>}
            <div className="mt-sub">敬請期待，稍後再試</div>
          </div>
        </div>
      )}

      {wasKicked && (
        <div className="kicked-overlay">
          <div className="kicked-overlay-box">
            <div className="kicked-title">您已被管理員移出房間</div>
            <div className="kicked-sub">即將返回大廳...</div>
          </div>
        </div>
      )}

      {showLeaveConfirm && (
        <LeaveConfirmModal
          body="遊戲進行中，離開後本局視為棄牌。"
          onConfirm={confirmLeave}
          onCancel={() => setShowLeaveConfirm(false)}
        />
      )}

      {isEntering && (
        <div className="bt-enter-overlay">
          <div className="bt-enter-content">
            <div className="bt-enter-label">進入房間</div>
            <div className="bt-enter-id">#{roomId}</div>
          </div>
        </div>
      )}

      {/* Overlays before header — mirrors ThunderJoker pattern so pt-header z-index:10 always paints above on iOS */}
      {(status === 'idle' || status === 'connecting') && (
        <div className="pt-connecting-overlay">
          <div className="pt-connecting-spinner" />
          <span className="pt-connecting-text">連線中…</span>
        </div>
      )}

      <div className="pt-header-con">
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
      </div>

      <div className="pt-content">
      {error && <div className="pt-error-bar">{error}</div>}

      {!roomId && status === 'connected' && (
        <LobbyView
          status={status} rooms={rooms}
          onCreateRoom={(opts) => createRoom({ ...opts, buyIn: lastChipsRef.current })}
          onJoinRoom={(id) => joinRoom(id, lastChipsRef.current)}
          onRefresh={refreshRooms}
          userBalance={auth?.user?.balance ?? 0}
          minBuyIn={minBuyIn}
        />
      )}

      {isWaiting && (
        <WaitingView gameState={gameState} myId={myId} roomId={roomId} onReady={setReady} onUnready={unready} onLeaveRoom={leaveRoom} />
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

          {/* ── Mobile layout ── */}
          <div className="pt-mobile-layout pt-top-container">

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
                {/* Betting zones */}
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
                      ...BZ_POSITIONS_MOBILE[i],
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
                {isMyTurn && <div className="pt-acting-arrow" />}
                <div className="pt-avatar"><img src={myPlayer?.avatar} alt="" /></div>
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
                            <span className="pt-chips" style={{ fontSize: 13, color: hand.result ? resultColor(hand.result) : hand.score > 21 ? '#f06060' : undefined }}>
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
                    imgStyle={{ maxWidth: 'none' }}
                  />
                </div>
              </div>
            )}

            {/* Action bar — playing phase: always visible; masked when not my turn */}
            {phase === 'playing' && (
              <div className="pt-actions">
                {!isMyTurn && <div className="pt-actions-mask" />}
                {(() => {
                  const btnS = { flex: 1, minWidth: 0 }
                  const imgS = { width: '100%', height: 'auto', maxWidth: 'none' }
                  return (
                    <div style={{ display: 'flex', gap: 6, width: '100%', padding: '0 8px' }}>
                      {canInsurance && (
                        <BjBtn src="/blackjack/Insurance.png" alt="買保險"
                          amount={Math.floor((myCurrentHand?.bet ?? 0) / 2)}
                          amountStyle={{ right: '15%', top: '25%', transform: 'none' }}
                          style={btnS} imgStyle={imgS}
                          onClick={() => doAction('insurance')} />
                      )}
                      <BjBtn src="/blackjack/stop.png" alt="停牌" style={btnS} imgStyle={imgS} onClick={() => { play('bj_stand'); doAction('stand') }} />
                      <BjBtn src="/blackjack/hold.png" alt="要牌" style={btnS} imgStyle={imgS} onClick={() => { play('bj_hit'); doAction('hit') }} />
                      <BjBtn src="/blackjack/double.png" alt="加倍" style={btnS} imgStyle={imgS} disabled={!canDouble} onClick={() => { play('bj_double'); doAction('double') }} />
                      <BjBtn src="/blackjack/Split.png" alt="分牌" style={btnS} imgStyle={imgS} disabled={!canSplit} onClick={() => { play('bj_split'); doAction('split') }} />
                    </div>
                  )
                })()}
              </div>
            )}

          </div>

          {/* ── PC layout ── */}
          <div className="pt-pc-layout pt-top-container">
            {/* 莊家獨立一排 */}
            <div className="pt-pc-dealer-row">
              <DealerSeat dealer={gameState?.dealer} dealVisible={dealerDealVis} cardSize="md" />
            </div>
            <div className="pt-pc-top" style={{ position: 'relative', top: '-20%' }}>
              <BJSeat player={p1} isActing={acting(p1?.id)} dealVisible={playerDealVis(p1)} cardSize="md" />
              <BJSeat player={p2} isActing={acting(p2?.id)} dealVisible={playerDealVis(p2)} cardSize="md" />
            </div>
            <div className="pt-pc-middle" style={{ position: 'relative', top: '-16%' }}>
              <BJSeat player={p3} isActing={acting(p3?.id)} dealVisible={playerDealVis(p3)} cardSize="md" side="left" />
              <div className="pt-table-center">
                {/* PC betting zones */}
                {tablePlayers_pc.map((player, i) => {
                  const animKey = chipAnimKeys[player?.id] ?? 1
                  const resultAnim = player ? resultAnimMap.get(player.id) : undefined
                  let animClass = 'bj-chip-place'
                  if (resultAnim === 'win') animClass = 'bj-chip-win'
                  else if (resultAnim === 'lose') animClass = iMeWinner ? 'bj-chip-lose-down' : 'bj-chip-lose'
                  const chipKey = resultAnim ? `${player?.id}-${resultAnim}` : `${player?.id}-${animKey}`
                  return (
                    <div key={i} style={{ position: 'absolute', zIndex: 3, pointerEvents: 'none', ...BZ_POSITIONS_PC[i] }}>
                      <BettingZone bet={player?.bet ?? 0} chipKey={chipKey} animClass={animClass} hasPlayer={!!player} />
                    </div>
                  )
                })}
                <div className="pt-overlay">
                  {phase === 'playing' && (
                    <div style={{ background: isMyTurn ? 'rgba(240,201,107,0.12)' : 'rgba(0,0,0,0.65)', border: `1px solid ${isMyTurn ? 'rgba(226,206,135,0.4)' : 'rgba(255,255,255,0.1)'}`, borderRadius: 20, padding: '4px 14px', backdropFilter: 'blur(4px)' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: isMyTurn ? '#f0c96b' : '#bbb' }}>
                        {isMyTurn ? '你的回合' : `輪到 ${(gameState?.players ?? []).find(p => p.id === gameState?.currentActorId)?.username ?? '…'}`}
                      </span>
                    </div>
                  )}
                  {phase === 'dealer' && (
                    <div style={{ background: 'rgba(0,0,0,0.65)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: '4px 14px', backdropFilter: 'blur(4px)' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#bbb', whiteSpace: 'nowrap' }}>莊家出牌中…</span>
                    </div>
                  )}
                  <div className="pt-pot"><span className="pt-pot-label">21點</span></div>
                </div>
              </div>
              <BJSeat player={p4} isActing={acting(p4?.id)} dealVisible={playerDealVis(p4)} cardSize="md" side="right" />
            </div>
            <div className="pt-pc-bottom">
              <div className="pt-pc-me-col">
                <div className={`pt-seat pt-seat-me${isMyTurn ? ' is-acting' : ''}`}>
                  {isMyTurn && <div className="pt-acting-arrow" />}
                  <div className="pt-avatar"><img src={myPlayer?.avatar} alt="" /></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-start' }}>
                    <span className="pt-name">{myPlayer?.username}</span>
                    <span className="pt-chips">{fmt(myPlayer?.balance ?? 0)}</span>
                  </div>
                  {(myPlayer?.hands?.length ?? 0) > 0 && (
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                      {myPlayer.hands.map((hand, i) => {
                        const myDealVis = playerDealVis(myPlayer)
                        const animating = Number.isFinite(myDealVis)
                        const displayCards = animating ? hand.cards.slice(0, Math.min(hand.cards.length, myDealVis)) : hand.cards
                        return (
                          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                            {myPlayer.hands.length > 1 && <span style={{ fontSize: 9, color: '#888' }}>#{i + 1}</span>}
                            <StackedHand cards={displayCards} size="md" activeHand={isMyTurn && i === myCurrentHandIdx} forceDown={animating && displayCards.length > 0} />
                            {!animating && (
                              <span className="pt-chips" style={{ fontSize: 13, color: hand.result ? resultColor(hand.result) : hand.score > 21 ? '#f06060' : undefined }}>
                                {hand.score > 0 ? hand.score : ''}{hand.result ? ` ${resultLabel(hand.result)}` : ''}
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {(myPlayer?.hands?.length ?? 0) === 0 && (myPlayer?.bet ?? 0) > 0 && (
                    <div className="pt-opp-cards"><StackedHand cards={[null, null]} size="md" /></div>
                  )}
                </div>
              </div>
              <BJSeat player={p5} isActing={acting(p5?.id)} dealVisible={playerDealVis(p5)} cardSize="md" />
            </div>
            <div className={`pt-actions${(!isMyTurn && phase === 'playing') ? ' pt-actions-inactive' : ''}`}>
              <div className="pt-countdown-wrap">
                {phase === 'betting' && (myPlayer?.bet ?? 0) > 0 && (
                  <span className="pt-waiting-inline" style={{ color: '#57d46f' }}>✓ 已下注 {fmtNum(myPlayer.bet)}，等待其他玩家…</span>
                )}
                {phase === 'betting' && (myPlayer?.bet ?? 0) === 0 && (<>
                  <div className="pt-countdown-bar" style={{ width: `${Math.max(0, (timeLeft / 15) * 100)}%` }} />
                  <span className="pt-countdown-num">{timeLeft}s</span>
                </>)}
                {phase === 'playing' && isMyTurn && actionLeft > 0 && (<>
                  <div className="pt-countdown-bar" style={{ width: `${Math.max(0, (actionLeft / 30) * 100)}%`, background: actionLeft <= 10 ? '#f06060' : undefined }} />
                  <span className="pt-countdown-num" style={{ color: actionLeft <= 10 ? '#f06060' : undefined }}>{actionLeft}s</span>
                </>)}
                {phase === 'playing' && !isMyTurn && (
                  <span className="pt-waiting-inline">等待 {(gameState?.players ?? []).find(p => p.id === gameState?.currentActorId)?.username ?? '…'} 行動中</span>
                )}
              </div>
              {phase === 'betting' && (myPlayer?.bet ?? 0) === 0 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {activeChips.map(({ value, img }) => (
                      <ChipBtn key={value} value={value} img={img} onClick={() => addChip(value)} size={64} />
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <BjBtn src="/blackjack/Clear.png" alt="清除" onClick={() => setBetAmount(0)} imgStyle={{ height: 47 }} />
                    {lastBetRef.current > 0 && betAmount === 0
                      ? <BjBtn src="/blackjack/repeat.png" alt="重複" amount={lastBetRef.current}
                          amountStyle={{ right: '20%', top: '35%', transform: 'none' }}
                          imgStyle={{ height: 64 }}
                          onClick={() => {
                            const p = gameState?.players?.find(p => p.id === myId)
                            if (p) setBetAmount(Math.min(lastBetRef.current, Math.min(maxBet, p.balance)))
                          }} />
                      : <span style={{ fontSize: 14, color: '#f0c96b', fontWeight: 700, minWidth: 40, textAlign: 'center' }}>下注: {fmtNum(betAmount)}</span>
                    }
                    <BjBtn src="/blackjack/Betting.png" alt="確認下注"
                      disabled={betAmount < (gameState?.minBet ?? 50)}
                      onClick={confirmBet} imgStyle={{ height: 64, maxWidth: 'none' }} />
                  </div>
                </div>
              )}
              {phase === 'playing' && (
                <div className="pt-btn-row">
                  {(() => {
                    const btnW = canInsurance ? 88 : 115
                    const s = { width: btnW, height: 'auto', maxWidth: 'none' }
                    return (<>
                      {canInsurance && (
                        <BjBtn src="/blackjack/Insurance.png" alt="買保險"
                          amount={Math.floor((myCurrentHand?.bet ?? 0) / 2)}
                          amountStyle={{ right: '15%', top: '25%', transform: 'none' }}
                          imgStyle={s}
                          onClick={() => doAction('insurance')} />
                      )}
                      <BjBtn src="/blackjack/stop.png" alt="停牌" imgStyle={s} onClick={() => { play('bj_stand'); doAction('stand') }} />
                      <BjBtn src="/blackjack/hold.png" alt="要牌" imgStyle={s} onClick={() => { play('bj_hit'); doAction('hit') }} />
                      <BjBtn src="/blackjack/double.png" alt="加倍" imgStyle={s} disabled={!canDouble} onClick={() => { play('bj_double'); doAction('double') }} />
                      <BjBtn src="/blackjack/Split.png" alt="分牌" imgStyle={s} disabled={!canSplit} onClick={() => { play('bj_split'); doAction('split') }} />
                    </>)
                  })()}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      </div>
    </div>
  )
}
