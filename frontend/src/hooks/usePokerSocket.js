import { useCallback, useEffect, useRef, useState } from 'react'

const _wsBase = import.meta.env.VITE_WS_URL ?? 'ws://localhost:4000/poker'
const WS_URL  = _wsBase.startsWith('ws://') && window.location.protocol === 'https:'
  ? _wsBase.replace('ws://', 'wss://')
  : _wsBase
const TOKEN_KEY = 'texas_holdem_auth_token'
const ROOM_KEY  = 'texas_holdem_room'

export function usePokerSocket({ minBuyIn = 2000 } = {}) {
  const wsRef = useRef(null)
  const minBuyInRef = useRef(minBuyIn)
  useEffect(() => { minBuyInRef.current = minBuyIn }, [minBuyIn])
  const [status, setStatus] = useState('idle')
  const [rooms, setRooms] = useState([])
  const [roomId, setRoomId] = useState(null)
  const [myId, setMyId] = useState(null)
  const [gameState, setGameState] = useState(null)
  const [winInfo, setWinInfo] = useState(null)
  const [error, setError] = useState(null)
  const [cashoutBalance, setCashoutBalance] = useState(null)

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) { setStatus('no_auth'); return }

    // cancelled flag prevents React 18 Strict Mode double-run from updating state
    // on the first (immediately-cleaned-up) connection attempt
    let cancelled = false
    setStatus('connecting')
    const ws = new WebSocket(`${WS_URL}?token=${token}`)

    ws.onopen = () => {
      if (cancelled) { ws.close(); return }
      wsRef.current = ws
      setStatus('connected')
      setError(null)
      // Auto-rejoin previous room on reconnect
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

    ws.onclose = () => {
      if (cancelled) return
      wsRef.current = null
      setStatus('disconnected')
    }

    ws.onerror = () => {
      if (cancelled) return
      setStatus('error')
      setError('連線失敗，請確認後端已啟動並重新整理頁面')
    }

    ws.onmessage = ({ data }) => {
      if (cancelled) return
      let msg
      try { msg = JSON.parse(data) } catch { return }

      switch (msg.type) {
        case 'room_list':
          setRooms(msg.rooms)
          break
        case 'room_joined':
          setRoomId(msg.roomId)
          if (msg.myId) setMyId(msg.myId)
          if (msg.state) setGameState(msg.state)
          break
        case 'state_update':
          setGameState(msg.state)
          if (msg.myId) setMyId(msg.myId)
          break
        case 'hole_cards':
          setGameState(prev => prev ? { ...prev, myHoleCards: msg.cards } : prev)
          break
        case 'showdown':
          setWinInfo({ winners: msg.winners, pot: msg.pot, folded: false, players: msg.players ?? [] })
          setTimeout(() => setWinInfo(null), 5500)
          break
        case 'hand_result':
          setWinInfo({ winners: msg.winners, pot: msg.pot, folded: true })
          setTimeout(() => setWinInfo(null), 4500)
          break
        case 'balance_update':
          setCashoutBalance(msg.balance)
          break
        case 'error':
          setError(msg.message)
          setTimeout(() => setError(null), 3500)
          // Clear stored room if it no longer accepts us
          if (msg.message.includes('遊戲進行中') || msg.message === '房間不存在') {
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
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  const refreshRooms = useCallback(() => send({ type: 'list_rooms' }), [send])

  const createRoom = useCallback((opts = {}) => send({
    type: 'create_room', smallBlind: 10, bigBlind: 20, maxPlayers: 6,
    buyIn: minBuyInRef.current, gameSlug: 'texas-holdem', ...opts,
  }), [send])

  const joinRoom = useCallback((id, buyIn) => {
    const actualBuyIn = buyIn ?? minBuyInRef.current
    sessionStorage.setItem(ROOM_KEY, JSON.stringify({ roomId: id, buyIn: actualBuyIn }))
    send({ type: 'join_room', roomId: id, buyIn: actualBuyIn })
  }, [send])

  const leaveRoom = useCallback(() => {
    sessionStorage.removeItem(ROOM_KEY)
    send({ type: 'leave_room' })
    setRoomId(null)
    setMyId(null)
    setGameState(null)
  }, [send])

  const startGame = useCallback(() => send({ type: 'start_game' }), [send])

  const doAction = useCallback((action, amount = 0) => {
    send({ type: 'action', action, amount })
  }, [send])

  const setReady = useCallback(() => {
    send({ type: 'set_ready' })
  }, [send])

  return { status, rooms, roomId, myId, gameState, winInfo, error, cashoutBalance, refreshRooms, createRoom, joinRoom, leaveRoom, startGame, doAction, setReady }
}
