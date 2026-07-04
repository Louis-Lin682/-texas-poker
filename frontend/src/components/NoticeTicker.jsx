import { useLayoutEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

function GearIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function NoticeTicker({ text }) {
  const trackRef = useRef(null)
  const navigate = useNavigate()

  useLayoutEffect(() => {
    const el = trackRef.current
    if (!el || !text) return
    let rafId
    const measure = () => {
      const dist = el.scrollWidth / 2
      if (dist > 0) {
        el.style.animationDuration = `${Math.max(5, dist / 70).toFixed(1)}s`
      } else {
        rafId = requestAnimationFrame(measure)
      }
    }
    measure()
    return () => cancelAnimationFrame(rafId)
  }, [text])

  return (
    <div className="notice-wrap">
      <div className="top-notice">
        <img className="noticeLoudspeaker" src="/Loudspeaker.webp" alt="Loudspeaker" />
        <div className="notice-marquee">
          {text && (
            <div key={text} ref={trackRef} className="notice-track">
              <span>{text}</span>
              <span aria-hidden="true">{text}</span>
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        className="notice-settings"
        aria-label="前往設定"
        onClick={() => navigate('/settings')}
      >
        <GearIcon />
      </button>
    </div>
  )
}

export default NoticeTicker
