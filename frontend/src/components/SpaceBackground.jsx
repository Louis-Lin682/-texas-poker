import { useEffect, useRef } from 'react'

const FPS_CAP  = 24
const FRAME_MS = 1000 / FPS_CAP

function rand(min, max) { return Math.random() * (max - min) + min }

// Puff layout normalized to [-1,1] in x, relative in y
// Dome shape: higher toward center, flat base
function makePuffs(n) {
  const out = []
  for (let i = 0; i < n; i++) {
    const u    = rand(-0.88, 0.88)
    const dome = 0.52 * Math.sqrt(Math.max(0, 1 - u * u))
    const px   = u
    const py   = -dome * rand(0.22, 1) + rand(0, 0.12)
    const pr   = rand(0.20, 0.40) * (0.60 + 0.40 * (1 - Math.abs(u)))
    out.push([px, py, pr, py < 0])
  }
  return out.sort((a, b) => b[1] - a[1])  // bottom → top
}

// Cloud templates (puffs generated once, reused each frame)
const TEMPLATES = [
  { wn: 0.40, puffs: makePuffs(12) },
  { wn: 0.45, puffs: makePuffs(13) },
  { wn: 0.38, puffs: makePuffs(11) },
  { wn: 0.62, puffs: makePuffs(17) },
  { wn: 0.68, puffs: makePuffs(18) },
  { wn: 0.58, puffs: makePuffs(16) },
  { wn: 0.82, puffs: makePuffs(22) },
  { wn: 0.75, puffs: makePuffs(20) },
]

// y-range per layer so clouds spread naturally
const Y_RANGES = [
  [0.05, 0.30], [0.06, 0.28], [0.08, 0.32],   // back
  [0.20, 0.48], [0.16, 0.44], [0.22, 0.50],   // mid
  [0.36, 0.62], [0.32, 0.58],                  // front
]
const SPEEDS = [
  [0.000018, 0.000028],
  [0.000020, 0.000030],
  [0.000016, 0.000026],
  [0.000032, 0.000050],
  [0.000030, 0.000048],
  [0.000035, 0.000055],
  [0.000055, 0.000080],
  [0.000050, 0.000075],
]

export default function SpaceBackground() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    let raf, lastFrame = Date.now()
    let W = 0, H = 0

    // Mutable cloud state
    const clouds = TEMPLATES.map((tpl, i) => ({
      ...tpl,
      x:     rand(-0.1, 1.1),
      y:     rand(...Y_RANGES[i]),
      speed: rand(...SPEEDS[i]),
      alpha: rand(0.72, 0.94),
      phase: rand(0, Math.PI * 2),
    }))

    // Static bottom blobs (drifts slowly via ts)
    const BOTTOM_BLOBS = [
      [0.12, 0.80, 0.52], [0.42, 0.74, 0.62], [0.78, 0.82, 0.50],
      [0.62, 0.90, 0.58], [0.25, 0.94, 0.44], [0.88, 0.70, 0.42],
      [0.50, 0.68, 0.55], [0.05, 0.92, 0.38],
    ]

    function drawCloud(c, ts) {
      const bob = Math.sin(ts * 0.00042 + c.phase) * 4
      const cx  = c.x * W
      const cy  = c.y * H + bob
      const cw  = c.wn * W
      const a   = c.alpha

      for (const [px, py, pr, top] of c.puffs) {
        const x = cx + px * cw * 0.5
        const y = cy + py * cw * 0.48   // use cw for both axes → round puffs
        const r = pr * cw * 0.5

        const lx = x - r * 0.22
        const ly = y - r * 0.28

        const g = ctx.createRadialGradient(lx, ly, r * 0.04, x, y, r)
        if (top) {
          g.addColorStop(0,    `rgba(255,255,255,${a.toFixed(2)})`)
          g.addColorStop(0.45, `rgba(248,253,255,${(a * 0.85).toFixed(2)})`)
          g.addColorStop(0.80, `rgba(228,242,255,${(a * 0.44).toFixed(2)})`)
        } else {
          g.addColorStop(0,    `rgba(232,247,255,${(a * 0.96).toFixed(2)})`)
          g.addColorStop(0.45, `rgba(215,234,252,${(a * 0.74).toFixed(2)})`)
          g.addColorStop(0.80, `rgba(198,220,248,${(a * 0.34).toFixed(2)})`)
        }
        g.addColorStop(1, 'rgba(190,215,248,0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    function drawBottomMist(ts) {
      // Soft white gradient rising from the bottom
      const mistTop = H * 0.52
      const mg = ctx.createLinearGradient(0, mistTop, 0, H)
      mg.addColorStop(0,   'rgba(255,255,255,0)')
      mg.addColorStop(0.35, 'rgba(255,255,255,0.42)')
      mg.addColorStop(1,   'rgba(255,255,255,0.88)')
      ctx.fillStyle = mg
      ctx.fillRect(0, mistTop, W, H - mistTop)

      // Large cloud blobs in the lower area
      for (const [bxn, byn, brn] of BOTTOM_BLOBS) {
        const drift = Math.sin(ts * 0.00018 + bxn * 5.3) * W * 0.018
        const bx = bxn * W + drift
        const by = byn * H
        const br = brn * W

        const g = ctx.createRadialGradient(bx - br * 0.20, by - br * 0.24, br * 0.04, bx, by, br)
        g.addColorStop(0,    'rgba(255,255,255,0.94)')
        g.addColorStop(0.50, 'rgba(244,251,255,0.74)')
        g.addColorStop(0.82, 'rgba(218,236,252,0.36)')
        g.addColorStop(1,    'rgba(198,220,250,0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(bx, by, br, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    function resize() {
      const w = canvas.offsetWidth  || window.innerWidth
      const h = canvas.offsetHeight || window.innerHeight
      if (!w || !h) return
      canvas.width  = w
      canvas.height = h
      W = w
      H = h
    }

    function draw() {
      raf = requestAnimationFrame(draw)
      const ts = Date.now()
      if (ts - lastFrame < FRAME_MS) return
      const dt = Math.min(ts - lastFrame, 80)
      lastFrame = ts
      if (!W || !H) return

      ctx.clearRect(0, 0, W, H)

      // Bottom mist first (behind clouds)
      drawBottomMist(ts)

      // Clouds back → front
      for (const c of clouds) {
        drawCloud(c, ts)
        c.x += c.speed * dt
        if (c.x > 1 + c.wn * 0.5) {   // left edge fully past right side
          c.x = -c.wn * 0.5 - 0.08    // right edge just off left side
          c.y = rand(0.05, 0.62)
        }
      }
    }

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()
    requestAnimationFrame(resize)

    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
        willChange: 'transform',
        transform: 'translateZ(0)',
      }}
    />
  )
}
