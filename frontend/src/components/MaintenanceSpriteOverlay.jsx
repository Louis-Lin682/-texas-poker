import { useEffect, useState } from 'react'

const COLS = 4
const ROWS = 4
const FRAME_COUNT = 16

function SpriteFrame({ atlas, fps = 10, randomSpeed = false, className }) {
  const [frame, setFrame] = useState(() =>
    randomSpeed ? Math.floor(Math.random() * FRAME_COUNT) : 0
  )

  useEffect(() => {
    let id
    const advance = () => setFrame(f => (f + 1) % FRAME_COUNT)

    if (randomSpeed) {
      const schedule = () => {
        id = setTimeout(() => { advance(); schedule() }, 90 + Math.random() * 90)
      }
      schedule()
      return () => clearTimeout(id)
    }

    id = setInterval(advance, 1000 / fps)
    return () => clearInterval(id)
  }, [fps, randomSpeed])

  const col = frame % COLS
  const row = Math.floor(frame / COLS)
  const bgX = COLS > 1 ? col / (COLS - 1) * 100 : 0
  const bgY = ROWS > 1 ? row / (ROWS - 1) * 100 : 0

  return (
    <span
      className={className}
      style={{
        backgroundImage: `url('${atlas}')`,
        backgroundSize: `${COLS * 100}% ${ROWS * 100}%`,
        backgroundPosition: `${bgX}% ${bgY}%`,
        backgroundRepeat: 'no-repeat',
      }}
    />
  )
}

export function MaintenanceSpriteImage() {
  return (
    <div className="maintenance-overlay-image-wrap">
      <SpriteFrame
        atlas="/fire/fire.png"
        randomSpeed
        className="maint-sprite maint-sprite-fire"
      />
    </div>
  )
}

function MaintenanceSpriteOverlay() {
  return (
    <div className="maintenance-overlay" aria-hidden="true">
      <MaintenanceSpriteImage />
      <div className="maintenance-copy">
        <strong>維護中</strong>
        <span>敬請期待</span>
      </div>
    </div>
  )
}

export default MaintenanceSpriteOverlay
