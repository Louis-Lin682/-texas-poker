import { useEffect, useState } from 'react'
import AngelFly from './AngelFly'

const CRITICAL_IMGS = [
  '/hero-banner.png',
  '/hero-banner-text.png',
  '/hero-banner-span.png',
  '/phantom-footer-logo.png',
  '/quick-actions/checkin.png',
  '/quick-actions/event.png',
  '/hot-badge.png',
]

const MAX_WAIT = 1800   // ms — never block longer than this

function LobbyIntroModal({ isOpen, onEnter }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    let done = false

    function finish() {
      if (done) return
      done = true
      setReady(true)
    }

    const timer = setTimeout(finish, MAX_WAIT)

    let loaded = 0
    const total = CRITICAL_IMGS.length
    CRITICAL_IMGS.forEach(src => {
      const img = new Image()
      img.onload  = () => { loaded++; if (loaded >= total) finish() }
      img.onerror = () => { loaded++; if (loaded >= total) finish() }
      img.src = src
    })

    return () => { done = true; clearTimeout(timer) }
  }, [isOpen])

  if (!isOpen) return null

  if (!ready) {
    return (
      <div className="auth-modal-backdrop lobby-intro-backdrop lobby-loading-screen" role="presentation" aria-label="載入中">
        <img src="/phantom-footer-logo.png" className="lobby-loading-logo" alt="logo" />
        <div className="lobby-loading-dots">
          <span /><span /><span />
        </div>
      </div>
    )
  }

  return (
    <div className="auth-modal-backdrop lobby-intro-backdrop" role="presentation">
      <div
        className="lobby-intro-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lobby-intro-title"
      >
        <AngelFly size={145} />
        <div className="lobby-intro-content">
          <h3 id="lobby-intro-title">歡迎回來</h3>
          <p>祝您遊戲愉快!</p>
        </div>
        <button type="button" className="lobby-intro-button" onClick={onEnter}>
          進入遊戲
        </button>
      </div>
    </div>
  )
}

export default LobbyIntroModal
