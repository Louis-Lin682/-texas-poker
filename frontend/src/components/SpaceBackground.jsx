import { useEffect, useRef } from 'react'

function rand(min, max) { return Math.random() * (max - min) + min }

function drawCloud(ctx, cx, cy, wPx, alpha) {
  const n      = Math.round(rand(12, 18))
  const baseR  = wPx * 0.24

  for (let i = 0; i < n; i++) {
    const u    = rand(-0.85, 0.85)
    const dome = 0.52 * Math.sqrt(Math.max(0, 1 - u * u))
    const px   = cx + u * wPx * 0.5
    const py   = cy - dome * rand(0.3, 1.0) * wPx * 0.38 + rand(-4, 4)
    const r    = baseR * rand(0.55, 1.0) * (0.65 + 0.35 * (1 - Math.abs(u)))
    const isTop = dome > 0.2

    const grad = ctx.createRadialGradient(
      px - r * 0.2, py - r * 0.2, 0,
      px, py, r
    )
    if (isTop) {
      grad.addColorStop(0,    `rgba(255,255,255,${alpha})`)
      grad.addColorStop(0.45, `rgba(240,250,255,${(alpha * 0.70).toFixed(2)})`)
      grad.addColorStop(0.75, `rgba(215,235,255,${(alpha * 0.25).toFixed(2)})`)
      grad.addColorStop(1,    `rgba(195,220,255,0)`)
    } else {
      grad.addColorStop(0,    `rgba(232,247,255,${(alpha * 0.92).toFixed(2)})`)
      grad.addColorStop(0.45, `rgba(210,232,252,${(alpha * 0.60).toFixed(2)})`)
      grad.addColorStop(0.75, `rgba(190,218,250,${(alpha * 0.18).toFixed(2)})`)
      grad.addColorStop(1,    `rgba(175,210,248,0)`)
    }

    ctx.beginPath()
    ctx.arc(px, py, r, 0, Math.PI * 2)
    ctx.fillStyle = grad
    ctx.fill()
  }
}

// [xPct, yPct, widthPct, alpha]
const CLOUD_DEFS = [
  [15,  8, 45, 0.88],
  [78, 15, 42, 0.90],
  [45, 25, 55, 0.82],
  [10, 38, 48, 0.85],
  [80, 42, 50, 0.80],
  [45, 55, 44, 0.83],
  [15, 65, 46, 0.81],
  [80, 68, 42, 0.84],
]

export default function SpaceBackground() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const w = window.innerWidth
    const h = window.innerHeight
    canvas.width  = w
    canvas.height = h
    const ctx = canvas.getContext('2d')

    const skyGrad = ctx.createLinearGradient(0, 0, 0, h)
    skyGrad.addColorStop(0,   '#4aa4dc')
    skyGrad.addColorStop(0.4, '#bfe8ff')
    skyGrad.addColorStop(0.7, '#7fc8f2')
    skyGrad.addColorStop(1,   '#4aa4dc')
    ctx.fillStyle = skyGrad
    ctx.fillRect(0, 0, w, h)

    CLOUD_DEFS.forEach(([xPct, yPct, wPct, alpha]) => {
      const cx   = w * xPct / 100
      const cy   = h * yPct / 100
      const wPx  = w * wPct / 100
      drawCloud(ctx, cx, cy, wPx, alpha)
    })
  }, [])

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{
          position: 'fixed', inset: 0, zIndex: 0,
          pointerEvents: 'none', width: '100%', height: '100%',
        }}
      />
      <div
        className="sky-mist"
        style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 0, pointerEvents: 'none' }}
      />
    </>
  )
}
