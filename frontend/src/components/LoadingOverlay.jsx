import { useEffect, useState } from 'react'
import { useLoading } from '../context/LoadingContext'
import SpaceBackground from './SpaceBackground'

const SRC_W    = 1254
const SRC_H    = 1254
const DISP_W   = 200
const DISP_H   = 200
const SCALE    = DISP_W / SRC_W
const SHEET_W  = Math.round(5020 * SCALE)
const SHEET_H  = Math.round(2508 * SCALE)
const TOTAL    = 8
const COLS     = 4
const FRAME_MS = 150

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
        background: 'linear-gradient(180deg, #4aa4dc 0%, #bfe8ff 30%, #7fc8f2 68%, #4aa4dc 100%)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 16,
        opacity: visible ? 1 : 0,
        transition: 'opacity 220ms ease',
        pointerEvents: visible ? 'all' : 'none',
      }}
      onTransitionEnd={() => { if (!visible) setMounted(false) }}
    >
      <SpaceBackground />

      {/* Sprite */}
      <div style={{
        width: DISP_W, height: DISP_H,
        overflow: 'hidden',
        position: 'relative',
        flexShrink: 0,
      }}>
        <img
          src="/logo_fly/angel_fly.webp"
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
        background: 'rgba(255,255,255,0.48)',
        border: '1px solid rgba(76, 159, 212, 0.28)',
        borderRadius: 4,
        overflow: 'hidden',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.58), 0 6px 12px rgba(54,132,185,0.16)',
      }}>
        <div style={{
          height: '100%',
          width: `${progress}%`,
          background: 'linear-gradient(90deg, #49bcf3, #188ccd)',
          borderRadius: 4,
          transition: 'width 300ms ease',
        }} />
      </div>
    </div>
  )
}
