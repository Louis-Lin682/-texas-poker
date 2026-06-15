import { useEffect, useRef } from 'react'

const STAR_COUNT    = 220
const SHOOT_INTERVAL = 6000   // ms between shooting stars
const FPS_CAP       = 30      // lobby doesn't need 60fps

function rand(min, max) { return Math.random() * (max - min) + min }

export default function SpaceBackground() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    let raf
    let lastShoot = 0
    let lastFrame = 0
    const FRAME_MS = 1000 / FPS_CAP

    // ── Stars ──────────────────────────────────────────────
    const stars = Array.from({ length: STAR_COUNT }, () => {
      const isColored = Math.random() < 0.2
      return {
        x:     rand(0, 1),
        y:     rand(0, 1),
        r:     rand(0.5, 2.2),
        base:  rand(0.5, 1.0),         // 較高的基礎亮度
        speed: rand(0.0008, 0.004),    // 更快的閃爍速度
        phase: rand(0, Math.PI * 2),
        color: isColored ? 'colored' : '#ffffff',
        hue:   rand(190, 270),          // 藍紫色調
      }
    })

    // ── Shooting star state ────────────────────────────────
    let shoot = null

    function spawnShoot(W, H) {
      const angle = rand(20, 40) * Math.PI / 180
      const sx = rand(0.1, 0.7) * W
      const sy = rand(0.05, 0.3) * H
      shoot = {
        x: sx, y: sy,
        vx: Math.cos(angle) * rand(6, 10),
        vy: Math.sin(angle) * rand(4, 7),
        len: rand(80, 160),
        life: 1.0,
        decay: rand(0.018, 0.028),
      }
    }

    function resize() {
      const w = canvas.offsetWidth
      const h = canvas.offsetHeight
      if (!w || !h) return
      if (canvas.width === w && canvas.height === h) return
      canvas.width  = w
      canvas.height = h
    }

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()

    function draw() {
      raf = requestAnimationFrame(draw)
      const ts = Date.now()
      if (ts - lastFrame < FRAME_MS) return
      lastFrame = ts
      const W = canvas.width
      const H = canvas.height
      ctx.clearRect(0, 0, W, H)

      // ── Draw stars ───────────────────────────────────────
      for (const s of stars) {
        // 閃爍：從幾乎不可見到全亮，對比更強
        const osc   = 0.5 + 0.5 * Math.sin(ts * s.speed + s.phase)
        const alpha = s.base * osc   // base 0.2~1.0，乘以 0~1 的 osc

        const sx = s.x * W
        const sy = s.y * H

        // 大星：多畫一個半透明大圓當光暈（純 arc，GPU 友善）
        if (s.r > 1.2 && alpha > 0.4) {
          ctx.beginPath()
          ctx.arc(sx, sy, s.r * 3.5, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(180,160,255,${(alpha * 0.12).toFixed(2)})`
          ctx.fill()
        }

        ctx.beginPath()
        ctx.arc(sx, sy, s.r, 0, Math.PI * 2)
        ctx.fillStyle = s.color === '#ffffff'
          ? `rgba(255,255,255,${alpha.toFixed(2)})`
          : `hsla(${s.hue},80%,90%,${alpha.toFixed(2)})`
        ctx.fill()
      }

      // ── Shooting star ────────────────────────────────────
      if (!shoot && ts - lastShoot > SHOOT_INTERVAL) {
        lastShoot = ts
        spawnShoot(W, H)
      }

      if (shoot) {
        const tail = { x: shoot.x - Math.cos(Math.atan2(shoot.vy, shoot.vx)) * shoot.len,
                       y: shoot.y - Math.sin(Math.atan2(shoot.vy, shoot.vx)) * shoot.len }
        const grad = ctx.createLinearGradient(tail.x, tail.y, shoot.x, shoot.y)
        grad.addColorStop(0, `rgba(255,255,255,0)`)
        grad.addColorStop(1, `rgba(255,255,255,${(shoot.life * 0.9).toFixed(2)})`)
        ctx.beginPath()
        ctx.moveTo(tail.x, tail.y)
        ctx.lineTo(shoot.x, shoot.y)
        ctx.strokeStyle = grad
        ctx.lineWidth = 1.5
        ctx.stroke()

        shoot.x    += shoot.vx
        shoot.y    += shoot.vy
        shoot.life -= shoot.decay
        if (shoot.life <= 0 || shoot.x > W || shoot.y > H) {
          shoot = null
          lastShoot = ts
        }
      }

    }

    raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
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
