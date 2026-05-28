import { useEffect, useRef } from 'react'

const EVENTS = ['mousemove', 'keydown', 'pointerdown', 'scroll', 'touchstart']

export function useIdleTimeout(timeoutMs, onTimeout, storageKey = 'idle_last_active') {
  const onTimeoutRef = useRef(onTimeout)
  onTimeoutRef.current = onTimeout

  useEffect(() => {
    const isStale = () => {
      const ts = Number(localStorage.getItem(storageKey) ?? 0)
      return ts > 0 && Date.now() - ts > timeoutMs
    }

    if (isStale()) {
      localStorage.setItem(storageKey, Date.now().toString())
      onTimeoutRef.current()
      return
    }

    localStorage.setItem(storageKey, Date.now().toString())

    let lastWrite = 0
    function handleActivity() {
      const now = Date.now()
      if (now - lastWrite > 60_000) {
        lastWrite = now
        localStorage.setItem(storageKey, now.toString())
      }
    }

    EVENTS.forEach(e => window.addEventListener(e, handleActivity, { passive: true }))

    const interval = setInterval(() => {
      if (isStale()) {
        localStorage.setItem(storageKey, Date.now().toString())
        onTimeoutRef.current()
      }
    }, 60_000)

    return () => {
      EVENTS.forEach(e => window.removeEventListener(e, handleActivity))
      clearInterval(interval)
    }
  }, [timeoutMs, storageKey])
}
