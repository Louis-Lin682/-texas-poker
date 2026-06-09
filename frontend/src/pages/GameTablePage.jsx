import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import PlayingCard from '../components/PlayingCard'
import { usePokerSocket } from '../hooks/usePokerSocket'
import { useAudio, getAudioSettings } from '../hooks/useAudio'

const CHIP_IMGS = ['/chip-red.png', '/chip-gold.png', '/chip-purple.png', '/chip-blackgold.png']
const TURN_TIME  = 30

function PtBtn({ src, alt, onClick, disabled, amount, amountStyle, style }) {
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
          {amount}
        </span>
      )}
    </button>
  )
}

const RANK_VAL = {'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':14}
function evalHand(cards) {
  if (!cards || cards.length < 2) return null
  const vals  = cards.map(c => RANK_VAL[c.slice(0,-1)]).sort((a,b) => b-a)
  const suits  = cards.map(c => c.slice(-1))
  const freq   = {}
  vals.forEach(v => { freq[v] = (freq[v]||0)+1 })
  const counts = Object.values(freq).sort((a,b)=>b-a)
  const sFreq  = {}
  suits.forEach(s => { sFreq[s]=(sFreq[s]||0)+1 })
  const hasFlush = cards.length >= 5 && Object.values(sFreq).some(c=>c>=5)
  const uniq = [...new Set(vals)].sort((a,b)=>a-b)
  let hasStraight = false
  for (let i=0; i<=uniq.length-5; i++) if (uniq[i+4]-uniq[i]===4) { hasStraight=true; break }
  if (!hasStraight && uniq.includes(14) && [2,3,4,5].every(v=>uniq.includes(v))) hasStraight=true
  if (hasFlush && hasStraight) return '同花順'
  if (counts[0]===4) return '四條'
  if (counts[0]===3 && counts[1]>=2) return '葫蘆'
  if (hasFlush) return '同花'
  if (hasStraight) return '順子'
  if (counts[0]===3) return '三條'
  if (counts[0]===2 && counts[1]===2) return '兩對'
  if (counts[0]===2) return '一對'
  return '高牌'
}

const PHASE_LABEL = {
  waiting: '等待玩家', pre_flop: '翻牌前',
  flop: '翻牌', turn: '轉牌', river: '河牌', showdown: '攤牌',
}

function fmt(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n)
}

// Rotate players so current user is always index 0, then fill 5 opponent slots
function getSeats(players, myId) {
  const myIdx = players.findIndex(p => p.id === myId)
  const me = myIdx >= 0 ? players[myIdx] : null
  const rest = myIdx >= 0
    ? [...players.slice(myIdx + 1), ...players.slice(0, myIdx)]
    : [...players]
  while (rest.length < 5) rest.push(null)
  return [me, ...rest.slice(0, 5)]
}

