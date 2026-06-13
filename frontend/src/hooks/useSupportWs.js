import { useCallback, useEffect, useRef, useState } from 'react'

function _makeWsBase() {
  const fallback = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/poker`
  const raw = import.meta.env.VITE_WS_URL ?? fallback
  const upgraded = raw.startsWith('ws://') && window.location.protocol === 'https:'
    ? raw.replace('ws://', 'wss://')
    : raw
  try {
    const u = new URL(upgraded)
    return `${u.protocol}//${u.host}`
  } catch {
    return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
  }
}
const WS_BASE = _makeWsBase()

export function useSupportWs({ token, onNewMessage }) {
  const [unreadCount, setUnreadCount] = useState(0)
  const wsRef = useRef(null)
  const onNewMessageRef = useRef(onNewMessage)
  onNewMessageRef.current = onNewMessage

  useEffect(() => {
    if (!token) return

    let ws
    let destroyed = false
    let retryTimer

    function connect() {
      if (destroyed) return
      ws = new WebSocket(`${WS_BASE}/support?token=${token}`)
      wsRef.current = ws

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data)
          if (data.type === 'unread_count') setUnreadCount(data.count)
          if (data.type === 'new_message') {
            setUnreadCount(c => c + 1)
            onNewMessageRef.current?.(data)
          }
        } catch {}
      }

      ws.onclose = () => {
        if (!destroyed) retryTimer = setTimeout(connect, 5000)
      }

      ws.onerror = () => ws.close()
    }

    connect()
    return () => {
      destroyed = true
      clearTimeout(retryTimer)
      ws?.close()
    }
  }, [token])

  const resetUnread = useCallback(() => setUnreadCount(0), [])

  return { unreadCount, resetUnread }
}
