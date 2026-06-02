import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBlackjackSocket } from '../hooks/useBlackjackSocket'

// ── Helpers ────────────────────────────────────────────────
function fmtNum(n) { return new Intl.NumberFormat('en-US').format(n) }

function resultColor(r) {
  if (r === 'win' || r === 'blackjack') return '#57d46f'
  if (r === 'push') return '#f0c96b'
  if (r === 'lose' || r === 'bust') return '#f06060'
  return '#aaa'
}

function resultLabel(r) {
  if (r === 'blackjack') return 'BJ!'
  if (r === 'win') return '勝'
  if (r === 'push') return '平手'
  if (r === 'lose') return '輸'
  return ''
}

function handStatusLabel(status) {
  if (status === 'bust') return '爆牌'
  if (status === 'blackjack') return 'Blackjack!'
  return null
}

// ── Card ──────────────────────────────────────────────────
function BJCard({ card, size = 'md', style = {} }) {
  if (!card) return <div className={`pcard pcard-${size} pcard-back`} style={style} />
  const rank = card.slice(0, -1)
  const suit = card.slice(-1)
  return <div className={`pcard pcard-${size} rank-${rank} suit-${suit}`} style={style} />
}

// ── Hand display ──────────────────────────────────────────
function HandDisplay({ hand, isActive, size = 'md', showBet = false }) {
  const statusLbl = handStatusLabel(hand.status)
  const resLbl = hand.result ? resultLabel(hand.result) : statusLbl

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      <div style={{ position: 'relative', display: 'flex', gap: size === 'lg' ? 6 : 3 }}>
        {hand.cards.map((card, i) => <BJCard key={i} card={card} size={size} />)}
        {isActive && (
          <div style={{
            position: 'absolute', inset: -5,
            border: '2px solid #f0c96b', borderRadius: 10,
            boxShadow: '0 0 8px #f0c96b88', pointerEvents: 'none',
          }} />
        )}
      </div>
      <div style={{ fontSize: 11, color: '#bbb', display: 'flex', gap: 6, alignItems: 'center' }}>
        {hand.score > 0 && <span>{hand.score}</span>}
        {resLbl && (
          <span style={{ color: resultColor(hand.result ?? hand.status), fontWeight: 700 }}>
            {resLbl}
          </span>
        )}
        {showBet && hand.bet > 0 && <span style={{ color: '#f0c96b' }}>×{fmtNum(hand.bet)}</span>}
      </div>
    </div>
  )
}

