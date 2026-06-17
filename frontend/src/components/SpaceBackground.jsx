import { useEffect, useRef } from 'react'

const CLOUD_COUNT    = 9
const SHOOT_INTERVAL = 6000   // ms between shooting stars
const FPS_CAP        = 30     // lobby doesn't need 60fps

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

    const clouds = Array.from({ length: CLOUD_COUNT }, () => ({
      x:     rand(-0.18, 1.08),
      y:     rand(0.03, 0.72),
      scale: rand(0.7, 1.55),
      speed: rand(0.000012, 0.000035),
      alpha: rand(0.36, 0.62),
      phase: rand(0, Math.PI * 2),
    }))

    // Shooting star state
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

    function drawCloud(cloud, W, H, ts) {
      const bob = Math.sin(ts * 0.00045 + cloud.phase) * 5
      const x = cloud.x * W
      const y = cloud.y * H + bob
      const s = Math.max(W, H) * 0.054 * cloud.scale

      ctx.save()
      ctx.translate(x, y)
      ctx.scale(s, s)

      const glow = ctx.createRadialGradient(0, 0, 0.15, 0, 0, 2.25)
      glow.addColorStop(0, `rgba(255,255,255,${(cloud.alpha * 0.52).toFixed(2)})`)
      glow.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.ellipse(0.05, 0.08, 2.45, 1.05, 0, 0, Math.PI * 2)
      ctx.fill()

      ctx.fillStyle = `rgba(255,255,255,${cloud.alpha.toFixed(2)})`
      ctx.shadowColor = 'rgba(45, 125, 180, 0.16)'
      ctx.shadowBlur = 16
      ctx.beginPath()
      ctx.ellipse(-1.05, 0.18, 0.95, 0.45, -0.08, 0, Math.PI * 2)
      ctx.ellipse(-0.4, -0.08, 0.82, 0.58, 0.08, 0, Math.PI * 2)
      ctx.ellipse(0.35, -0.18, 1.05, 0.68, -0.03, 0, Math.PI * 2)
      ctx.ellipse(1.12, 0.12, 0.9, 0.48, 0.05, 0, Math.PI * 2)
      ctx.ellipse(0.12, 0.34, 1.58, 0.42, 0, 0, Math.PI * 2)
      ctx.fill()

      ctx.restore()
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

      for (const cloud of clouds) {
        drawCloud(cloud, W, H, ts)
        cloud.x += cloud.speed * FRAME_MS
        if (cloud.x > 1.2) {
          cloud.x = -0.25
          cloud.y = rand(0.03, 0.72)
          cloud.scale = rand(0.7, 1.55)
          cloud.alpha = rand(0.36, 0.62)
        }
      }

      // Shooting star
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
