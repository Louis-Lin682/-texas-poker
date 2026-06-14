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
const BET_UNITS = [10, 50, 100, 500]
const MIN_UNIT_MULTIPLE = 50  // need at least 50× betUnit to sit down

function LobbyView({ status, rooms, onCreateRoom, onJoinRoom, onRefresh, buyIn }) {
  const isConnected = status === 'connected'
  const [spinning, setSpinning] = useState(false)

  const canAfford = (u) => buyIn >= u * MIN_UNIT_MULTIPLE

  const [betUnit, setBetUnit] = useState(
    () => BET_UNITS.find(canAfford) ?? BET_UNITS[0]
  )

  function handleRefresh() {
    if (spinning) return
    setSpinning(true)
    onRefresh()
    setTimeout(() => setSpinning(false), 700)
  }

  return (
    <div className="pt-lobby">
      <div className="pt-lobby-head">
        <span className="pt-lobby-title">選擇房間</span>
        <button type="button" className={`pt-lobby-refresh${spinning ? ' is-spinning' : ''}`} onClick={handleRefresh} title="重新整理">
          <img src="/reload.png" alt="重整" />
        </button>
      </div>

      <div className="pt-bet-unit-row">
        <span className="pt-bet-unit-label">底分</span>
        <div className="pt-bet-unit-btns">
          {BET_UNITS.map(u => {
            const ok = canAfford(u)
            return (
              <button
                key={u}
                type="button"
                className={`pt-bet-unit-btn${betUnit === u ? ' is-active' : ''}${!ok ? ' is-locked' : ''}`}
                onClick={() => ok && setBetUnit(u)}
                disabled={!ok}
                title={!ok ? `需帶入至少 ${new Intl.NumberFormat('en-US').format(u * MIN_UNIT_MULTIPLE)}` : ''}
              >
                {!ok ? '🔒 ' : ''}{u}
              </button>
            )
          })}
        </div>
      </div>

      <button type="button" className="pt-lobby-create" onClick={() => onCreateRoom({ buyIn, betUnit })} disabled={!isConnected}>
        + 建立新房間（底分 {betUnit}）
      </button>

      <div className="pt-room-list">
        {rooms.length === 0 ? (
          <div className="pt-room-empty">目前沒有大老二房間，來建立第一間吧！</div>
        ) : rooms.map(r => {
          const canJoin = buyIn >= (r.betUnit ?? 10) * MIN_UNIT_MULTIPLE
          return (
            <div key={r.id} className="pt-room-item">
              <div className="pt-room-meta">
                <span className="pt-room-id-tag">#{r.id}</span>
                <span className="pt-room-blinds">單位 {r.betUnit ?? 10}</span>
                <span className="pt-room-phase">{BT_PHASE[r.phase] ?? r.phase}</span>
              </div>
              <div className="pt-room-bottom">
                <span className="pt-room-players">{r.playerCount} / {r.maxPlayers} 玩家</span>
                {(() => {
                  const isInsufficient = !canJoin && r.phase === 'waiting' && r.playerCount < r.maxPlayers
                  return (
                    <button
                      type="button"
                      className={`pt-room-join${isInsufficient ? ' is-locked' : ''}`}
                      onClick={() => onJoinRoom(r.id, buyIn)}
                      disabled={!isConnected || r.phase !== 'waiting' || r.playerCount >= r.maxPlayers || !canJoin}
                      title={!canJoin ? `需帶入至少 ${new Intl.NumberFormat('en-US').format((r.betUnit ?? 10) * MIN_UNIT_MULTIPLE)}` : ''}
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
          {players.length < 3
            ? `還需要 ${3 - players.length} 名玩家`
            : players.every(p => p.ready)
              ? '所有人已準備，即將開始…'
              : '等待所有人準備'}
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

function OppFan({ count, compact = false }) {
  const n      = Math.min(count, 13)
  const spread = compact
    ? Math.min(38, Math.max(10, n * 3))
    : Math.min(62, Math.max(16, n * 4.2))
  const half   = OPP_CARD_W / 2
  return (
    <div className="bt-opp-fan">
      {Array(n).fill(0).map((_, idx) => {
        const t   = n > 1 ? idx / (n - 1) - 0.5 : 0
        const deg = t * spread
        return (
          <div
            key={idx}
            className="bt-opp-back"
            style={{
              left:            `calc(50% - ${half}px)`,
              zIndex:          idx,
              transform:       `rotate(${deg}deg)`,
              transformOrigin: `${half}px calc(100% + ${OPP_PIVOT}px)`,
            }}
          />
        )
      })}
    </div>
  )
}

function OppSeat({ player, isActing, winners, compact = false }) {
  const rank  = winners?.find(w => w.id === player.id)?.rank
  const count = player.cardCount
  return (
    <div className={`bt-opp${isActing ? ' is-acting' : ''}${player.status === 'finished' ? ' is-finished' : ''}`}>
      {isActing && <div className="pt-acting-arrow" />}
      <div className="bt-opp-top">
        <div className="bt-opp-avatar">{player.username[0].toUpperCase()}</div>
        {!compact && (
          <div className="bt-opp-info">
            <div className="bt-opp-name">{player.username}</div>
            <div className="bt-opp-bal">{fmt(player.balance)}</div>
          </div>
        )}
      </div>
      {compact && <div className="bt-opp-name">{player.username}</div>}
      {player.status === 'finished'
        ? <span className="bt-opp-done">第 {rank ?? '?'} 名</span>
        : <>
            <OppFan count={count} compact={compact} />
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
const CARD_W = 50   // pcard-md width
const PIVOT_Y = 180 // pivot distance below card bottom

const AFK_SECS = 30

function GameView({ gameState, myId, lastAction, gameError, onPlay, onPass }) {
  const [selected,    setSelected]    = useState([])
  const [isDealing,   setIsDealing]   = useState(false)
  const [turnSeconds, setTurnSeconds] = useState(null)
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
  const fanH     = 80   // fan container height

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
  function handleHint() { setSelected(getHint(myHand, pile)) }

  return (
    <div className="bt-game">

      {/* ── Arena: table + 3 opponent seats ── */}
      <div className="bt-arena">

        {/* Top opponent */}
        <div className="bt-seat bt-seat-top">
          {oppTop && <OppSeat player={oppTop} isActing={currentId === oppTop.id} winners={winners} />}
        </div>

        {/* Left opponent */}
        <div className="bt-seat bt-seat-left">
          {oppLeft && <OppSeat player={oppLeft} isActing={currentId === oppLeft.id} winners={winners} compact />}
        </div>

        {/* ── Round table ── */}
        <div className="bt-table-wrap">
          <div className="bt-table-surface">
            <div className={`bt-turn-bar${isMyTurn ? ' bt-my-turn' : ''}${turnSeconds !== null && turnSeconds <= 10 ? ' bt-turn-urgent' : ''}`}>
              {isMyTurn
                ? `✦ 輪到你行動 (${turnSeconds ?? AFK_SECS}s)`
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
                      {pile.cards.map((c, i) => <PlayingCard key={i} card={c} size="sm" />)}
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
          {oppRight && <OppSeat player={oppRight} isActing={currentId === oppRight.id} winners={winners} compact />}
        </div>
        {/* ── Bottom: error + buttons + my fan ── */}
      <div className="bt-bottom">

        {gameError && <div key={gameError} className="bt-game-error">{gameError}</div>}

        <div className="bt-action-bar">
          <BtBtn src="/big-two/hint.png" alt="提示"
            disabled={!isMyTurn} onClick={handleHint} />
          <BtBtn src="/big-two/stop.png" alt="不出"
            disabled={!isMyTurn || !canPass} onClick={onPass} />
          <BtBtn src="/big-two/playing-cards.png" alt="出牌"
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
                  <PlayingCard card={card} size="md" />
                </button>
              )
            })}
          </div>
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
    if (cashoutBalance !== null) auth?.refreshUser?.()
  }, [cashoutBalance, auth])

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
    play('bigTwoBgm')
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
      <header className="pt-header">
        <button type="button" className="pt-back" onClick={handleBack}>
          <img src="/arrow.png" alt="返回" />
        </button>
        <div className="pt-header-info">
          {roomId
            ? <span className="pt-room-label">房間 #{roomId}</span>
            : <img src="/big-two/big-two.png" alt="大老二" className="pt-room-label-img" />
          }
          {roomId && <span className="pt-blinds">單位 {betUnit}</span>}
        </div>
        {isPlaying && <span className="pt-phase-badge">{BT_PHASE[phase]}</span>}
        <button type="button" className="pt-mute-btn" onClick={toggleGameMute} title={isGameMuted ? '開啟音樂' : '關閉音樂'}>
          <img src={isGameMuted ? '/enable-sound.png' : '/volume.png'} alt="" />
        </button>
      </header>

      <div className="pt-content">

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
