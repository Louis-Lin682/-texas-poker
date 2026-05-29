import { useCallback, useEffect, useRef, useState } from 'react'

const WS_BASE = (import.meta.env.VITE_WS_URL ?? 'ws://localhost:4000/poker').replace(/\/[^/]+$/, '')

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
