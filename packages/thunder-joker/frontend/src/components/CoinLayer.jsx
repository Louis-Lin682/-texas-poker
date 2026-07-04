import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

const CFG = {
  rain:  { fw: 160, fh: 130, dw: 50, dh: 41, cols: 6 },
  burst: { fw: 160, fh: 160, dw: 55, dh: 55, cols: 6 },
}

// Atlases loaded lazily — module-level object, populated on first mount
const IMGS = {}

function r(a, b) { return a + Math.random() * (b - a) }

function makeBurst(cx, cy, count) {
  const out = []
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + r(-0.2, 0.2)
    const spd   = r(200, 560)
    out.push({
      type: 'burst',
      x: cx + r(-10, 10), y: cy + r(-10, 10),
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd - 240,
      rot: r(0, Math.PI * 2), rotSpd: r(-8, 8),
      frame: Math.floor(Math.random() * 12), ft: 0,
      fps: r(22, 32),
      scale: r(0.75, 1.35),
      alpha: 1, age: 0, maxAge: 1600,
    })
  }
  return out
}

function makeRain(W) {
  return {
    type: 'rain',
    x: r(20, W - 60), y: -60,
    vx: r(-25, 25), vy: r(100, 170),
    rot: r(0, Math.PI * 2), rotSpd: r(-3, 3),
    frame: Math.floor(Math.random() * 12), ft: 0,
    fps: r(18, 26),
    scale: r(0.75, 1.15),
    alpha: 1, age: 0, maxAge: 2800,
  }
}

export const CoinLayer = forwardRef(function CoinLayer(_, ref) {
  const canvasRef = useRef(null)
  const S = useRef({         // mutable state, never triggers re-render
    particles: [],
    rafId:     null,
    lastTs:    null,
    rainId:    null,
    rainMax:   20,
    rainMs:    150,
  })

  // ── RAF render loop ─────────────────────────────────────────
  function ensureLoop() {
    const s = S.current
    if (s.rafId) return
    s.lastTs = null
    function tick(now) {
      const canvas = canvasRef.current
      if (!canvas) { s.rafId = null; return }

      // Use parent dims — more reliable than canvas.offsetWidth in flex contexts
      const parent = canvas.parentElement
      const cw = (parent?.offsetWidth  || canvas.offsetWidth  || 390)
      const ch = (parent?.offsetHeight || canvas.offsetHeight || 700)
      if (canvas.width !== cw)  canvas.width  = cw
      if (canvas.height !== ch) canvas.height = ch

      const dt = s.lastTs ? Math.min((now - s.lastTs) / 1000, 0.05) : 0.016
      s.lastTs = now

      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, cw, ch)

      s.particles = s.particles.filter(p => {
        p.age += dt * 1000
        if (p.age >= p.maxAge) return false

        p.vy  += 900 * dt
        p.x   += p.vx * dt
        p.y   += p.vy * dt
        p.rot += p.rotSpd * dt
        p.ft  += dt * 1000
        if (p.ft >= 1000 / p.fps) { p.frame = (p.frame + 1) % 12; p.ft = 0 }

        // Fade out last 35% of life
        const fadeStart = p.maxAge * 0.65
        p.alpha = p.age > fadeStart
          ? Math.max(0, 1 - (p.age - fadeStart) / (p.maxAge - fadeStart))
          : 1

        if (p.y > ch + 80) return false

        // Draw
        const img = IMGS[p.type]
        if (!img?.complete || !img.naturalWidth) return true
        const c  = CFG[p.type]
        const col = p.frame % c.cols
        const row = Math.floor(p.frame / c.cols)
        const dw  = c.dw * p.scale
        const dh  = c.dh * p.scale

        ctx.save()
        ctx.globalAlpha = p.alpha
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.drawImage(img, col * c.fw, row * c.fh, c.fw, c.fh, -dw / 2, -dh / 2, dw, dh)
        ctx.restore()
        return true
      })

      if (s.particles.length > 0 || s.rainId) {
        s.rafId = requestAnimationFrame(tick)
      } else {
        s.rafId  = null
        s.lastTs = null
        ctx.clearRect(0, 0, cw, ch)
      }
    }
    s.rafId = requestAnimationFrame(tick)
  }

  // ── Public API ───────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    startRain(intensity = 'normal') {
      const s = S.current
      if (s.rainId) return
      const cfg = { normal: [20, 150], heavy: [30, 100], storm: [42, 72] }[intensity] ?? [20, 150]
      s.rainMax = cfg[0]; s.rainMs = cfg[1]
      s.rainId = setInterval(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const alive = s.particles.filter(p => p.type === 'rain').length
        if (alive >= s.rainMax) return
        const W = canvas.parentElement?.offsetWidth || canvas.offsetWidth || 390
        s.particles.push(makeRain(W))
        ensureLoop()
      }, s.rainMs)
      ensureLoop()
    },

    stopRain() {
      const s = S.current
      if (s.rainId) { clearInterval(s.rainId); s.rainId = null }
    },

    rainBurst(n = 5) {
      const canvas = canvasRef.current
      if (!canvas) return
      const W = canvas.parentElement?.offsetWidth || canvas.offsetWidth || 390
      const s = S.current
      for (let i = 0; i < n; i++) {
        setTimeout(() => { s.particles.push(makeRain(W)); ensureLoop() }, r(0, 700))
      }
    },

    burst(cx, cy, count = 28) {
      const s = S.current
      s.particles.push(...makeBurst(cx, cy, Math.round(count)))
      ensureLoop()
    },

    clear() {
      const s = S.current
      if (s.rainId) { clearInterval(s.rainId); s.rainId = null }
      if (s.rafId)  { cancelAnimationFrame(s.rafId); s.rafId = null }
      s.particles = []; s.lastTs = null
      const canvas = canvasRef.current
      if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
    },
  }), [])

  // On mount: size canvas + preload atlases (only when user enters TJ page)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    canvas.width  = parent?.offsetWidth  || canvas.offsetWidth  || 390
    canvas.height = parent?.offsetHeight || canvas.offsetHeight || 700

    ;[['rain', '/slot-imgs/rain/rain_coins.webp'], ['burst', '/slot-imgs/burst/burst_coins.webp']].forEach(([k, src]) => {
      if (IMGS[k]) return
      const img = new Image()
      img.src = src
      IMGS[k] = img
    })

    // While hidden, RAF pauses but setInterval keeps spawning particles at y=-60.
    // On return, all those unseen particles start at the same y → horizontal line.
    // Fix: reset lastTs on hide (so dt=0.016 on resume), filter undrawn particles on show.
    function onVisibility() {
      const s = S.current
      if (document.hidden) {
        s.lastTs = null
      } else {
        s.particles = s.particles.filter(p => p.y > -50)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  return <canvas ref={canvasRef} className="tj-coin-layer" aria-hidden="true" />
})
