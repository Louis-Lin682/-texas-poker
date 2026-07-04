import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import PlayingCard from '../components/PlayingCard'
import LeaveConfirmModal from '../components/LeaveConfirmModal'
import { useBigTwoSocket } from '../hooks/useBigTwoSocket'
import { useGameStatus } from '../hooks/useGameStatus'
import { useAudio, muteHowl } from '../hooks/useAudio'

function fmt(n) {
  const abs = Math.abs(n)
  const str = abs >= 1000 ? `${(abs / 1000).toFixed(1)}K` : String(abs)
  return n < 0 ? `-${str}` : str
}

const HAND_ZH = {
  single: '單張', pair: '對子', triple: '三條',
  straight: '順子', flush: '同花', fullhouse: '葫蘆',
  quads: '四條', sf: '同花順',
}

const BT_PHASE = { waiting: '等待玩家', playing: '遊戲中', finished: '結算中' }

function BtBtn({ src, alt, onClick, disabled, amount, amountStyle, style }) {
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

// ── Lobby ─────────────────────────────────────────────────────────────────────
const BET_UNIT_PRESETS = [
  { label: '低限', betUnit: 10,  img: '/texas-holdem/room-green-felt-button.webp',   cardImg: '/texas-holdem/room-card-green-felt.webp'   },
  { label: '中限', betUnit: 50,  img: '/texas-holdem/room-golden-hall-button.webp',  cardImg: '/texas-holdem/room-card-golden-hall.webp'  },
  { label: '高限', betUnit: 100, img: '/texas-holdem/room-royal-hall-button.webp',   cardImg: '/texas-holdem/room-card-royal-hall.webp'   },
  { label: '豪華', betUnit: 500, img: '/texas-holdem/room-supreme-hall-button.webp', cardImg: '/texas-holdem/room-card-supreme-hall.webp' },
]

function LobbyView({ status, rooms, onCreateRoom, onJoinRoom, onRefresh, buyIn }) {
  const isConnected = status === 'connected'
  const [spinning, setSpinning] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(0)

  function handleRefresh() {
    if (spinning) return
    setSpinning(true); onRefresh()
    setTimeout(() => setSpinning(false), 700)
  }

  const selectedPreset = BET_UNIT_PRESETS[selectedIdx]
  const filteredRooms = rooms.filter(r => (r.betUnit ?? 10) === selectedPreset.betUnit)

  return (
    <div className="pt-lobby">
      <div className="pt-lobby-head">
        <span className="pt-lobby-title">選擇房間</span>
        <div className="pt-lobby-head-actions">
          <button type="button" className={`pt-lobby-refresh${spinning ? ' is-spinning' : ''}`} onClick={handleRefresh} title="重新整理">
            <img src="/reload.webp" alt="重整" />
          </button>
          <button type="button" className="pt-lobby-create"
            onClick={() => onCreateRoom({ buyIn, betUnit: selectedPreset.betUnit })}
            disabled={!isConnected}>
            + 建立新房間
          </button>
        </div>
      </div>

      <div className="pt-bet-unit-btns">
        {BET_UNIT_PRESETS.map((p, i) => (
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
          const preset = BET_UNIT_PRESETS.find(p => p.betUnit === (r.betUnit ?? 10)) ?? null
          return (
            <div key={r.id} className="pt-room-item">
              {preset && (
                <div className="pt-room-img-wrap">
                  <img src={preset.img} alt={preset.label} />
                </div>
              )}
              <div className="pt-room-info">
                <div className="pt-room-left">
                  <span className="pt-room-id-tag">#{r.id.slice(0, 6).toUpperCase()}</span>
                  <span className="pt-room-blinds">底分 {r.betUnit ?? 10}</span>
                  <span className="pt-room-players">{r.playerCount}/{r.maxPlayers} 玩家</span>
                </div>
                <div className="pt-room-right">
                  <span className="pt-room-phase">{BT_PHASE[r.phase] ?? r.phase}</span>
                  <button type="button" className="pt-room-join"
                    onClick={() => onJoinRoom(r.id, buyIn)}
                    disabled={!isConnected || r.phase !== 'waiting' || r.playerCount >= r.maxPlayers}>
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

// ── Waiting room ───────────────────────────────────────────────────────────────
function WaitingView({ gameState, myId, roomId, onReady, onUnready, onLeaveRoom }) {
  const players = gameState?.players ?? []
  const me = players.find(p => p.id === myId)
  const maxPlayers = gameState?.maxPlayers ?? 4
  const betUnit = gameState?.betUnit
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
      <div className="pt-wait-plaque">
        <img src="/waiting-player-plaque.webp" alt="" className="pt-wait-plaque-img" />
        <div className="pt-wait-plaque-body">
          <div className="pt-wait-plaque-count">
            <span className="pt-wait-plaque-num">{players.length}/{maxPlayers}</span>
            <span className="pt-wait-plaque-unit">位玩家</span>
          </div>
          <div className="pt-wait-plaque-meta">
            {roomId && <span className="pt-wait-plaque-room">#{roomId.slice(0, 6).toUpperCase()}</span>}
            {betUnit && <span className="pt-wait-plaque-blinds">底分 {betUnit}</span>}
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
              <img src="/chip-gold.webp" className="pt-wait-chip-img" alt="" />
              <span className="pt-wait-chips">{fmt(p.balance)}</span>
            </div>
          </div>
        ))}
      </div>

      {!isCountingDown && (
        <p className="pt-wait-hint">
          {players.length < 3
            ? `還需要 ${3 - players.length} 名玩家`
            : players.every(p => p.ready)
              ? '所有人已準備，即將開始…'
              : '等待所有人準備'}
        </p>
      )}

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        {isCountingDown && (
          <div className="pt-wait-countdown">
            <span className="pt-wait-cd-num">{cdLeft}</span>
            <span className="pt-wait-cd-label">秒後自動開始</span>
          </div>
        )}
        <button type="button" className="pt-wait-ready-btn"
          onClick={me?.ready ? onUnready : onReady} disabled={lockedIn}>
          <img src="/ready-button.webp" alt="" className="pt-wait-ready-img" />
          <span className="pt-wait-ready-text">{me?.ready ? '✓ 已準備好' : '我準備好了'}</span>
        </button>
        <button type="button" className="pt-wait-leave-btn" onClick={onLeaveRoom}>
          <img src="/leave-room-button.png" alt="" className="pt-wait-leave-img" />
        </button>
      </div>
    </div>
  )
}

// ── Game result overlay ────────────────────────────────────────────────────────
function ResultOverlay({ gameResult }) {
  if (!gameResult) return null
  const { scores, isPackage } = gameResult

  return (
    <div className="bt-result-overlay">
      <div className="bt-result-card">
        <div className="bt-result-title">
          {isPackage ? '🎉 包牌！結算' : '結算'}
        </div>
        <table className="bt-result-table">
          <thead>
            <tr>
              <th>名次</th>
              <th>玩家</th>
              <th>剩餘</th>
              <th>罰分</th>
              <th>增減</th>
            </tr>
          </thead>
          <tbody>
            {scores.map(s => (
              <tr key={s.id} className={s.rank === 1 ? 'bt-result-winner' : ''}>
                <td>{s.rank}</td>
                <td>{s.username}</td>
                <td>{s.cardsLeft}</td>
                <td>{s.penalty}</td>
                <td className={s.chipChange >= 0 ? 'bt-positive' : 'bt-negative'}>
                  {s.chipChange >= 0 ? `+${fmt(s.chipChange)}` : fmt(s.chipChange)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {isPackage && <div className="bt-result-package-note">包牌：所有人罰分 ×2</div>}
      </div>
    </div>
  )
}

// ── Opponent fan of card backs ────────────────────────────────────────────────
const OPP_CARD_W = 14
const OPP_PIVOT  = 72

function OppFan({ count, compact = false, cardW = OPP_CARD_W, cardH = 20, pivot = OPP_PIVOT }) {
  const n      = Math.min(count, 13)
  const spread = compact
    ? Math.min(38, Math.max(10, n * 3))
    : Math.min(62, Math.max(16, n * 4.2))
  const half   = cardW / 2
  return (
    <div className="bt-opp-fan" style={{ height: cardH }}>
      {Array(n).fill(0).map((_, idx) => {
        const t   = n > 1 ? idx / (n - 1) - 0.5 : 0
        const deg = t * spread
        return (
          <div
            key={idx}
            className="bt-opp-back"
            style={{
              left:            `calc(50% - ${half}px)`,
              width:           cardW,
              height:          cardH,
              zIndex:          idx,
              transform:       `rotate(${deg}deg)`,
              transformOrigin: `${half}px calc(100% + ${pivot}px)`,
            }}
          />
        )
      })}
    </div>
  )
}

function OppSeat({ player, isActing, winners, compact = false, cardW, cardH, pivot }) {
  const rank  = winners?.find(w => w.id === player.id)?.rank
  const count = player.cardCount
  return (
    <div className={`bt-opp${isActing ? ' is-acting' : ''}${player.status === 'finished' ? ' is-finished' : ''}`}>
      {isActing && <div className="pt-acting-arrow" />}
      <div className="bt-opp-top">
        <div className="bt-opp-avatar"><img src={player.avatar} alt="" /></div>
        {!compact && (
          <div className="bt-opp-info">
            <div className="bt-opp-name">{player.username}</div>
            <div className="bt-opp-bal">{fmt(player.balance)}</div>
          </div>
        )}
      </div>
      {compact && (
        <div className="bt-opp-info" style={{ alignItems: 'center' }}>
          <div className="bt-opp-name">{player.username}</div>
          <div className="bt-opp-bal">{fmt(player.balance)}</div>
        </div>
      )}
      {player.status === 'finished'
        ? <span className="bt-opp-done">第 {rank ?? '?'} 名</span>
        : <>
            <OppFan count={count} compact={compact} cardW={cardW} cardH={cardH} pivot={pivot} />
            <span className="bt-opp-count">{count}張</span>
          </>
      }
    </div>
  )
}

// ── Hint logic ────────────────────────────────────────────────────────────────
const BT_RANKS_H = ['3','4','5','6','7','8','9','T','J','Q','K','A','2']
const BT_SUITS_H = ['c','d','h','s']
function btValH(c) { return BT_RANKS_H.indexOf(c.slice(0,-1)) * 4 + BT_SUITS_H.indexOf(c.slice(-1)) }

function sort5H(cards) { return [...cards].sort((a, b) => btValH(a) - btValH(b)) }

function classify5H(sorted) {
  const ri      = sorted.map(c => BT_RANKS_H.indexOf(c.slice(0,-1)))
  const suits   = sorted.map(c => c.slice(-1))
  const isFlush = new Set(suits).size === 1
  const riS     = [...ri].sort((a, b) => a - b)
  const isConsec = riS.every((r, i) => i === 0 || r === riS[i-1] + 1)
  const isA2345  = riS[0]===0 && riS[1]===1 && riS[2]===2 && riS[3]===11 && riS[4]===12
  const cnt = {}
  for (const r of ri) cnt[r] = (cnt[r] ?? 0) + 1
  const counts = Object.values(cnt).sort((a, b) => b - a)
  const highKey = btValH(sorted[sorted.length - 1])

  if ((isConsec || isA2345) && isFlush) {
    const key = isA2345 ? btValH(sorted.find(c => c.slice(0,-1) === '5')) : highKey
    return { typeRank: 7, key }
  }
  if (counts[0] === 4) {
    const qIdx   = Number(Object.entries(cnt).find(([,v]) => v === 4)[0])
    const qCards = sorted.filter(c => BT_RANKS_H.indexOf(c.slice(0,-1)) === qIdx)
    return { typeRank: 6, key: btValH(qCards[qCards.length - 1]) }
  }
  if (counts[0] === 3 && counts[1] === 2) {
    const tIdx   = Number(Object.entries(cnt).find(([,v]) => v === 3)[0])
    const tCards = sorted.filter(c => BT_RANKS_H.indexOf(c.slice(0,-1)) === tIdx)
    return { typeRank: 5, key: btValH(tCards[tCards.length - 1]) }
  }
  if (isFlush)                return { typeRank: 4, key: highKey }
  if (isConsec || isA2345) {
    const key = isA2345 ? btValH(sorted.find(c => c.slice(0,-1) === '5')) : highKey
    return { typeRank: 3, key }
  }
  return null
}

function beats5H(a, b) {
  if (a.typeRank !== b.typeRank) return a.typeRank > b.typeRank
  return a.key > b.key
}

function getHint(hand, pile) {
  if (!hand.length) return []
  const sorted = [...hand].sort((a, b) => btValH(a) - btValH(b))

  if (!pile) {
    // Must play 3c on the very first play of the game
    if (sorted.includes('3c')) return ['3c']
    // Free turn: suggest weakest pair if available, otherwise lowest single
    const groups = {}
    for (const c of sorted) { const r = c.slice(0,-1); (groups[r] ??= []).push(c) }
    for (const r of BT_RANKS_H) {
      if ((groups[r]?.length ?? 0) >= 2) return groups[r].slice(0, 2)
    }
    return [sorted[0]]
  }

  const n = pile.cards.length
  const topVal = Math.max(...pile.cards.map(btValH))

  if (n === 1) {
    const beat = sorted.find(c => btValH(c) > topVal)
    return beat ? [beat] : []
  }

  if (n === 2 || n === 3) {
    const groups = {}
    for (const c of sorted) { const r = c.slice(0,-1); (groups[r] ??= []).push(c) }
    for (const r of BT_RANKS_H) {
      const g = groups[r]
      if (!g || g.length < n) continue
      const slice = g.slice(0, n)
      if (Math.max(...slice.map(btValH)) > topVal) return slice
    }
    return []
  }

  if (n === 5) {
    const pileCls = classify5H(sort5H(pile.cards))
    if (!pileCls) return []
    let best = null
    const h = sorted
    for (let a = 0; a < h.length - 4; a++)
      for (let b = a+1; b < h.length - 3; b++)
        for (let c = b+1; c < h.length - 2; c++)
          for (let d = c+1; d < h.length - 1; d++)
            for (let e = d+1; e < h.length; e++) {
              const combo = sort5H([h[a],h[b],h[c],h[d],h[e]])
              const cls   = classify5H(combo)
              if (!cls || !beats5H(cls, pileCls)) continue
              if (!best || beats5H(cls, best.cls) === false) {
                // keep the weakest combo that still beats pile
                if (!best || (cls.typeRank < best.cls.typeRank ||
                    (cls.typeRank === best.cls.typeRank && cls.key < best.cls.key))) {
                  best = { cls, cards: combo }
                }
              }
            }
    return best?.cards ?? []
  }

  return []
}

// ── Deal sound ────────────────────────────────────────────────────────────────

// ── Game view ─────────────────────────────────────────────────────────────────
const AFK_SECS = 30

function useIsPC() {
  const [isPC, setIsPC] = useState(() => window.innerWidth >= 768)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const fn = e => setIsPC(e.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  return isPC
}

function GameView({ gameState, myId, lastAction, gameError, onPlay, onPass }) {
  const isPC = useIsPC()
  const CARD_W = isPC ? 56 : 50
  const PIVOT_Y = isPC ? 220 : 180
  const [selected,    setSelected]    = useState([])
  const [isDealing,   setIsDealing]   = useState(false)
  const [turnSeconds, setTurnSeconds] = useState(null)
  const [hintMsg,     setHintMsg]     = useState(null)
  const hintMsgTimer = useRef(null)
  const prevPlayerRef  = useRef(null)
  const prevHandLenRef = useRef(0)
  const afkIntervalRef = useRef(null)
  const turnStartRef   = useRef(null)

  const myHand    = gameState?.myHand ?? []
  const players   = gameState?.players ?? []
  const pile      = gameState?.pile ?? null
  const currentId = gameState?.currentPlayerId ?? null
  const passCount = gameState?.passCount ?? 0
  const winners   = gameState?.winners ?? []
  const isMyTurn  = currentId === myId
  const myPlayer  = players.find(p => p.id === myId) ?? null
  const opponents = players.filter(p => p.id !== myId)
  const canPass   = !!pile && pile.playerId !== myId
  const pileOwner = pile ? players.find(p => p.id === pile.playerId)?.username : null
  const pileKey   = pile ? pile.cards.join(',') : 'empty'
  const mustFirst = !pile && myHand.includes('3c')

  // Seat assignment: right=0, top=1, left=2 (clockwise from player's right)
  const oppRight = opponents[0] ?? null
  const oppTop   = opponents[1] ?? null
  const oppLeft  = opponents[2] ?? null

  const n        = myHand.length
  const SPREAD   = Math.min(60, Math.max(24, n * 5.5))
  const halfCard = CARD_W / 2
  const fanH     = isPC ? 110 : 80
  const cardSize = isPC ? 'lg' : 'md'
  const pileSize = isPC ? 'lg' : 'sm'
  const oppCardW = isPC ? CARD_W : 14
  const oppCardH = isPC ? 80 : 20
  const oppPivot = isPC ? 220 : 72

  useEffect(() => {
    if (prevPlayerRef.current !== currentId) {
      setSelected([])
      prevPlayerRef.current = currentId
    }
  }, [currentId])

  useEffect(() => {
    const prev = prevHandLenRef.current
    prevHandLenRef.current = myHand.length
    if (myHand.length > 0 && prev === 0) {
      setIsDealing(true)
      const t = setTimeout(() => setIsDealing(false), myHand.length * 80 + 500)
      return () => clearTimeout(t)
    }
  }, [myHand.length])

  // AFK countdown — restarts on every state_update while it's my turn
  useEffect(() => {
    if (afkIntervalRef.current) { clearInterval(afkIntervalRef.current); afkIntervalRef.current = null }
    if (!isMyTurn) { setTurnSeconds(null); return }
    turnStartRef.current = Date.now()
    setTurnSeconds(AFK_SECS)
    afkIntervalRef.current = setInterval(() => {
      const left = Math.max(0, AFK_SECS - Math.floor((Date.now() - turnStartRef.current) / 1000))
      setTurnSeconds(left)
      if (left === 0) { clearInterval(afkIntervalRef.current); afkIntervalRef.current = null }
    }, 500)
    return () => { if (afkIntervalRef.current) clearInterval(afkIntervalRef.current) }
  }, [gameState, isMyTurn])

  function toggleCard(card) {
    setSelected(prev => prev.includes(card) ? prev.filter(c => c !== card) : [...prev, card])
  }
  function handlePlay() { onPlay(selected); setSelected([]) }
  function handleHint() {
    const hint = getHint(myHand, pile)
    if (hint.length === 0) {
      clearTimeout(hintMsgTimer.current)
      setHintMsg('沒有可出的牌組')
      hintMsgTimer.current = setTimeout(() => setHintMsg(null), 2000)
      return
    }
    setSelected(hint)
  }

  return (
    <div className="bt-game">

      {/* ── Arena: table + 3 opponent seats ── */}
      <div className="bt-arena">

        {/* Top opponent */}
        <div className="bt-seat bt-seat-top">
          {oppTop && <OppSeat player={oppTop} isActing={currentId === oppTop.id} winners={winners} cardW={oppCardW} cardH={oppCardH} pivot={oppPivot} />}
        </div>

        {/* Left opponent */}
        <div className="bt-seat bt-seat-left">
          {oppLeft && <OppSeat player={oppLeft} isActing={currentId === oppLeft.id} winners={winners} compact cardW={oppCardW} cardH={oppCardH} pivot={oppPivot} />}
        </div>

        {/* ── Round table ── */}
        <div className="bt-table-wrap">
          <div className="bt-table-surface">
            <div className={`bt-turn-bar${isMyTurn ? ' bt-my-turn' : ''}${isMyTurn && turnSeconds !== null && turnSeconds <= 10 ? ' bt-turn-urgent' : ''}`}>
              {hintMsg
                ? hintMsg
                : isMyTurn
                  ? `✦ 輪到你行動${turnSeconds !== null ? `（${turnSeconds}s）` : ''}`
                  : `等待 ${players.find(p => p.id === currentId)?.username ?? '…'} 出牌`
              }
            </div>

            <div className="bt-pile-zone">
              {pile ? (
                <div key={pileKey} className="bt-pile-inner">
                  <div className="bt-pile-who">
                    <span className="bt-pile-owner">{pileOwner}</span>
                    <span className="bt-pile-type">{HAND_ZH[pile.type] ?? pile.type}</span>
                  </div>
                  <div className="bt-pile-stack">
                    <div className="bt-pile-ghost bt-pile-ghost-0" />
                    <div className="bt-pile-ghost bt-pile-ghost-1" />
                    <div className="bt-pile-ghost bt-pile-ghost-2" />
                    <div className="bt-pile-cards">
                      {pile.cards.map((c, i) => <PlayingCard key={i} card={c} size={pileSize} />)}
                    </div>
                  </div>
                </div>
              ) : null}
              {passCount > 0 && <div className="bt-pass-count">已跳過 {passCount} 人</div>}
            </div>


          </div>
        </div>

        {/* Right opponent */}
        <div className="bt-seat bt-seat-right">
          {oppRight && <OppSeat player={oppRight} isActing={currentId === oppRight.id} winners={winners} compact cardW={oppCardW} cardH={oppCardH} pivot={oppPivot} />}
        </div>
        {/* ── Bottom: error + buttons + my fan ── */}
      <div className="bt-bottom">

        <div className="bt-action-bar">
          <BtBtn src="/big-two/hint.webp" alt="提示"
            disabled={!isMyTurn} onClick={handleHint} />
          <BtBtn src="/big-two/stop.webp" alt="不出"
            disabled={!isMyTurn || !canPass} onClick={onPass} />
          <BtBtn src="/big-two/playing-cards.webp" alt="出牌"
            disabled={!isMyTurn || selected.length === 0} onClick={handlePlay}
            amount={selected.length > 0 ? `(${selected.length})` : null}
            amountStyle={{ right: '25%', top: '25%', transform: 'none' }} />
        </div>

        <div className="bt-hand-area">
          <div className="bt-my-hand" style={{ height: fanH + 'px' }}>
            {myHand.map((card, idx) => {
              const isSel    = selected.includes(card)
              const t        = n > 1 ? idx / (n - 1) - 0.5 : 0
              const angleDeg = t * SPREAD
              const liftPx   = isSel ? 28 : 0
              return (
                <button
                  key={card}
                  type="button"
                  className={`bt-card-btn${isSel ? ' is-selected' : ''}${isDealing ? ' is-dealing' : ''}`}
                  style={{
                    left:            `calc(50% - ${halfCard}px)`,
                    zIndex:          idx,
                    transform:       `rotate(${angleDeg}deg) translateY(${-liftPx}px)`,
                    transformOrigin: `${halfCard}px calc(100% + ${PIVOT_Y}px)`,
                    '--deal-i':      idx,
                  }}
                  onClick={() => isMyTurn && toggleCard(card)}
                  disabled={!isMyTurn}
                >
                  <PlayingCard card={card} size={cardSize} />
                </button>
              )
            })}
          </div>
           {myPlayer && (
            <div className="bt-me-info">
              <div className={`bt-opp-avatar${isMyTurn ? ' is-acting' : ''}`}><img src={myPlayer.avatar} alt="" /></div>
              <div className="bt-me-stats">
                <div className="bt-opp-name">{myPlayer.username}</div>
                <div className="bt-opp-bal">{fmt(myPlayer.balance)}</div>
              </div>
          </div>
        )}
        </div>

      </div>

      </div>

    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────
function BigTwoTablePage({ auth }) {
  const navigate = useNavigate()
  const location = useLocation()
  const gameStatus = useGameStatus('big-two')
  const minBuyIn = location.state?.buyIn ?? parseInt(localStorage.getItem('cfg_min_buy_in') || '3000', 10)
  const lastChipsRef = useRef(minBuyIn)
  const {
    status, rooms, roomId, myId, gameState, gameResult, lastAction,
    error, cashoutBalance, wasKicked,
    refreshRooms, createRoom, joinRoom, leaveRoom, setReady, unready, doAction,
  } = useBigTwoSocket({ minBuyIn })

  useEffect(() => {
    if (!wasKicked) return
    const t = setTimeout(() => navigate('/'), 3000)
    return () => clearTimeout(t)
  }, [wasKicked]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (cashoutBalance !== null) auth?.applyBalance?.(cashoutBalance)
  }, [cashoutBalance]) // eslint-disable-line react-hooks/exhaustive-deps

  const BT_VOICE = {
    single: 'bt_single', pair: 'bt_pair', triple: 'bt_triple',
    straight: 'bt_straight', flush: 'bt_flush', fullhouse: 'bt_fullhouse',
    quads: 'bt_quads', sf: 'bt_sf',
  }
  useEffect(() => {
    if (!lastAction) return
    if (lastAction.action === 'pass') { play('bt_pass'); return }
    const key = BT_VOICE[lastAction.handType]
    if (key) play(key)
  }, [lastAction]) // eslint-disable-line react-hooks/exhaustive-deps

  const phase     = gameState?.phase ?? 'waiting'
  const isWaiting = !!roomId && phase === 'waiting'
  const isPlaying = !!roomId && (phase === 'playing' || phase === 'finished')
  const betUnit   = gameState?.betUnit ?? 10

  const myBtPlayer = gameState?.players?.find(p => p.id === myId)
  if (myBtPlayer?.balance != null) lastChipsRef.current = myBtPlayer.balance

  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [isEntering,       setIsEntering]       = useState(false)
  const [gameStarting,     setGameStarting]     = useState(false)
  const prevRoomIdRef = useRef(null)
  const prevPhaseRef  = useRef(null)

  useEffect(() => {
    const prev = prevRoomIdRef.current
    prevRoomIdRef.current = roomId
    if (roomId && !prev) {
      setIsEntering(true)
      const t = setTimeout(() => setIsEntering(false), 1100)
      return () => clearTimeout(t)
    }
  }, [roomId])

  useEffect(() => {
    const prev = prevPhaseRef.current
    prevPhaseRef.current = phase
    if (phase === 'playing' && prev === 'waiting') {
      setGameStarting(true)
      const t = setTimeout(() => setGameStarting(false), 900)
      return () => clearTimeout(t)
    }
  }, [phase])

  // ── BGM ──
  const { play, stop, preload } = useAudio()
  const [isGameMuted, setIsGameMuted] = useState(false)

  useEffect(() => {
    preload(['bt_single', 'bt_pair', 'bt_triple', 'bt_straight', 'bt_flush', 'bt_fullhouse', 'bt_quads', 'bt_sf', 'bt_pass'])
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    play('bigTwoBgm', { volume: 0.28, loop: true })
    return () => stop('bigTwoBgm')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    muteHowl('bigTwoBgm', isGameMuted)
  }, [isGameMuted])

  const toggleGameMute = () => setIsGameMuted(m => !m)

  // ── Deal sound: play fly_card for each card when hand arrives ──
  const prevHandLenRef = useRef(0)
  useEffect(() => {
    const len = gameState?.myHand?.length ?? 0
    const prev = prevHandLenRef.current
    prevHandLenRef.current = len
    if (len > 0 && prev === 0) {
      for (let i = 0; i < len; i++) setTimeout(() => play('cardDeal'), i * 110)
    }
  }, [gameState?.myHand]) // eslint-disable-line

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

  const handleBack = () => {
    if (roomId) { setShowLeaveConfirm(true); return }
    navigate('/')
  }

  const confirmLeave = () => {
    setShowLeaveConfirm(false)
    leaveRoom()
    // stay on page — lobby view shows when roomId becomes null
  }

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

      {/* Leave confirm */}
      {showLeaveConfirm && (
        <LeaveConfirmModal
          body="遊戲進行中，離開後手牌自動棄置，籌碼結算後退回。"
          onConfirm={confirmLeave}
          onCancel={() => setShowLeaveConfirm(false)}
        />
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

      {/* Result overlay */}
      <ResultOverlay gameResult={gameResult} />

      {/* Overlays before header — mirrors ThunderJoker pattern so pt-header z-index:10 always paints above on iOS */}
      {(status === 'idle' || status === 'connecting') && (
        <div className="pt-connecting-overlay">
          <div className="pt-connecting-spinner" />
          <span className="pt-connecting-text">連線中…</span>
        </div>
      )}
      {(status === 'disconnected' || status === 'error') && (
        <div className="pt-connecting-overlay">
          <span className="pt-connecting-text" style={{color:'#f06060'}}>連線中斷，請重新整理頁面</span>
        </div>
      )}

      {/* Header */}
      <div className="pt-header-con">
        <header className="pt-header">
          <button type="button" className="pt-back" onClick={handleBack}>
            <img src="/arrow.webp" alt="返回" />
          </button>
          <div className="pt-header-info">
            {roomId
              ? <span className="pt-room-label">房間 #{roomId}</span>
              : <img src="/big-two/big-two.webp" alt="大老二" className="pt-room-label-img" />
            }
            {roomId && <span className="pt-blinds">底分 {betUnit}</span>}
          </div>
          {isPlaying && <span className="pt-phase-badge">{BT_PHASE[phase]}</span>}
          <button type="button" className="pt-mute-btn" onClick={toggleGameMute} title={isGameMuted ? '開啟音樂' : '關閉音樂'}>
            <img src={isGameMuted ? '/enable-sound.webp' : '/volume.webp'} alt="" />
          </button>
        </header>
      </div>

      <div className="pt-content">
      {error && <div className="pt-error-bar">{error}</div>}

      {!roomId && status === 'connected' && (
        <LobbyView
          status={status}
          rooms={rooms}
          buyIn={minBuyIn}
          onCreateRoom={(opts) => createRoom({ ...opts, buyIn: lastChipsRef.current })}
          onJoinRoom={(id) => joinRoom(id, lastChipsRef.current)}
          onRefresh={refreshRooms}
        />
      )}

      {isWaiting && (
        <WaitingView
          gameState={gameState}
          myId={myId}
          roomId={roomId}
          onReady={setReady}
          onUnready={unready}
          onLeaveRoom={leaveRoom}
        />
      )}

      {isPlaying && (
        <GameView
          gameState={gameState}
          myId={myId}
          lastAction={lastAction}
          gameError={error}
          onPlay={(cards) => doAction('play', cards)}
          onPass={() => doAction('pass')}
        />
      )}

      </div>
    </div>
  )
}

export default BigTwoTablePage