// ── Chip button ────────────────────────────────────────────
function ChipBtn({ value, onClick }) {
  const colors = {
    50: '#4fd0ff', 100: '#57d46f', 500: '#f0c96b',
    1000: '#ff9a6c', 5000: '#c97dff',
  }
  const col = colors[value] ?? '#aaa'
  return (
    <button onClick={onClick} style={{
      width: 52, height: 52, borderRadius: '50%',
      background: `radial-gradient(circle at 35% 35%, ${col}cc, ${col}66)`,
      border: `2px solid ${col}`,
      color: '#fff', fontWeight: 700, fontSize: value >= 1000 ? 11 : 13,
      cursor: 'pointer', boxShadow: `0 0 8px ${col}44`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      {value >= 1000 ? `${value / 1000}K` : value}
    </button>
  )
}

// ── Countdown hook ─────────────────────────────────────────
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

// ── Main component ────────────────────────────────────────
export default function BlackjackTablePage({ auth }) {
  const navigate = useNavigate()
  const minBuyIn = 2000
  const {
    status, rooms, roomId, myId, gameState, error,
    cashoutBalance, refreshRooms, createRoom, joinRoom, leaveRoom, setReady, doAction,
  } = useBlackjackSocket({ minBuyIn })

  const [betAmount, setBetAmount] = useState(0)
  const cashoutShown = useRef(false)

  const timeLeft = useCountdown(gameState?.betDeadline)

  // Show updated balance after leaving
  useEffect(() => {
    if (cashoutBalance != null && !cashoutShown.current) {
      cashoutShown.current = true
      auth?.refreshUser?.()
    }
  }, [cashoutBalance, auth])

  // Refresh rooms when in lobby
  useEffect(() => {
    if (status === 'connected' && !roomId) {
      refreshRooms()
      const id = setInterval(refreshRooms, 5000)
      return () => clearInterval(id)
    }
  }, [status, roomId, refreshRooms])

  // Reset bet input when phase changes away from betting
  useEffect(() => {
    if (gameState?.phase !== 'betting') setBetAmount(0)
  }, [gameState?.phase])

  const handleLeave = useCallback(() => {
    leaveRoom()
    cashoutShown.current = false
  }, [leaveRoom])

  const handleBack = useCallback(() => {
    leaveRoom()
    navigate('/')
  }, [leaveRoom, navigate])

  const addChip = (v) => {
    const p = gameState?.players.find(p => p.id === myId)
    if (!p) return
    const max = Math.min((gameState?.maxBet ?? 5000) - betAmount, p.balance + betAmount)
    setBetAmount(prev => Math.min(prev + v, Math.max(prev, max)))
  }

  const confirmBet = () => {
    if (betAmount < (gameState?.minBet ?? 50)) return
    doAction('bet', betAmount)
  }

  // ── Derived state ──────────────────────────────────────
  const myPlayer = gameState?.players.find(p => p.id === myId)
  const otherPlayers = gameState?.players.filter(p => p.id !== myId) ?? []
  const isMyTurn = gameState?.currentActorId === myId
  const myCurrentHandIdx = isMyTurn ? (gameState?.currentHandIdx ?? 0) : (myPlayer?.currentHandIdx ?? 0)
  const myCurrentHand = myPlayer?.hands[myCurrentHandIdx]
  const dealerShowsAce = gameState?.dealer?.cards?.[0]?.slice(0, -1) === 'A'

  const canDouble = isMyTurn && myCurrentHand?.status === 'active' &&
    myCurrentHand?.cards?.length === 2 &&
    (myPlayer?.balance ?? 0) >= (myCurrentHand?.bet ?? 0)

  const canSplit = isMyTurn && myCurrentHand?.status === 'active' &&
    myCurrentHand?.cards?.length === 2 &&
    myCurrentHand?.cards?.[0] && myCurrentHand?.cards?.[1] &&
    cardFaceVal(myCurrentHand.cards[0]) === cardFaceVal(myCurrentHand.cards[1]) &&
    (myPlayer?.balance ?? 0) >= (myCurrentHand?.bet ?? 0) &&
    (myPlayer?.hands?.length ?? 0) < 4

  const canInsurance = isMyTurn && dealerShowsAce &&
    !myPlayer?.insuranceDecided &&
    myCurrentHand?.cards?.length === 2 &&
    myCurrentHand?.status === 'active' &&
    (myPlayer?.balance ?? 0) >= Math.floor((myPlayer?.bet ?? 0) / 2)

  // ── Lobby ──────────────────────────────────────────────
  if (!roomId) {
    return (
      <div style={{
        height: '100%', background: 'linear-gradient(160deg,#0d1f1a 0%,#0a1510 100%)',
        color: '#fff', display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', padding: '14px 16px',
          borderBottom: '1px solid #ffffff18', flexShrink: 0,
        }}>
          <button onClick={handleBack} style={{
            background: 'none', border: 'none', color: '#f0c96b',
            fontSize: 20, cursor: 'pointer', padding: 4, marginRight: 8,
          }}>←</button>
          <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: 2 }}>21點</span>
          <span style={{ marginLeft: 'auto', fontSize: 13, color: '#aaa' }}>
            餘額 {fmtNum(auth?.user?.balance ?? 0)}
          </span>
        </div>

        {status === 'connecting' && (
          <div className="pt-connecting-overlay">
            <span className="pt-connecting-text">連線中...</span>
          </div>
        )}

        {error && (
          <div style={{
            margin: '8px 16px', padding: '8px 12px', borderRadius: 8,
            background: '#f0606033', color: '#f09090', fontSize: 13,
          }}>{error}</div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          <button onClick={() => createRoom()} style={{
            width: '100%', padding: '14px 0', borderRadius: 12,
            background: 'linear-gradient(90deg,#2d6a4f,#1a4534)',
            border: '1px solid #57d46f55', color: '#57d46f',
            fontWeight: 700, fontSize: 15, cursor: 'pointer', marginBottom: 16,
          }}>+ 建立新房間</button>

          {rooms.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#555', marginTop: 40, fontSize: 14 }}>
              目前沒有開放的房間
            </div>
          ) : (
            rooms.map(r => (
              <div key={r.id} onClick={() => joinRoom(r.id, minBuyIn)} style={{
                background: '#ffffff0d', border: '1px solid #ffffff18',
                borderRadius: 12, padding: '14px 16px', marginBottom: 10,
                cursor: r.phase !== 'waiting' ? 'default' : 'pointer',
                opacity: r.phase !== 'waiting' ? 0.5 : 1,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, color: '#f0c96b' }}>#{r.id}</span>
                  <span style={{ fontSize: 12, color: r.phase === 'waiting' ? '#57d46f' : '#aaa' }}>
                    {r.phase === 'waiting' ? '等待中' : '遊戲中'}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                  {r.playerCount}/{r.maxPlayers} 人 · 最低下注 {r.betUnit ?? 50}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    )
  }

  // ── Game table ─────────────────────────────────────────
  const phase = gameState?.phase ?? 'waiting'

  return (
    <div style={{
      height: '100%',
      background: 'radial-gradient(ellipse at 50% 30%,#1a4534 0%,#0d2418 60%,#070f0b 100%)',
      color: '#fff', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Connecting overlay */}
      {status === 'connecting' && (
        <div className="pt-connecting-overlay">
          <span className="pt-connecting-text">重新連線中...</span>
        </div>
      )}

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', padding: '10px 14px',
        background: '#00000033', flexShrink: 0, gap: 8,
      }}>
        <button onClick={handleLeave} style={{
          background: 'none', border: '1px solid #ffffff33', color: '#f0c96b',
          padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
        }}>離開</button>
        <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: 1 }}>21點 #{roomId}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#f0c96b' }}>
          {fmtNum(myPlayer?.balance ?? 0)}
        </span>
      </div>

      {error && (
        <div style={{
          margin: '4px 12px', padding: '6px 10px', borderRadius: 6,
          background: '#f0606033', color: '#f09090', fontSize: 12, textAlign: 'center',
        }}>{error}</div>
      )}

      {/* Play area (scrollable) */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0 }}>

        {/* Dealer */}
        <DealerArea dealer={gameState?.dealer} phase={phase} />

        {/* Other players */}
        {otherPlayers.length > 0 && (
          <OtherPlayersArea
            players={otherPlayers}
            currentActorId={gameState?.currentActorId}
            currentHandIdx={gameState?.currentHandIdx ?? 0}
          />
        )}

        {/* My hand area */}
        <MyHandArea
          player={myPlayer}
          isMyTurn={isMyTurn}
          currentHandIdx={myCurrentHandIdx}
          phase={phase}
        />
      </div>

      {/* Bottom action bar */}
      <ActionBar
        phase={phase}
        myPlayer={myPlayer}
        isMyTurn={isMyTurn}
        betAmount={betAmount}
        timeLeft={timeLeft}
        minBet={gameState?.minBet ?? 50}
        maxBet={gameState?.maxBet ?? 5000}
        betUnit={gameState?.betUnit ?? 50}
        canDouble={canDouble}
        canSplit={canSplit}
        canInsurance={canInsurance}
        onAddChip={addChip}
        onClearBet={() => setBetAmount(0)}
        onConfirmBet={confirmBet}
        onSetReady={setReady}
        onAction={doAction}
      />
    </div>
  )
}

function cardFaceVal(card) {
  if (!card) return 0
  const r = card.slice(0, -1)
  if (['T', 'J', 'Q', 'K'].includes(r)) return 10
  if (r === 'A') return 11
  return parseInt(r)
}

// ── Sub-components ────────────────────────────────────────

function DealerArea({ dealer, phase }) {
  const cards = dealer?.cards ?? []
  const score = dealer?.score ?? 0

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '16px 12px 8px', gap: 8,
    }}>
      <div style={{
        fontSize: 11, letterSpacing: 2, color: '#888', textTransform: 'uppercase', marginBottom: 2,
      }}>莊家</div>
      <div style={{ display: 'flex', gap: 6, minHeight: 70 }}>
        {cards.length === 0
          ? <div style={{ color: '#444', fontSize: 12, alignSelf: 'center' }}>等待開局</div>
          : cards.map((card, i) => <BJCard key={i} card={card} size="md" />)
        }
      </div>
      {score > 0 && (
        <div style={{
          fontSize: 13, color: '#ccc',
          background: '#ffffff15', padding: '2px 10px', borderRadius: 12,
        }}>
          {score}
          {phase !== 'playing' && score > 21 && <span style={{ color: '#f06060', marginLeft: 4 }}>爆牌</span>}
          {phase !== 'playing' && score === 21 && cards.length === 2 && <span style={{ color: '#f0c96b', marginLeft: 4 }}>BJ!</span>}
        </div>
      )}
    </div>
  )
}

