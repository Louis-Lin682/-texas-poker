// CSS-based cloud animation — runs on compositor thread, no scroll flicker

function rand(min, max) { return Math.random() * (max - min) + min }

function makePuffs(n, cloudWvw) {
  const out = []
  for (let i = 0; i < n; i++) {
    const u     = rand(-0.85, 0.85)
    const dome  = 0.52 * Math.sqrt(Math.max(0, 1 - u * u))
    const pxPct = (u + 1) / 2 * 100
    const pyPct = 55 - dome * rand(0.25, 1) * 80 + rand(0, 6)
    const prPct = rand(18, 36) * (0.60 + 0.40 * (1 - Math.abs(u)))
    const prVw  = (prPct * cloudWvw / 100).toFixed(2)
    out.push({ pxPct: pxPct.toFixed(2), pyPct: pyPct.toFixed(2), prVw, top: pyPct < 52 })
  }
  return out
}

// [wVw, yVh, speedVwPerSec, nPuffs]
const CONFIGS = [
  [32,  8, 1.6,  7],
  [52, 20, 2.0, 10],
  [58, 15, 1.9, 10],
  [48, 30, 2.2, 10],
  [70, 36, 2.5, 12],
]

const CLOUDS = CONFIGS.map(([wVw, yVh, speed, nPuffs]) => {
  const travelVw = 100 + wVw
  const durS     = (travelVw / speed).toFixed(1)
  const delayS   = (-(rand(0, 1) * travelVw / speed)).toFixed(1)
  const bobDurS  = rand(7, 14).toFixed(1)
  const bobDelay = rand(-8, 0).toFixed(1)
  const alpha    = rand(0.76, 0.95).toFixed(2)
  return { wVw, yVh, durS, delayS, bobDurS, bobDelay, alpha, puffs: makePuffs(nPuffs, wVw) }
})

export default function SpaceBackground() {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {CLOUDS.map((c, ci) => (
        <div
          key={ci}
          className="sky-cloud-drift"
          style={{
            top:    `${c.yVh}vh`,
            width:  `${c.wVw}vw`,
            height: `${(c.wVw * 0.60).toFixed(1)}vw`,
            '--from':      `-${c.wVw}vw`,
            '--to':        '100vw',
            '--dur':       `${c.durS}s`,
            '--delay':     `${c.delayS}s`,
            '--bob-dur':   `${c.bobDurS}s`,
            '--bob-delay': `${c.bobDelay}s`,
          }}
        >
          <div className="sky-cloud-bob">
            {c.puffs.map((p, pi) => (
              <div
                key={pi}
                className={`sky-puff ${p.top ? 'sky-puff-top' : 'sky-puff-bot'}`}
                style={{
                  left:   `${p.pxPct}%`,
                  top:    `${p.pyPct}%`,
                  width:  `${p.prVw}vw`,
                  height: `${p.prVw}vw`,
                  '--a':  c.alpha,
                }}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Bottom mist — 2 footer heights */}
      <div className="sky-mist" />
    </div>
  )
}