// ── Seat ──────────────────────────────────────────────────────────────────────
function Seat({ player, isActing, isMe, myCards, handStrength, revealedCards, seatIndex = 0, dealKey }) {
  if (!player) {
    return <div className="pt-seat pt-seat-empty">空位</div>
  }

  const folded = player.status === 'folded'
  const allIn  = player.status === 'all_in'
  const shownCards = revealedCards?.get(player.id)
  const baseDelay = seatIndex * 0.14

  return (
    <div className={[
      'pt-seat',
      isActing ? 'is-acting' : '',
      folded   ? 'is-folded'  : '',
      isMe     ? 'pt-seat-me' : '',
    ].filter(Boolean).join(' ')}>

      <div className="pt-badges">
        {player.isDealer && <span className="pt-badge pt-badge-d">莊家</span>}
        {player.isSB     && <span className="pt-badge pt-badge-sb">小盲</span>}
        {player.isBB     && <span className="pt-badge pt-badge-bb">大盲</span>}
        {allIn           && <span className="pt-badge pt-badge-ai">AI</span>}
        {isMe && handStrength && <span className="pt-badge pt-badge-hand">{handStrength}</span>}
      </div>

      {isMe ? (
        <div className="pt-me-info">
          <div className="pt-avatar">{player.username[0].toUpperCase()}</div>
          <span className="pt-name">{player.username}</span>
          <span className="pt-chips">{fmt(player.balance)}</span>
        </div>
      ) : (
        <>
          <div className="pt-avatar">{player.username[0].toUpperCase()}</div>
          <span className="pt-name">{player.username}</span>
          <span className="pt-chips">{fmt(player.balance)}</span>
        </>
      )}

      {!isMe && (
        <div key={dealKey} className="pt-opp-cards" style={{'--deal-base': `${baseDelay}s`}}>
          {!folded && player.cardCount > 0 && (
            shownCards
              ? shownCards.map((c, i) => <PlayingCard key={i} card={c} size="xs" />)
              : Array(player.cardCount).fill(0).map((_, i) => <PlayingCard key={i} faceDown size="xs" />)
          )}
        </div>
      )}

      {isMe && myCards && myCards.length > 0 && (
        <div key={dealKey} className="pt-my-cards" style={{'--deal-base': `${baseDelay}s`}}>
          {myCards.map((c, i) => <PlayingCard key={i} card={c} size="lg" />)}
        </div>
      )}

      {player.roundBet > 0 && (
        <div className="pt-bet-chip">
          <img src="/chip-gold.png" className="pt-bet-chip-img" alt="" />
          <span className="pt-bet-chip-val">{fmt(player.roundBet)}</span>
        </div>
      )}
    </div>
  )
}

