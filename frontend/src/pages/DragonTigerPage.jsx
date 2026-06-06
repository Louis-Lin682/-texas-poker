import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useDragonTigerSocket } from '../hooks/useDragonTigerSocket'
import { useAudio } from '../hooks/useAudio'

const CHIPS = [
  { value: 20,   img: '/chip-red.png',      label: '20' },
  { value: 50,   img: '/chip-blue.png',     label: '50' },
  { value: 100,  img: '/chip-green.png',    label: '100' },
  { value: 500,  img: '/chip-purple.png',   label: '500' },
  { value: 1000, img: '/chip-blackgold.png', label: '1K' },
]

const SUIT_RED   = new Set(['♥', '♦'])
const MAX_VISIBLE = 5
const BET_LABELS  = { dragon: '龍', tie: '和', tiger: '虎' }

function fmt(n) {
  return new Intl.NumberFormat('en-US').format(n ?? 0)
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

function ZoneBetDisplay({ placements, totalBet, myBet }) {
  if (placements.length === 0 && totalBet === 0) return null
  return (
    <>
      {placements.map(p => (
        <img
          key={p.id}
          src={p.img}
          alt=""
          draggable={false}
          className="dt-placed-chip"
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
          <span className="dt-zone-bet-total">{fmt(totalBet)}</span>
          {myBet > 0 && <span className="dt-zone-my-bet">我 {fmt(myBet)}</span>}
        </div>
      )}
    </>
  )
}

function ResultOverlay({ result, myPayout, myTotalBet }) {
  if (!result) return null

  const net  = myPayout - myTotalBet
  const won  = net > 0
  const isTie = result === 'tie'

  const resultImg  = result === 'dragon' ? '/DragonTiger/game/dragon.png'
    : result === 'tiger'  ? '/DragonTiger/game/tiger.png'
    : '/DragonTiger/game/he.png'
  const outcomeImg = isTie ? '/DragonTiger/game/ju.png' : '/DragonTiger/game/sheng.png'

  let netClass = 'is-tie'
  let netText  = '本局損益：0'
  if (myTotalBet > 0) {
    if (won)      { netClass = 'is-win';  netText = `本局損益：+${fmt(net)}` }
    else if (net < 0) { netClass = 'is-lose'; netText = `本局損益：-${fmt(Math.abs(net))}` }
  }

  return (
    <div className="dt-result-overlay">
      <div className="dt-result-inner">
        <div className="dt-result-chars">
          <img src={resultImg}  alt={result}  className="dt-result-char" />
          <img src={outcomeImg} alt="outcome" className="dt-result-char" />
        </div>
        {myTotalBet > 0 && (
          <div className={`dt-result-net ${netClass}`}>{netText}</div>
        )}
      </div>
    </div>
  )
}

export default function DragonTigerPage({ auth }) {
  const navigate  = useNavigate()
  const location  = useLocation()
  const buyIn     = location.state?.buyIn ?? 3000
  const { play, preload } = useAudio()

  const {
    status, rooms, roomId, myId, gameState, error,
    cashoutBalance, refreshRooms, createRoom, joinRoom, leaveRoom,
    placeBet,
  } = useDragonTigerSocket({ minBuyIn: buyIn })

  const [selectedChip,    setSelectedChip]    = useState(CHIPS[0])
  const [chipPlacements,  setChipPlacements]  = useState({ dragon: [], tie: [], tiger: [] })
  const [betActivities,   setBetActivities]   = useState([])
  const [flashingPlayers, setFlashingPlayers] = useState(new Set())
  const [showAllPlayers,  setShowAllPlayers]  = useState(false)

  const joinedRef         = useRef(false)
  const prevPhase         = useRef(null)
  const prevRound         = useRef(null)
  const chipZRef          = useRef(1)
  const prevPlayerBetsRef = useRef({})

  // Preload audio on mount
  useEffect(() => {
    preload(['dt_deal', 'dt_chips', 'dt_flip'])
  }, [preload])

  // Auto-join a dragon-tiger room
  useEffect(() => {
    if (status !== 'connected' || joinedRef.current || roomId) return
    const dtRoom = rooms.find(r => r.gameType === 'dragon-tiger' && r.playerCount < r.maxPlayers)
    if (dtRoom) {
      joinedRef.current = true
      joinRoom(dtRoom.id, buyIn)
    } else if (rooms.length === 0) {
      joinedRef.current = true
      createRoom({ buyIn })
    }
  }, [status, rooms, roomId, buyIn, joinRoom, createRoom])

  // Refresh rooms once connected
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
      setChipPlacements({ dragon: [], tie: [], tiger: [] })
      chipZRef.current = 1
      prevRound.current = roundId
    }

    if (phase !== prevPhase.current) {
      if (phase === 'betting' && prevPhase.current !== null) {
        play('dt_deal')                          // new cards placed face-down (skip on first connect)
      }
      if (phase === 'dealing') {
        play('dt_flip')                          // dragon flips immediately
        setTimeout(() => play('dt_flip'), 600)   // tiger flips 600ms later
      }
      prevPhase.current = phase
    }
  }, [gameState, play])

  // Bet activity feed + player card flash detection
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
        for (const z of ['dragon', 'tie', 'tiger']) {
          const diff = (p.bets[z] || 0) - (prev[z] || 0)
          if (diff > 0) {
            changed = true
            if (p.id !== myId) {
              // Chip visual for other player
              const chipImg = [...CHIPS].reverse().find(c => c.value <= diff)?.img ?? CHIPS[0].img
              const chipId  = Date.now() + Math.random()
              setChipPlacements(prev => ({
                ...prev,
                [z]: [...prev[z], {
                  id:  chipId,
                  img: chipImg,
                  x:   rnd(25, 75),
                  y:   rnd(30, 70),
                  rot: rnd(-20, 20),
                  z:   chipZRef.current++,
                }],
              }))
              // Activity feed toast
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
    play('dt_chips')
    const placement = {
      id:  Date.now() + Math.random(),
      img: selectedChip.img,
      x:   rnd(25, 75),
      y:   rnd(30, 70),
      rot: rnd(-20, 20),
      z:   chipZRef.current++,
    }
    setChipPlacements(prev => ({ ...prev, [zone]: [...prev[zone], placement] }))
  }

  // ── Derived state ──────────────────────────────────────────

  const phase      = gameState?.phase ?? 'idle'
  const countdown  = gameState?.countdown ?? 0
  const players    = gameState?.players ?? []
  const dragonCard = gameState?.dragonCard ?? null
  const tigerCard  = gameState?.tigerCard  ?? null
  const result     = gameState?.result     ?? null

  const me = players.find(p => p.id === myId)
  const myBets     = me?.bets     ?? { dragon: 0, tie: 0, tiger: 0 }
  const myPayout   = me?.payout   ?? 0
  const myTotalBet = myBets.dragon + myBets.tie + myBets.tiger

  const zoneTotals = { dragon: [], tie: [], tiger: [] }
  for (const p of players) {
    if (p.bets.dragon > 0) zoneTotals.dragon.push(p.bets.dragon)
    if (p.bets.tie    > 0) zoneTotals.tie.push(p.bets.tie)
    if (p.bets.tiger  > 0) zoneTotals.tiger.push(p.bets.tiger)
  }

  const sortedPlayers  = me ? [me, ...players.filter(p => p.id !== myId)] : [...players]
  const visiblePlayers = sortedPlayers.slice(0, MAX_VISIBLE)
  const overflowCount  = Math.max(0, sortedPlayers.length - MAX_VISIBLE)

  const isBetting = phase === 'betting'
  const isResult  = phase === 'result'
  // Cards face-up during dealing (flip animation) and result; face-down during betting
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

        {/* Cards */}
        <div className="dt-cards-area">
          <div className="dt-card-label dt-label-dragon">龍</div>
          <div className="dt-cards-row">
            <PlayingCard card={dragonCard} faceDown={faceDown} delay={0} />
            <PlayingCard card={tigerCard}  faceDown={faceDown} delay={600} />
          </div>
          <div className="dt-card-label dt-label-tiger">虎</div>
        </div>

        {/* Bet zones */}
        <div className="dt-zones-area">
          {['dragon', 'tie', 'tiger'].map(key => (
            <button
              key={key}
              type="button"
              className={`dt-zone dt-zone-${key} ${isBetting ? 'is-active' : ''}`}
              onClick={() => handleZoneTap(key)}
              disabled={!isBetting}
              data-no-global-click="true"
            >
              <ZoneBetDisplay
                placements={chipPlacements[key]}
                totalBet={zoneTotals[key].reduce((a, b) => a + b, 0)}
                myBet={myBets[key]}
              />
            </button>
          ))}
        </div>

        {/* Result overlay */}
        {isResult && (
          <ResultOverlay
            result={result}
            myPayout={myPayout}
            myTotalBet={myTotalBet}
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

      {/* My bets summary — under player cards */}
      {myTotalBet > 0 && (
        <div className="dt-bet-summary-bar">
          {myBets.dragon > 0 && <span className="dt-bet-tag dt-bet-dragon">龍：{fmt(myBets.dragon)}</span>}
          {myBets.tie    > 0 && <span className="dt-bet-tag dt-bet-tie">和：{fmt(myBets.tie)}</span>}
          {myBets.tiger  > 0 && <span className="dt-bet-tag dt-bet-tiger">虎：{fmt(myBets.tiger)}</span>}
        </div>
      )}

      {/* Bottom panel */}
      {phase === 'betting' && (
        <div className="dt-bottom-panel">
          <div className="dt-chip-tray">
            {CHIPS.map(chip => (
              <button
                key={chip.value}
                type="button"
                className={`dt-chip-btn ${selectedChip.value === chip.value ? 'is-selected' : ''}`}
                onClick={() => setSelectedChip(chip)}
                data-no-global-click="true"
              >
                <img src={chip.img} alt={chip.label} className="dt-chip-img" />
                <span className={`dt-chip-label ${selectedChip.value === chip.value ? 'is-selected' : ''}`}>
                  {chip.label}
                </span>
              </button>
            ))}
          </div>
          <div className="dt-chip-hint">已選面額：{fmt(selectedChip.value)}</div>
        </div>
      )}

      {phase === 'result' && (
        <div className="dt-action-bar">
          <div className="dt-wait-next-round">
            <img src="/DragonTiger/DragonTigerBtn.png" alt="" className="dt-ready-btn-bg" draggable={false} />
            <span className="dt-ready-btn-text dt-wait-text">結算中…</span>
          </div>
        </div>
      )}

      {phase === 'idle' && (
        <div className="dt-action-bar">
          <div className="dt-wait-next-round">
            <img src="/DragonTiger/DragonTigerBtn.png" alt="" className="dt-ready-btn-bg" draggable={false} />
            <span className="dt-ready-btn-text dt-wait-text">等待下一局…</span>
          </div>
        </div>
      )}

      {/* Cashout notice */}
      {cashoutBalance !== null && (
        <div className="dt-cashout-notice">
          已結算 — 帳戶餘額 {fmt(cashoutBalance)}
        </div>
      )}

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