function OtherPlayersArea({ players, currentActorId, currentHandIdx }) {
  return (
    <div style={{
      display: 'flex', gap: 8, padding: '8px 12px', overflowX: 'auto',
      borderTop: '1px solid #ffffff0f', borderBottom: '1px solid #ffffff0f',
      flexShrink: 0,
    }}>
      {players.map(p => {
        const isActor = p.id === currentActorId
        return (
          <div key={p.id} style={{
            flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 4, minWidth: 70, padding: '6px 8px', borderRadius: 8,
            background: isActor ? '#f0c96b18' : '#ffffff0a',
            border: isActor ? '1px solid #f0c96b44' : '1px solid transparent',
          }}>
            <div style={{ fontSize: 10, color: isActor ? '#f0c96b' : '#888', fontWeight: 600 }}>
              {p.username}
            </div>
            {p.bet > 0 && (
              <div style={{ fontSize: 10, color: '#f0c96b' }}>×{fmtNum(p.bet)}</div>
            )}
            {p.hands.length === 0 && p.bet === 0 && (
              <div style={{ fontSize: 10, color: '#555' }}>
                {p.ready ? '✓ 準備' : '等待中'}
              </div>
            )}
            {p.hands.map((hand, i) => (
              <HandDisplay
                key={i}
                hand={hand}
                size="sm"
                isActive={isActor && i === currentHandIdx}
              />
            ))}
            {p.result && (
              <div style={{ fontSize: 10, color: resultColor(p.result), fontWeight: 700 }}>
                {resultLabel(p.result)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function MyHandArea({ player, isMyTurn, currentHandIdx, phase }) {
  if (!player) return null
  const hands = player.hands ?? []

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: hands.length === 0 ? 'center' : 'flex-start',
      padding: '12px 16px 8px', gap: 12,
    }}>
      {hands.length === 0 && (phase === 'waiting' || phase === 'betting') && (
        <div style={{ color: '#555', fontSize: 13 }}>
          {phase === 'waiting' ? '等待開局...' : '下注中...'}
        </div>
      )}

      {hands.map((hand, i) => (
        <div key={i} style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        }}>
          {hands.length > 1 && (
            <div style={{ fontSize: 10, color: '#888', letterSpacing: 1 }}>手牌 {i + 1}</div>
          )}
          <HandDisplay
            hand={hand}
            size="lg"
            isActive={isMyTurn && i === currentHandIdx}
            showBet
          />
        </div>
      ))}

      {player.bet > 0 && hands.length === 0 && (
        <div style={{ fontSize: 13, color: '#f0c96b' }}>
          下注: {fmtNum(player.bet)}
        </div>
      )}
    </div>
  )
}

function ActionBar({
  phase, myPlayer, isMyTurn, betAmount, timeLeft,
  minBet, maxBet, betUnit,
  canDouble, canSplit, canInsurance,
  onAddChip, onClearBet, onConfirmBet, onSetReady, onAction,
}) {
  const CHIPS = [50, 100, 500, 1000, 5000]

  if (phase === 'waiting') {
    return (
      <div style={{ padding: '12px 16px 20px', borderTop: '1px solid #ffffff0f', flexShrink: 0 }}>
        {myPlayer?.ready ? (
          <div style={{ textAlign: 'center', color: '#57d46f', fontSize: 14 }}>
            ✓ 已準備，等待其他玩家...
          </div>
        ) : (
          <button onClick={onSetReady} style={{
            width: '100%', padding: 14, borderRadius: 12,
            background: 'linear-gradient(90deg,#2d6a4f,#1a7a5a)',
            border: 'none', color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer',
          }}>準備好了！</button>
        )}
      </div>
    )
  }

  if (phase === 'betting') {
    const hasBet = myPlayer?.bet > 0
    return (
      <div style={{
        padding: '10px 14px 18px', borderTop: '1px solid #ffffff0f',
        flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#888' }}>
            倒數 <span style={{ color: timeLeft <= 5 ? '#f06060' : '#f0c96b', fontWeight: 700 }}>{timeLeft}s</span>
          </span>
          <span style={{ fontSize: 13, color: '#fff' }}>
            下注: <span style={{ color: '#f0c96b', fontWeight: 700 }}>{fmtNum(betAmount)}</span>
          </span>
          <button onClick={onClearBet} style={{
            background: '#ffffff15', border: 'none', color: '#aaa',
            padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
          }}>清除</button>
        </div>

        {hasBet ? (
          <div style={{ textAlign: 'center', color: '#57d46f', fontSize: 13 }}>
            ✓ 已下注 {fmtNum(myPlayer.bet)}
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              {CHIPS.map(v => (
                <ChipBtn key={v} value={v} onClick={() => onAddChip(v)} />
              ))}
            </div>
            <button
              onClick={onConfirmBet}
              disabled={betAmount < minBet}
              style={{
                width: '100%', padding: 12, borderRadius: 10,
                background: betAmount >= minBet
                  ? 'linear-gradient(90deg,#2a5c3f,#1a8050)'
                  : '#1a2a20',
                border: 'none', color: betAmount >= minBet ? '#fff' : '#444',
                fontSize: 15, fontWeight: 700, cursor: betAmount >= minBet ? 'pointer' : 'default',
                transition: 'all 0.2s',
              }}
            >
              確認下注 {betAmount >= minBet ? `(${fmtNum(betAmount)})` : `(最低 ${minBet})`}
            </button>
          </>
        )}
      </div>
    )
  }

  if (phase === 'playing') {
    if (!isMyTurn) {
      return (
        <div style={{ padding: '14px 16px 20px', borderTop: '1px solid #ffffff0f', flexShrink: 0 }}>
          <div style={{ textAlign: 'center', color: '#666', fontSize: 13 }}>等待其他玩家...</div>
        </div>
      )
    }
    return (
      <div style={{
        padding: '10px 14px 18px', borderTop: '1px solid #ffffff0f',
        flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {canInsurance && (
          <button onClick={() => onAction('insurance')} style={{
            width: '100%', padding: 10, borderRadius: 8,
            background: 'linear-gradient(90deg,#4a3a00,#5a4800)',
            border: '1px solid #f0c96b44', color: '#f0c96b',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}>
            買保險 (×{fmtNum(Math.floor((myPlayer?.bet ?? 0) / 2))})
          </button>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <ActionBtn label="要牌" color="#4fd0ff" onClick={() => onAction('hit')} />
          <ActionBtn label="停牌" color="#ff9a6c" onClick={() => onAction('stand')} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canDouble && <ActionBtn label="加倍" color="#57d46f" onClick={() => onAction('double')} />}
          {canSplit && <ActionBtn label="分牌" color="#c97dff" onClick={() => onAction('split')} />}
        </div>
      </div>
    )
  }

  if (phase === 'dealer') {
    return (
      <div style={{ padding: '14px 16px 20px', borderTop: '1px solid #ffffff0f', flexShrink: 0 }}>
        <div style={{ textAlign: 'center', color: '#aaa', fontSize: 13 }}>莊家出牌中...</div>
      </div>
    )
  }

  if (phase === 'result') {
    return (
      <div style={{ padding: '10px 16px 20px', borderTop: '1px solid #ffffff0f', flexShrink: 0 }}>
        <ResultSummary player={myPlayer} />
        <div style={{ textAlign: 'center', color: '#555', fontSize: 12, marginTop: 6 }}>
          5 秒後自動進入下一局...
        </div>
      </div>
    )
  }

  return null
}

function ActionBtn({ label, color, onClick }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: '12px 0', borderRadius: 10,
      background: `linear-gradient(135deg,${color}33,${color}18)`,
      border: `1px solid ${color}66`, color: color,
      fontWeight: 700, fontSize: 15, cursor: 'pointer',
    }}>
      {label}
    </button>
  )
}

function ResultSummary({ player }) {
  if (!player) return null
  const hands = player.hands ?? []
  let totalReturn = 0
  for (const hand of hands) {
    if (hand.result === 'win') totalReturn += hand.bet * 2
    else if (hand.result === 'blackjack') totalReturn += hand.bet + Math.floor(hand.bet * 1.5)
    else if (hand.result === 'push') totalReturn += hand.bet
  }
  if (player.insuranceBet > 0 && hands.some(h => h.result === 'lose' && false)) {
    // insurance handled server-side, balance already updated
  }

  const net = totalReturn - (hands.reduce((s, h) => s + h.bet, 0) + player.insuranceBet)

  if (!player.result) return null

  return (
    <div style={{ textAlign: 'center', marginBottom: 4 }}>
      <div style={{
        fontSize: 22, fontWeight: 800,
        color: resultColor(player.result),
      }}>
        {player.result === 'win' ? '🎉 勝利!' : player.result === 'push' ? '🤝 平手' : '😔 本局輸了'}
      </div>
      {net !== 0 && (
        <div style={{ fontSize: 13, color: net > 0 ? '#57d46f' : '#f06060', marginTop: 2 }}>
          {net > 0 ? '+' : ''}{fmtNum(net)}
        </div>
      )}
    </div>
  )
}
