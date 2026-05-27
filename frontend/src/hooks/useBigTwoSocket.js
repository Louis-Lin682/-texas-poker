import { useCallback, useEffect, useRef, useState } from 'react'

const WS_URL   = import.meta.env.VITE_WS_URL ?? 'ws://localhost:4000/poker'
const TOKEN_KEY = 'texas_holdem_auth_token'
const ROOM_KEY  = 'big_two_room'

export function useBigTwoSocket({ minBuyIn = 2000 } = {}) {
  const wsRef = useRef(null)
  const minBuyInRef = useRef(minBuyIn)
  useEffect(() => { minBuyInRef.current = minBuyIn }, [minBuyIn])
  const [status, setStatus] = useState('idle')
  const [rooms, setRooms] = useState([])
  const [roomId, setRoomId] = useState(null)
  const [myId, setMyId] = useState(null)
  const [gameState, setGameState] = useState(null)
  const [gameResult, setGameResult] = useState(null)
  const [lastAction, setLastAction] = useState(null)
  const [error, setError] = useState(null)
  const [cashoutBalance, setCashoutBalance] = useState(null)

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) { setStatus('no_auth'); return }

    let cancelled = false
    setStatus('connecting')
    const ws = new WebSocket(`${WS_URL}?token=${token}`)

    ws.onopen = () => {
      if (cancelled) { ws.close(); return }
      wsRef.current = ws
      setStatus('connected')
      setError(null)
      ws.send(JSON.stringify({ type: 'list_rooms' }))
      try {
        const saved = sessionStorage.getItem(ROOM_KEY)
        if (saved) {
          const { roomId: id, buyIn } = JSON.parse(saved)
          ws.send(JSON.stringify({ type: 'join_room', roomId: id, buyIn: buyIn ?? minBuyInRef.current }))
        }
      } catch {
        sessionStorage.removeItem(ROOM_KEY)
      }
    }

    ws.onclose  = () => { if (!cancelled) { wsRef.current = null; setStatus('disconnected') } }
    ws.onerror  = () => { if (!cancelled) { setStatus('error'); setError('連線失敗，請重新整理頁面') } }

    ws.onmessage = ({ data }) => {
      if (cancelled) return
      let msg
      try { msg = JSON.parse(data) } catch { return }

      switch (msg.type) {
        case 'room_list':
          setRooms(msg.rooms.filter(r => r.gameType === 'big-two'))
          break
        case 'room_joined':
          setRoomId(msg.roomId)
          if (msg.myId)  setMyId(msg.myId)
          if (msg.state) setGameState(msg.state)
          setGameResult(null)
          break
        case 'state_update':
          setGameState(msg.state)
          if (msg.state?.phase === 'waiting') setGameResult(null)
          break
        case 'deal':
          setGameState(prev => prev ? { ...prev, myHand: msg.hand ?? [] } : prev)
          break
        case 'player_action':
          setLastAction({ playerId: msg.playerId, username: msg.username, action: msg.action, cards: msg.cards ?? [], handType: msg.handType })
          setTimeout(() => setLastAction(null), 2500)
          break
        case 'game_result':
          setGameResult({ winners: msg.winners, scores: msg.scores, isPackage: msg.isPackage })
          break
        case 'balance_update':
          setCashoutBalance(msg.balance)
          break
        case 'error':
          setError(msg.message)
          setTimeout(() => setError(null), 3500)
          if (msg.message === '房間不存在') {
            sessionStorage.removeItem(ROOM_KEY)
            setRoomId(null)
          }
          break
      }
    }

    return () => {
      cancelled = true
      wsRef.current = null
      ws.close()
    }
  }, [])

  const send = useCallback((msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(msg))
  }, [])

  const refreshRooms  = useCallback(() => send({ type: 'list_rooms' }), [send])

  const createRoom = useCallback((opts = {}) => send({
    type: 'create_room', gameType: 'big-two', gameSlug: 'big-two',
    betUnit: 10, maxPlayers: 4, buyIn: minBuyInRef.current, ...opts,
  }), [send])

  const joinRoom = useCallback((id, buyIn) => {
    const actualBuyIn = buyIn ?? minBuyInRef.current
    sessionStorage.setItem(ROOM_KEY, JSON.stringify({ roomId: id, buyIn: actualBuyIn }))
    send({ type: 'join_room', roomId: id, buyIn: actualBuyIn })
  }, [send])

  const leaveRoom = useCallback(() => {
    sessionStorage.removeItem(ROOM_KEY)
    send({ type: 'leave_room' })
    setRoomId(null); setMyId(null); setGameState(null); setGameResult(null)
  }, [send])

  const setReady  = useCallback(() => send({ type: 'set_ready' }), [send])
  const doAction  = useCallback((action, cards = []) => send({ type: 'action', action, cards }), [send])

  return {
    status, rooms, roomId, myId, gameState, gameResult, lastAction,
    error, cashoutBalance,
    refreshRooms, createRoom, joinRoom, leaveRoom, setReady, doAction,
  }
}
