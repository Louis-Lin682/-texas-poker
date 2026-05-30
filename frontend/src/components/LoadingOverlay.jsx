import { useEffect, useState } from 'react'
import { useLoading } from '../context/LoadingContext'

const SRC_W    = 180
const SRC_H    = 230
const SCALE    = 0.5
const DISP_W   = Math.round(SRC_W * SCALE)   // 90
const DISP_H   = Math.round(SRC_H * SCALE)   // 115
const SHEET_W  = Math.round(900  * SCALE)     // 450
const SHEET_H  = Math.round(1150 * SCALE)     // 575
const TOTAL    = 24
const COLS     = 5
const FRAME_MS = 60

const FRAMES = Array.from({ length: TOTAL }, (_, i) => ({
  x: (i % COLS) * SRC_W,
  y: Math.floor(i / COLS) * SRC_H,
}))

export default function LoadingOverlay() {
  const { visible, progress } = useLoading()
  const [mounted, setMounted] = useState(false)
  const [frame,   setFrame]   = useState(0)

  useEffect(() => {
    if (visible) { setMounted(true); setFrame(0) }
  }, [visible])

  useEffect(() => {
    if (!visible) return
    const id = setInterval(() => setFrame(f => (f + 1) % FRAMES.length), FRAME_MS)
    return () => clearInterval(id)
  }, [visible])

  if (!mounted) return null

  const { x, y } = FRAMES[frame]

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgb(13,16,21)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 16,
        opacity: visible ? 1 : 0,
        transition: 'opacity 220ms ease',
        pointerEvents: visible ? 'all' : 'none',
      }}
      onTransitionEnd={() => { if (!visible) setMounted(false) }}
    >
      {/* Sprite */}
      <div style={{
        width: DISP_W, height: DISP_H,
        overflow: 'hidden',
        position: 'relative',
        flexShrink: 0,
      }}>
        <img
          src="/loading/loading.png"
          alt=""
          draggable={false}
          style={{
            width: SHEET_W, height: SHEET_H,
            position: 'absolute',
            left: -Math.round(x * SCALE),
            top:  -Math.round(y * SCALE),
            display: 'block',
            userSelect: 'none',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* Progress bar */}
      <div style={{
        width: 120, height: 4,
        background: 'rgba(255,255,255,0.08)',
        borderRadius: 4,
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${progress}%`,
          background: 'linear-gradient(90deg, #b8820a, #D9A441)',
          borderRadius: 4,
          transition: 'width 300ms ease',
        }} />
      </div>
    </div>
  )
}
