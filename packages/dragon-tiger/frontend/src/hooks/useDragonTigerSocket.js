import { useCallback, useEffect, useRef, useState } from 'react'

const TOKEN_KEY = 'dt_auth_token'

function buildWsUrl(token) {
  const base = import.meta.env.VITE_WS_URL
    ?? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
  const url = new URL(base)
  url.searchParams.set('token', token)
  return url.toString()
}

export function useDragonTigerSocket({ minBuyIn = 0 } = {}) {
  const wsRef = useRef(null)

  const [status,         setStatus]         = useState('idle')
  const [roomId,         setRoomId]         = useState(null)
  const [myId,           setMyId]           = useState(null)
  const [gameState,      setGameState]      = useState(null)
  const [error,          setError]          = useState(null)
  const [cashoutBalance, setCashoutBalance] = useState(null)
  const [wasKicked,      setWasKicked]      = useState(false)
  const [liveConfig,     setLiveConfig]     = useState(null)

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) { setStatus('no_auth'); return }

    let destroyed = false, retryTimer = null

    function connect() {
      if (destroyed) return
      setStatus('connecting')
      const ws = new WebSocket(buildWsUrl(token))
      wsRef.current = ws

      ws.onopen = () => {
        if (destroyed) { ws.close(); return }
        setStatus('connected')
        setError(null)
      }

      ws.onclose = () => {
        if (destroyed) return
        wsRef.current = null
        setStatus('connecting')
        setRoomId(null)
        retryTimer = setTimeout(connect, 3000)
      }

      ws.onerror = () => ws.close()

      ws.onmessage = ({ data }) => {
        if (destroyed) return
        let msg
        try { msg = JSON.parse(data) } catch { return }

        switch (msg.type) {
          case 'room_joined':
            setRoomId(msg.roomId ?? 'dt-main')
            if (msg.myId)  setMyId(msg.myId)
            if (msg.state) setGameState(msg.state)
            break
          case 'state_update':
            if (msg.myId)  setMyId(msg.myId)
            if (msg.state) setGameState(msg.state)
            break
          case 'round_result':
            if (msg.state) setGameState(msg.state)
            break
          case 'cashout_done':
            setCashoutBalance(msg.balance)
            setRoomId(null)
            break
          case 'config_update':
            if (msg.config) setLiveConfig(msg.config)
            break
          case 'kicked_from_room':
            setWasKicked(true)
            setRoomId(null)
            break
          case 'error':
            setError(msg.message)
            setTimeout(() => setError(null), 3000)
            break
        }
      }
    }

    connect()
    return () => { destroyed = true; clearTimeout(retryTimer); wsRef.current?.close() }
  }, [])

  const send = useCallback((msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(msg))
  }, [])

  const placeBet      = useCallback((zone, amount) => send({ type: 'dt_place_bet', zone, amount }), [send])
  const cancelLastBet = useCallback(() => send({ type: 'dt_cancel_last_bet' }), [send])
  const cancelBets    = useCallback(() => send({ type: 'dt_cancel_bets' }), [send])
  const leaveRoom     = useCallback(() => send({ type: 'cashout' }), [send])
  const refreshRooms  = useCallback(() => {}, [])
  const createRoom    = useCallback(() => {}, [])
  const joinRoom      = useCallback(() => {}, [])

  return {
    status,
    rooms:      [],
    roomsReady: status === 'connected' || !!roomId,
    roomId,
    myId,
    gameState,
    error,
    cashoutBalance,
    wasKicked,
    liveConfig,
    refreshRooms,
    createRoom,
    joinRoom,
    leaveRoom,
    placeBet,
    cancelLastBet,
    cancelBets,
  }
}