// ── Win overlay ───────────────────────────────────────────────────────────────
function WinOverlay({ winInfo }) {
  if (!winInfo) return null
  const isShowdown = !winInfo.folded && (winInfo.players ?? []).length > 0
  const winnerIds = new Set(winInfo.winners.map(w => w.id))

  return (
    <div className="pt-win-overlay">
      <div className="pt-win-card">
        <div className="pt-win-coins">
          {[0,1,2,3,4,5,6,7].map(i => (
            <img key={i} className="pt-win-coin" src={CHIP_IMGS[i % 4]} alt="" />
          ))}
        </div>

        {isShowdown ? (
          <div className="pt-win-showdown">
            {winInfo.players.map(p => (
              <div key={p.id} className={`pt-win-row${winnerIds.has(p.id) ? ' is-winner' : ''}`}>
                <span className="pt-win-pname">{p.username}</span>
                <div className="pt-win-pcards">
                  {(p.holeCards ?? []).map((c, i) => <PlayingCard key={i} card={c} size="sm" />)}
                </div>
                {p.handName && <span className="pt-win-phand">{p.handName}</span>}
                {winnerIds.has(p.id) && (
                  <span className="pt-win-pamount">
                    +{fmt(winInfo.winners.find(w => w.id === p.id)?.amount ?? 0)}
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="pt-win-fold">
            <div className="pt-win-fold-av">{winInfo.winners[0]?.username[0]?.toUpperCase()}</div>
            <p className="pt-win-fold-tag">贏得本局</p>
            {winInfo.winners.map(w => (
              <div key={w.id} className="pt-win-fold-row">
                <span className="pt-win-fold-name">{w.username}</span>
                <span className="pt-win-fold-amt">+{fmt(w.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const STATUS_MSG = {
  idle:         '準備連線…',
  connecting:   '連線中…',
  no_auth:      '請先登入帳號',
  error:        '連線失敗，請重新整理頁面',
  disconnected: '已斷線，請重新整理頁面',
}

// ── Lobby ─────────────────────────────────────────────────────────────────────
const BLIND_PRESETS = [
  { label: '低限',  smallBlind: 10,  bigBlind: 20  },
  { label: '中限',  smallBlind: 25,  bigBlind: 50  },
  { label: '高限',  smallBlind: 50,  bigBlind: 100 },
  { label: '豪華',  smallBlind: 100, bigBlind: 200 },
]
const MIN_BB_MULTIPLE = 50  // need at least 50× big blind to sit down

function LobbyView({ status, rooms, onCreateRoom, onJoinRoom, onRefresh, buyIn }) {
  const isConnected = status === 'connected'
  const [isSpinning, setIsSpinning] = useState(false)

  const canAfford = (p) => buyIn >= p.bigBlind * MIN_BB_MULTIPLE

  // Default to the first affordable preset
  const [selectedPreset, setSelectedPreset] = useState(
    () => Math.max(0, BLIND_PRESETS.findIndex(canAfford))
  )

  function handleRefresh() {
    if (isSpinning) return
    setIsSpinning(true)
    onRefresh()
    setTimeout(() => setIsSpinning(false), 700)
  }

  const preset = BLIND_PRESETS[selectedPreset]

  return (
    <div className="pt-lobby">
      <div className="pt-lobby-head">
        <span className="pt-lobby-title">選擇房間</span>
        <button type="button" className={`pt-lobby-refresh${isSpinning ? ' is-spinning' : ''}`} onClick={handleRefresh} title="重新整理"><img src="/reload.png" alt="重整" /></button>
      </div>

      {(!isConnected || isSpinning) && (
        <div className={`pt-conn-hint ${status === 'error' || status === 'disconnected' ? 'pt-conn-hint-err' : ''}`}>
          {isSpinning ? '連線中…' : (STATUS_MSG[status] ?? status)}
        </div>
      )}

      <div className="pt-bet-unit-row">
        <span className="pt-bet-unit-label">盲注</span>
        <div className="pt-bet-unit-btns">
          {BLIND_PRESETS.map((p, i) => {
            const ok = canAfford(p)
            return (
              <button
                key={i}
                type="button"
                className={`pt-bet-unit-btn${selectedPreset === i ? ' is-active' : ''}${!ok ? ' is-locked' : ''}`}
                onClick={() => ok && setSelectedPreset(i)}
                disabled={!ok}
                title={!ok ? `需帶入至少 ${new Intl.NumberFormat('en-US').format(p.bigBlind * MIN_BB_MULTIPLE)}` : ''}
              >
                {!ok ? '🔒 ' : ''}{p.label}
              </button>
            )
          })}
        </div>
      </div>

      <button type="button" className="pt-lobby-create"
        onClick={() => onCreateRoom({ smallBlind: preset.smallBlind, bigBlind: preset.bigBlind })}
        disabled={!isConnected}>
        + 建立新房間（{preset.smallBlind}/{preset.bigBlind}）
      </button>

      <div className="pt-room-list">
        {rooms.length === 0 ? (
          <div className="pt-room-empty">目前沒有房間，來建立第一間吧！</div>
        ) : rooms.map(r => {
          const canJoin = buyIn >= (r.bigBlind ?? 0) * MIN_BB_MULTIPLE
          return (
            <div key={r.id} className="pt-room-item">
              <div className="pt-room-meta">
                <span className="pt-room-id-tag">#{r.id}</span>
                <span className="pt-room-blinds">{r.smallBlind}/{r.bigBlind}</span>
                <span className="pt-room-phase">{PHASE_LABEL[r.phase] ?? r.phase}</span>
              </div>
              <div className="pt-room-bottom">
                <span className="pt-room-players">{r.playerCount} / {r.maxPlayers} 玩家</span>
                {(() => {
                  const isInsufficient = !canJoin && r.phase === 'waiting' && r.playerCount < r.maxPlayers
                  return (
                    <button
                      type="button"
                      className={`pt-room-join${isInsufficient ? ' is-locked' : ''}`}
                      onClick={() => onJoinRoom(r.id)}
                      disabled={!isConnected || r.phase !== 'waiting' || r.playerCount >= r.maxPlayers || !canJoin}
                      title={!canJoin ? `需帶入至少 ${new Intl.NumberFormat('en-US').format((r.bigBlind ?? 0) * MIN_BB_MULTIPLE)}` : ''}
                    >
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

// ── Waiting room ───────────────────────────────────────────────────────────────
function WaitingView({ gameState, myId, onReady, onUnready, onLeaveRoom }) {
  const players = gameState?.players ?? []
  const me = players.find(p => p.id === myId)
  const countdownEnd = gameState?.countdownEnd ?? null
  const [cdLeft, setCdLeft] = useState(0)

  useEffect(() => {
    if (!countdownEnd) { setCdLeft(0); return }
    const tick = () => setCdLeft(Math.max(0, Math.ceil((countdownEnd - Date.now()) / 1000)))
    tick()
    const id = setInterval(tick, 200)
    return () => clearInterval(id)
  }, [countdownEnd])

  const isCountingDown = !!countdownEnd && cdLeft > 0
  const lockedIn = !!me?.ready && isCountingDown && cdLeft <= 10

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

      {isCountingDown ? (
        <div className="pt-wait-countdown">
          <span className="pt-wait-cd-num">{cdLeft}</span>
          <span className="pt-wait-cd-label">秒後自動開始</span>
        </div>
      ) : (
        <p className="pt-wait-hint">
          {players.length < 2
            ? `還需要 ${2 - players.length} 名玩家`
            : players.every(p => p.ready)
              ? '所有人已準備，即將開始…'
              : '等待所有人準備'}
        </p>
      )}

      <button
        type="button"
        className={`pt-wait-start${me?.ready ? ' is-ready' : ''}`}
        onClick={me?.ready ? onUnready : onReady}
        disabled={lockedIn}>
        {me?.ready ? '✓ 已準備好' : '我準備好了'}
      </button>
      <button type="button" className="pt-wait-leave" onClick={onLeaveRoom}>
        離開房間
      </button>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
function GameTablePage({ auth }) {
  const navigate = useNavigate()
  const location = useLocation()
  const defaultGameSlug = location.state?.gameSlug ?? 'texas-holdem'

  const minBuyIn = location.state?.buyIn ?? parseInt(localStorage.getItem('cfg_min_buy_in') || '3000', 10)

  const {
    status, rooms, roomId, myId, gameState, winInfo, lastAction, error, cashoutBalance,
    refreshRooms, createRoom, joinRoom, leaveRoom, startGame, doAction, setReady, unready,
  } = usePokerSocket({ minBuyIn })

  useEffect(() => {
    if (cashoutBalance !== null) auth?.refreshUser?.()
  }, [cashoutBalance]) // eslint-disable-line react-hooks/exhaustive-deps

  const { play, preload } = useAudio()

  useEffect(() => {
    preload(['pt_nowYou', 'pt_fold', 'pt_check', 'pt_call', 'pt_raise', 'pt_allin', 'cardDeal'])
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const PT_VOICE = { fold: 'pt_fold', check: 'pt_check', call: 'pt_call', raise: 'pt_raise', all_in: 'pt_allin' }
  useEffect(() => {
    if (!lastAction) return
    const key = PT_VOICE[lastAction.action]
    if (key) play(key)
  }, [lastAction]) // eslint-disable-line react-hooks/exhaustive-deps

  const prevActorRef = useRef(null)
  useEffect(() => {
    const current = gameState?.currentActorId
    if (current === myId && prevActorRef.current !== myId) play('pt_nowYou')
    prevActorRef.current = current ?? null
  }, [gameState?.currentActorId, myId]) // eslint-disable-line react-hooks/exhaustive-deps

  const phase       = gameState?.phase ?? 'waiting'
  const pot         = gameState?.pot ?? 0
  const currentBet  = gameState?.currentBet ?? 0
  const minRaise    = gameState?.minRaise ?? gameState?.bigBlind ?? 20
  const communityCards = gameState?.communityCards ?? []
  const myHoleCards = gameState?.myHoleCards ?? []

  const [me, p1, p2, p3, p4, p5] = getSeats(gameState?.players ?? [], myId)

  const isMyTurn = !!myId && gameState?.actingPlayerId === myId
  const toCall   = Math.max(0, currentBet - (me?.roundBet ?? 0))

  // ── Game BGM (completely independent from lobby) ───────────
  const [isGameMuted, setIsGameMuted] = useState(false)
  const bgmRef = useRef(null)

  useEffect(() => {
    const { bgmVolume } = getAudioSettings()
    const audio = new Audio('/audio/game/gameBgSound.mp3')
    audio.loop   = true
    audio.muted  = false
    audio.volume = 0.28 * bgmVolume
    bgmRef.current = audio

    const tryPlay = () => {
      if (!bgmRef.current || !bgmRef.current.paused) return
      bgmRef.current.play().catch(() => {})
    }

    tryPlay()
    document.addEventListener('click', tryPlay)

    return () => {
      document.removeEventListener('click', tryPlay)
      audio.pause()
      audio.src = ''
      bgmRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!bgmRef.current) return
    const { bgmVolume } = getAudioSettings()
    bgmRef.current.muted  = isGameMuted
    bgmRef.current.volume = isGameMuted ? 0 : 0.28 * bgmVolume
  }, [isGameMuted])

  const toggleGameMute = () => setIsGameMuted(m => !m)

  const [raiseAmt, setRaiseAmt] = useState(20)
  const [timeLeft, setTimeLeft] = useState(TURN_TIME)
  const [dealKey, setDealKey] = useState(0)
  const toCallRef = useRef(toCall)
  toCallRef.current = toCall
  const prevPhaseRef = useRef(null)

  // Reset raise slider whenever it becomes my turn
  useEffect(() => {
    if (isMyTurn) setRaiseAmt(minRaise)
  }, [gameState?.actingPlayerId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Deal animation + sounds when a new hand starts; card-flip sound on community cards
  useEffect(() => {
    const cur = gameState?.phase
    const prev = prevPhaseRef.current
    if (cur === 'pre_flop' && prev !== 'pre_flop') {
      setDealKey(k => k + 1)
      const playerCount = gameState?.players?.length ?? 4
      for (let i = 0; i < playerCount * 2; i++) setTimeout(() => play('cardDeal'), i * 110)
    }
    prevPhaseRef.current = cur
  }, [gameState?.phase]) // eslint-disable-line

  // Countdown timer — syncs with backend turnDeadline when available
  useEffect(() => {
    if (!isMyTurn) { setTimeLeft(TURN_TIME); return }
    const tick = () => {
      const dl = turnDeadlineRef.current
      if (dl) {
        const rem = Math.max(0, Math.ceil((dl - Date.now()) / 1000))
        setTimeLeft(rem)
        if (rem <= 0) doAction(toCallRef.current === 0 ? 'check' : 'fold')
      } else {
        setTimeLeft(prev => {
          if (prev <= 1) { doAction(toCallRef.current === 0 ? 'check' : 'fold'); return TURN_TIME }
          return prev - 1
        })
      }
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [gameState?.actingPlayerId, isMyTurn, doAction]) // eslint-disable-line

  const myHandStrength = myHoleCards.length > 0
    ? evalHand([...myHoleCards, ...communityCards])
    : null

  const revealedCards = winInfo && !winInfo.folded
    ? new Map((winInfo.players ?? []).map(p => [p.id, p.holeCards]))
    : new Map()

  const acting = (id) => !!id && gameState?.actingPlayerId === id

  const isPlaying = !!roomId && phase !== 'waiting'
  const isWaiting = !!roomId && phase === 'waiting'
  const isDisconnected = status === 'disconnected' || status === 'error'

  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [showRebuyModal,   setShowRebuyModal]   = useState(false)
  const [isEntering,       setIsEntering]       = useState(false)
  const [gameStarting,     setGameStarting]     = useState(false)
  const prevBalanceRef   = useRef(null)
  const prevRoomIdRef    = useRef(null)
  const enterPhaseRef    = useRef(null)
  const turnDeadlineRef  = useRef(null)
  turnDeadlineRef.current = gameState?.turnDeadline ?? null

  // Room entry overlay
  useEffect(() => {
    const prev = prevRoomIdRef.current
    prevRoomIdRef.current = roomId
    if (roomId && !prev) {
      setIsEntering(true)
      const t = setTimeout(() => setIsEntering(false), 1100)
      return () => clearTimeout(t)
    }
  }, [roomId])

  // Game start overlay
  useEffect(() => {
    const prev = enterPhaseRef.current
    enterPhaseRef.current = phase
    if (phase !== 'waiting' && prev === 'waiting') {
      setGameStarting(true)
      const t = setTimeout(() => setGameStarting(false), 900)
      return () => clearTimeout(t)
    }
  }, [phase])

  // Detect when chips reach 0 after a hand ends
  useEffect(() => {
    if (!myId || !gameState) return
    const myPlayer = gameState.players?.find(p => p.id === myId)
    const bal = myPlayer?.balance ?? null
    if (bal !== null && bal === 0 && prevBalanceRef.current > 0 && phase === 'waiting') {
      setShowRebuyModal(true)
    }
    if (bal !== null) prevBalanceRef.current = bal
  }, [phase, myId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleBack = () => {
    if (isDisconnected) {
      navigate('/')
      return
    }
    if (isPlaying) {
      setShowLeaveConfirm(true)
      return
    }
    if (roomId) {
      leaveRoom()   // roomId → null → lobby view shows automatically
    } else {
      navigate('/')
    }
  }

  const confirmLeave = () => {
    setShowLeaveConfirm(false)
    if (roomId) leaveRoom()
    // stay on page — lobby view shows when roomId becomes null
  }

  const handleRebuy = (chips) => {
    setShowRebuyModal(false)
    if (chips) {
      // Rejoin same room with new buy-in (leave then rejoin)
      const currentRoomId = roomId
      leaveRoom()
      setTimeout(() => joinRoom(currentRoomId, chips), 300)
    } else {
      leaveRoom()
      // stay on page — lobby view shows when roomId becomes null
    }
  }

  const raiseSliderMin = minRaise
  const raiseSliderMax = Math.max(minRaise, (me?.balance ?? 1000) - toCall)

  return (
    <div className="pt-page">

      {/* ── Leave confirm modal ── */}
      {showLeaveConfirm && (
        <div className="pt-modal-overlay">
          <div className="pt-modal">
            <p className="pt-modal-title">確定離開遊戲？</p>
            <p className="pt-modal-body">遊戲進行中，離開後本局視為棄牌，已下注籌碼將無法取回。</p>
            <div className="pt-modal-btns">
              <button type="button" className="pt-modal-cancel" onClick={() => setShowLeaveConfirm(false)}>繼續遊戲</button>
              <button type="button" className="pt-modal-confirm" onClick={confirmLeave}>確定離開</button>
            </div>
          </div>
        </div>
      )}

      {/* Room entry overlay */}
      {isEntering && (
        <div className="bt-enter-overlay">
          <div className="bt-enter-content">
            <div className="bt-enter-label">進入房間</div>
            <div className="bt-enter-id">#{roomId}</div>
          </div>
        </div>
      )}

      {/* Game start overlay */}
      {gameStarting && (
        <div className="bt-enter-overlay bt-game-start-overlay">
          <div className="bt-enter-content">
            <div className="bt-enter-id">遊戲開始</div>
          </div>
        </div>
      )}

      {/* ── Rebuy modal ── */}
      {showRebuyModal && (
        <div className="pt-modal-overlay">
          <div className="pt-modal">
            <p className="pt-modal-title">籌碼已用盡</p>
            <p className="pt-modal-body">是否補充籌碼繼續遊戲？</p>
            <div className="pt-modal-btns">
              <button type="button" className="pt-modal-cancel" onClick={() => handleRebuy(null)}>離開遊戲</button>
              <button type="button" className="pt-modal-confirm" onClick={() => handleRebuy(minBuyIn)}>補充 {new Intl.NumberFormat('en-US').format(minBuyIn)} 籌碼</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="pt-header">
        <button type="button" className="pt-back" onClick={handleBack}>
          <img src="/arrow.png" alt="返回" />
        </button>
        <div className="pt-header-info">
          {roomId
            ? <span className="pt-room-label">房間 #{roomId}</span>
            : <img src="/texas-holdem/texas-holdem.png" alt="德州撲克" className="pt-room-label-img" />
          }
          <span className="pt-blinds">盲注 {gameState?.smallBlind ?? 10} / {gameState?.bigBlind ?? 20}</span>
        </div>
        {isPlaying && <span className="pt-phase-badge">{PHASE_LABEL[phase]}</span>}
        <button type="button" className="pt-mute-btn" onClick={toggleGameMute} title={isGameMuted ? '開啟音樂' : '關閉音樂'}>
          <img src={isGameMuted ? '/enable-sound.png' : '/volume.png'} alt="" />
        </button>
      </header>

      {/* Error banner */}
      {error && <div className="pt-error-bar">{error}</div>}

      {/* ── Connecting overlay ── */}
      {(status === 'idle' || status === 'connecting') && (
        <div className="pt-connecting-overlay">
          <div className="pt-connecting-spinner" />
          <span className="pt-connecting-text">連線中…</span>
        </div>
      )}

      {/* ── Disconnected overlay ── */}
      {(status === 'disconnected' || status === 'error') && (
        <div className="pt-connecting-overlay">
          <span className="pt-connecting-text" style={{color:'#f06060'}}>連線中斷，請重新整理頁面</span>
        </div>
      )}

      {/* ── Lobby ── */}
      {!roomId && status === 'connected' && (
        <LobbyView
          status={status}
          rooms={rooms}
          buyIn={minBuyIn}
          onCreateRoom={(opts) => createRoom({ buyIn: minBuyIn, gameSlug: defaultGameSlug, ...opts })}
          onJoinRoom={(id) => joinRoom(id, minBuyIn)}
          onRefresh={refreshRooms}
        />
      )}

      {/* ── Waiting room ── */}
      {isWaiting && (
        <WaitingView
          gameState={gameState}
          myId={myId}
          onReady={setReady}
          onUnready={unready}
          onLeaveRoom={leaveRoom}
        />
      )}

      {/* ── Game table ── */}
      {isPlaying && (
        <>
          <div className="pt-top-container">
          {/* Seat 3 — top center */}
          <div className="pt-top-center">
            <Seat player={p3} isActing={acting(p3?.id)} revealedCards={revealedCards} seatIndex={2} dealKey={dealKey} />
          </div>

          {/* Middle: P2/P1 | Table | P4/P5 */}
          <div className="pt-middle">

            <div className="pt-side-col">
              <Seat player={p2} isActing={acting(p2?.id)} revealedCards={revealedCards} seatIndex={1} dealKey={dealKey} />
              <Seat player={p1} isActing={acting(p1?.id)} revealedCards={revealedCards} seatIndex={0} dealKey={dealKey} />
            </div>

            <div className="pt-table-center">
              <div className="pt-overlay">
                <div className="pt-community-cards">
                  {communityCards.map((c, i) => {
                    const bp = i < 3 ? 'f' : i === 3 ? 't' : 'r'
                    return <PlayingCard key={`${bp}${i}`} card={c} size="sm" />
                  })}
                  {Array(5 - communityCards.length).fill(0).map((_, i) => (
                    <div key={`ph-${i}`} className="pt-card-slot" />
                  ))}
                </div>
                <div className="pt-pot">
                  <div className="pt-pot-chips">
                    <img src="/chip-red.png" className="pt-pot-chip" alt="" />
                    <img src="/chip-purple.png" className="pt-pot-chip" alt="" />
                    <img src="/chip-blackgold.png" className="pt-pot-chip" alt="" />
                  </div>
                  <span className="pt-pot-label">底池</span>
                  <span className="pt-pot-amount">{fmt(pot)}</span>
                </div>
              </div>
            </div>

            <div className="pt-side-col">
              <Seat player={p4} isActing={acting(p4?.id)} revealedCards={revealedCards} seatIndex={3} dealKey={dealKey} />
              <Seat player={p5} isActing={acting(p5?.id)} revealedCards={revealedCards} seatIndex={4} dealKey={dealKey} />
            </div>

          </div>

          {/* Me — bottom center */}
          <div className="pt-bottom-center">
            <Seat player={me} isActing={isMyTurn} isMe myCards={myHoleCards} handStrength={myHandStrength}
              revealedCards={revealedCards} seatIndex={5} dealKey={dealKey} />
          </div>

          <WinOverlay winInfo={winInfo} />

          {/* Actions */}
          <div className={`pt-actions${isMyTurn ? '' : ' pt-actions-inactive'}`}>
            <div className="pt-countdown-wrap">
              {isMyTurn && (
                <>
                  <div className="pt-countdown-bar" style={{width:`${(timeLeft/TURN_TIME)*100}%`}} />
                  <span className="pt-countdown-num">{timeLeft}s</span>
                </>
              )}
              {!isMyTurn && (
                <span className="pt-waiting-inline">
                  等待 {(gameState?.players ?? []).find(p => p.id === gameState?.actingPlayerId)?.username ?? '…'} 行動中
                </span>
              )}
            </div>
            <div className="pt-raise-row">
              <span className="pt-raise-label">加注</span>
              <input
                type="range"
                className="pt-raise-slider"
                min={raiseSliderMin}
                max={raiseSliderMax}
                value={raiseAmt}
                disabled={!isMyTurn}
                onChange={e => setRaiseAmt(Number(e.target.value))}
              />
              <span className="pt-raise-val">共 {fmt(toCall + raiseAmt)}</span>
            </div>
            <div className="pt-btn-row">
              <PtBtn src="/texas-holdem/giveUp.png" alt="棄牌"
                disabled={!isMyTurn} onClick={() => doAction('fold')} />
              <PtBtn
                src={toCall === 0 ? '/texas-holdem/Pass.png' : '/texas-holdem/follow.png'}
                alt={toCall === 0 ? '過牌' : '跟注'}
                disabled={!isMyTurn}
                onClick={() => doAction(toCall === 0 ? 'check' : 'call')}
                amount={toCall > 0 ? fmt(toCall) : null}
                amountStyle={{ right: '27%', top: '30%', transform: 'none' }}
              />
              <PtBtn src="/texas-holdem/add.png" alt="加注"
                disabled={!isMyTurn} onClick={() => doAction('raise', raiseAmt)}
                amount={`+${fmt(raiseAmt)}`}
                amountStyle={{ right: '27%', top: '30%', transform: 'none' }} />
              <PtBtn src="/texas-holdem/all-in.png" alt="ALL IN"
                disabled={!isMyTurn} onClick={() => {
                  const chips = me?.balance ?? 0
                  chips <= toCall ? doAction('call') : doAction('raise', chips - toCall)
                }} />
            </div>
          </div>
          </div>

        </>
      )}

    </div>
  )
}

export default GameTablePage
