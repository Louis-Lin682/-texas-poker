import { forwardRef, useImperativeHandle, useRef } from 'react'

function makePath(x1, y1, x2, y2, depth) {
  if (depth === 0) return [[x1, y1], [x2, y2]]
  const len    = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
  const jitter = len * 0.28
  const mx = (x1 + x2) / 2 + (Math.random() - 0.5) * jitter
  const my = (y1 + y2) / 2 + (Math.random() - 0.5) * jitter * 0.25
  return [
    ...makePath(x1, y1, mx, my, depth - 1),
    ...makePath(mx, my, x2, y2, depth - 1).slice(1),
  ]
}

function r(a, b) { return a + Math.random() * (b - a) }

export const LightningLayer = forwardRef(function LightningLayer(_, ref) {
  const canvasRef = useRef(null)
  const stateRef  = useRef({ bolts: [], rafId: null, flashingId: null })

  function syncSize() {
    const c = canvasRef.current
    if (!c) return false
    if (c.width !== c.offsetWidth || c.height !== c.offsetHeight) {
      c.width  = c.offsetWidth  || 390
      c.height = c.offsetHeight || 700
    }
    return c.width > 0 && c.height > 0
  }

  function loop() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx   = canvas.getContext('2d')
    const state = stateRef.current
    const now   = performance.now()

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    state.bolts = state.bolts.filter(bolt => {
      const age = now - bolt.startTime
      if (age < 0) return true       // not yet visible (staggered)
      if (age >= bolt.duration) return false
      const alpha = 1 - age / bolt.duration

      ctx.save()

      // Glow pass
      ctx.shadowBlur   = 14
      ctx.shadowColor  = bolt.color
      ctx.strokeStyle  = bolt.color
      ctx.lineWidth    = 2.5
      ctx.globalAlpha  = alpha * 0.85
      ctx.beginPath()
      bolt.path.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y))
      ctx.stroke()

      // White core
      ctx.shadowBlur  = 0
      ctx.strokeStyle = '#FFFFFF'
      ctx.lineWidth   = 1
      ctx.globalAlpha = alpha * 0.7
      ctx.beginPath()
      bolt.path.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y))
      ctx.stroke()

      // Branches
      bolt.branches.forEach(br => {
        ctx.strokeStyle = bolt.color
        ctx.lineWidth   = 1.2
        ctx.globalAlpha = alpha * 0.55
        ctx.shadowBlur  = 8
        ctx.shadowColor = bolt.color
        ctx.beginPath()
        br.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y))
        ctx.stroke()
      })

      ctx.restore()
      return true
    })

    if (state.bolts.length > 0) {
      state.rafId = requestAnimationFrame(loop)
    } else {
      state.rafId = null
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
  }

  function addBolt(W, H, color, stagger = 0) {
    const x1 = W * r(0.1, 0.9)
    const y1 = Math.random() < 0.75 ? 0 : H * r(0, 0.1)
    const x2 = W * r(0.05, 0.95)
    const y2 = H * r(0.2, 0.72)

    const path     = makePath(x1, y1, x2, y2, 4)
    const branches = []
    const nBranch  = Math.random() < 0.55 ? 1 : 2
    for (let b = 0; b < nBranch; b++) {
      const idx = Math.floor(path.length * r(0.3, 0.65))
      const bp  = path[idx]
      if (bp) {
        const bx = bp[0] + r(-0.3, 0.3) * W
        const by = bp[1] + r(0.05, 0.28) * H
        branches.push(makePath(bp[0], bp[1], bx, by, 2))
      }
    }

    stateRef.current.bolts.push({
      path,
      branches,
      startTime: performance.now() + stagger,
      duration:  r(280, 460),
      color,
    })

    if (!stateRef.current.rafId) {
      stateRef.current.rafId = requestAnimationFrame(loop)
    }
  }

  useImperativeHandle(ref, () => ({
    flash(count = 1, color = '#88EEFF') {
      if (!syncSize()) return
      const canvas = canvasRef.current
      for (let i = 0; i < count; i++) {
        addBolt(canvas.width, canvas.height, color, i * r(15, 65))
      }
    },

    startFlashing(count, intervalMs, color = '#88EEFF') {
      const state = stateRef.current
      if (state.flashingId) return
      if (!syncSize()) return
      const canvas = canvasRef.current
      const doFlash = () => {
        if (!canvasRef.current) return
        syncSize()
        for (let i = 0; i < count; i++) {
          addBolt(canvas.width, canvas.height, color, i * r(15, 65))
        }
      }
      doFlash()
      state.flashingId = setInterval(doFlash, intervalMs)
    },

    stopFlashing() {
      const state = stateRef.current
      if (state.flashingId) { clearInterval(state.flashingId); state.flashingId = null }
    },

    clear() {
      const state = stateRef.current
      if (state.flashingId) { clearInterval(state.flashingId); state.flashingId = null }
      if (state.rafId)      { cancelAnimationFrame(state.rafId); state.rafId = null }
      const canvas = canvasRef.current
      if (canvas) {
        const ctx = canvas.getContext('2d')
        ctx.clearRect(0, 0, canvas.width, canvas.height)
      }
      state.bolts = []
    },
  }), [])

  return (
    <canvas
      ref={canvasRef}
      className="tj-lightning-layer"
      aria-hidden="true"
    />
  )
})
