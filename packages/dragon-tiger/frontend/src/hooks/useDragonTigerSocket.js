import { useCallback, useEffect, useRef, useState } from 'react'

const TOKEN_KEY = 'dt_auth_token'

function buildWsUrl(token) {
  const base = import.meta.env.VITE_WS_URL
    ?? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
  const url = new URL(base)
  url.searchParams.set('token', token)
  return url.toString()
}

export function useDragonTigerSocket() {
  const wsRef = useRef(null)

  const [status,    setStatus]    = useState('idle')
  const [gameState, setGameState] = useState(null)
  const [myId,      setMyId]      = useState(null)
  const [error,     setError]     = useState(null)

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) { setStatus('no_auth'); return }

    let destroyed  = false
    let retryTimer = null

    function connect() {
      setStatus('connecting')
      const ws = new WebSocket(buildWsUrl(token))
      wsRef.current = ws

      ws.onopen = () => { if (!destroyed) setStatus('connected') }

      ws.onmessage = (e) => {
        if (destroyed) return
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'state_update') {
            setGameState(msg.state)
            // Derive myId from first state that has players
            if (!myId && msg.state?.players) {
              // Server sends our own id on connection via initial state
              // We identify ourselves via localStorage if available
              const stored = localStorage.getItem('dt_user_id')
              if (stored) setMyId(Number(stored))
            }
          }
          if (msg.type === 'round_result') {
            setGameState(msg.state)
          }
          if (msg.type === 'error') {
            setError(msg.message)
            setTimeout(() => setError(null), 3000)
          }
          if (msg.type === 'identity') {
            setMyId(msg.userId)
            localStorage.setItem('dt_user_id', String(msg.userId))
          }
        } catch { /* ignore parse errors */ }
      }

      ws.onclose = (e) => {
        if (destroyed) return
        setStatus('disconnected')
        if (e.code === 4001) { setStatus('no_auth'); return }
        retryTimer = setTimeout(connect, 3000)
      }

      ws.onerror = () => {}
    }

    connect()

    return () => {
      destroyed = true
      clearTimeout(retryTimer)
      wsRef.current?.close()
    }
  }, [])

  const send = useCallback((msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  const placeBet     = useCallback((zone, amount) => send({ type: 'dt_place_bet', zone, amount }), [send])
  const cancelLastBet = useCallback(() => send({ type: 'dt_cancel_last_bet' }), [send])
  const cancelBets   = useCallback(() => send({ type: 'dt_cancel_bets' }), [send])

  return { status, gameState, myId, error, placeBet, cancelLastBet, cancelBets }
}
