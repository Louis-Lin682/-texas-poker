import { forwardRef, useImperativeHandle, useRef } from 'react'

// Both atlases: 1024×512 sheet (TexturePacker adds padding to power-of-2)
// rain:  frame 160×130, 6×2 grid.  display 50×41 → scale=50/160=0.3125 → bgW=1024×0.3125=320, bgH=512×0.3125=160
// burst: frame 160×160, 6×2 grid.  display 55×55 → scale=55/160=0.34375 → bgW=1024×0.34375=352, bgH=512×0.34375=176
const CFG = {
  rain: {
    img:    '/slot-imgs/rain/rain_coins.png',
    dispW:  50,  dispH:  41,
    bgW:   320,  bgH:   160,
    cols:    6,
  },
  burst: {
    img:    '/slot-imgs/burst/burst_coins.png',
    dispW:  55,  dispH:  55,
    bgW:   352,  bgH:   176,
    cols:    6,
  },
}

function rand(a, b) { return a + Math.random() * (b - a) }

function createCoin(layer, type) {
  const c   = CFG[type]
  const el  = document.createElement('div')
  el.className = `tj-coin-sprite tj-coin-${type}`
  // Set atlas image + size via inline style so no separate CSS needed
  el.style.cssText = [
    `width:${c.dispW}px`,
    `height:${c.dispH}px`,
    `background-image:url('${c.img}')`,
    `background-size:${c.bgW}px ${c.bgH}px`,
    `background-repeat:no-repeat`,
  ].join(';')
  layer.appendChild(el)
  return el
}

function setFrame(el, frame, type) {
  const { cols, dispW, dispH } = CFG[type]
  const col = frame % cols
  const row = Math.floor(frame / cols)
  el.style.backgroundPosition = `-${col * dispW}px -${row * dispH}px`
}

function startSpin(el, type, fps) {
  let frame = Math.floor(Math.random() * 12)
  setFrame(el, frame, type)
  const id = setInterval(() => {
    frame = (frame + 1) % 12
    setFrame(el, frame, type)
  }, 1000 / fps)
  el._spinId = id
}

function stopSpin(el) {
  if (el._spinId) { clearInterval(el._spinId); el._spinId = null }
}

export const CoinLayer = forwardRef(function CoinLayer(_, ref) {
  const layerRef = useRef(null)
  const rainTimer = useRef(null)

  useImperativeHandle(ref, () => ({
    startRain() {
      if (rainTimer.current) return
      const layer = layerRef.current
      if (!layer) return
      const W = layer.offsetWidth || 390

      rainTimer.current = setInterval(() => {
        const alive = layer.querySelectorAll('.tj-coin-rain').length
        if (alive >= 10) return

        const x     = rand(20, W - 60)
        const drift = rand(-35, 35)
        const scale = rand(0.75, 1.15)
        const fps   = rand(18, 26)

        const coin = createCoin(layer, 'rain')
        coin.style.left = `${x}px`
        coin.style.top  = '-60px'
        startSpin(coin, 'rain', fps)

        coin.animate([
          { transform: `translate(0,0) scale(${scale}) rotate(0deg)`, opacity: 0.9 },
          { transform: `translate(${drift}px,960px) scale(${scale * 0.9}) rotate(${rand(180, 540)}deg)`, opacity: 0.1 },
        ], { duration: 2600, easing: 'linear', fill: 'forwards' })
          .onfinish = () => { stopSpin(coin); coin.remove() }
      }, 240)
    },

    stopRain() {
      if (rainTimer.current) { clearInterval(rainTimer.current); rainTimer.current = null }
    },

    rainBurst(n = 5) {
      const layer = layerRef.current
      if (!layer) return
      const W = layer.offsetWidth || 390
      for (let i = 0; i < n; i++) {
        const x     = rand(20, W - 60)
        const drift = rand(-35, 35)
        const scale = rand(0.75, 1.15)
        const fps   = rand(18, 26)
        const coin  = createCoin(layer, 'rain')
        coin.style.left = `${x}px`
        coin.style.top  = '-60px'
        startSpin(coin, 'rain', fps)
        coin.animate([
          { transform: `translate(0,0) scale(${scale}) rotate(0deg)`, opacity: 0.9 },
          { transform: `translate(${drift}px,960px) scale(${scale * 0.9}) rotate(${rand(180, 540)}deg)`, opacity: 0.1 },
        ], { duration: 2600, easing: 'linear', fill: 'forwards' })
          .onfinish = () => { stopSpin(coin); coin.remove() }
      }
    },

    burst(cx, cy) {
      const layer = layerRef.current
      if (!layer) return
      const COUNT = 28

      for (let i = 0; i < COUNT; i++) {
        const angle = (i / COUNT) * Math.PI * 2 + rand(-0.18, 0.18)
        const spd   = rand(260, 620)
        const vx    = Math.cos(angle) * spd
        const vy    = Math.sin(angle) * spd - 260
        const scale = rand(0.75, 1.35)
        const fps   = rand(22, 32)
        const t     = 1.6  // seconds
        const dx    = vx * t
        const dy    = vy * t + 0.5 * 900 * t * t

        const coin = createCoin(layer, 'burst')
        coin.style.left = `${cx + rand(-12, 12)}px`
        coin.style.top  = `${cy + rand(-12, 12)}px`
        startSpin(coin, 'burst', fps)

        coin.animate([
          { transform: `translate(0,0) scale(${scale}) rotate(0deg)`, opacity: 1 },
          { transform: `translate(${dx}px,${dy}px) scale(${scale * 0.85}) rotate(${rand(420, 1080)}deg)`, opacity: 0 },
        ], { duration: 1600, easing: 'cubic-bezier(.15,.8,.25,1)', fill: 'forwards' })
          .onfinish = () => { stopSpin(coin); coin.remove() }
      }
    },

    clear() {
      if (rainTimer.current) { clearInterval(rainTimer.current); rainTimer.current = null }
      layerRef.current?.querySelectorAll('.tj-coin-sprite')
        .forEach(c => { stopSpin(c); c.remove() })
    },
  }), [])

  return <div ref={layerRef} className="tj-coin-layer" aria-hidden="true" />
})
