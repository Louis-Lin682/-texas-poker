import { createContext, useCallback, useContext, useRef, useState } from 'react'

const Ctx = createContext(null)

const MIN_MS = 650
const MAX_MS = 4000

export function LoadingProvider({ children }) {
  const [visible,  setVisible]  = useState(false)
  const [progress, setProgress] = useState(0)
  const shownAt   = useRef(null)
  const timer     = useRef(null)
  const fillTimer = useRef(null)

  const stopFill = () => clearInterval(fillTimer.current)

  const startFill = useCallback(() => {
    stopFill()
    let cur = 0
    setProgress(0)
    fillTimer.current = setInterval(() => {
      cur += (85 - cur) * 0.04   // exponential crawl toward 85%
      setProgress(Math.min(85, cur))
    }, 60)
  }, [])

  const show = useCallback(() => {
    clearTimeout(timer.current)
    setVisible(true)
    shownAt.current = Date.now()
    startFill()
    timer.current = setTimeout(() => {
      stopFill(); setVisible(false); setProgress(0); shownAt.current = null
    }, MAX_MS)
  }, [startFill])

  const ready = useCallback(() => {
    if (shownAt.current === null) return
    stopFill()
    setProgress(100)
    const elapsed  = Date.now() - shownAt.current
    const wait     = Math.max(300, MIN_MS - elapsed)  // at least 300ms for bar to fill visually
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setVisible(false); setProgress(0); shownAt.current = null
    }, wait)
  }, [])

  return (
    <Ctx.Provider value={{ visible, progress, show, ready }}>
      {children}
    </Ctx.Provider>
  )
}

export const useLoading = () => useContext(Ctx)
