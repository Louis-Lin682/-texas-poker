import { useEffect, useState } from 'react'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { getEvents } from '../services/eventApi'

function fmtCountdown(end_at) {
  if (!end_at) return null
  const ms = new Date(end_at) - Date.now()
  if (ms <= 0) return null
  const d = Math.floor(ms / 86400000)
  const h = Math.floor((ms % 86400000) / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const hh = String(h).padStart(2, '0')
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return d > 0 ? `${d}天 ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`
}

function EventDrawer({ isOpen, onClose }) {
  const [shouldRender, setShouldRender] = useState(isOpen)
  const [isClosing, setIsClosing] = useState(false)
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true)
      setIsClosing(false)
      setLoading(true)
      getEvents()
        .then(data => setEvents(data.events ?? []))
        .catch(() => setEvents([]))
        .finally(() => setLoading(false))
      return
    }
    if (!shouldRender) return
    setIsClosing(true)
    const timer = window.setTimeout(() => {
      setShouldRender(false)
      setIsClosing(false)
    }, 280)
    return () => window.clearTimeout(timer)
  }, [isOpen, shouldRender])

  useEffect(() => {
    const hasCountdown = events.some(e => e.end_at)
    if (!hasCountdown) return
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [events])

  useBodyScrollLock(isOpen)

  if (!shouldRender) return null

  return (
    <div
      className={`drawer-backdrop ${isClosing ? 'is-closing' : 'is-open'}`}
      role="presentation"
      onClick={onClose}
    >
      <section
        className={`event-drawer ${isClosing ? 'is-closing' : 'is-open'}`}
        role="dialog"
        aria-modal="true"
        aria-label="限時活動"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-handle" aria-hidden="true" />
        <div className="event-drawer-header">
          <div className="event-header-content">
            <button type="button" className="event-drawer-close" onClick={onClose} aria-label="關閉">✕</button>
            <span className="event-header-eyebrow">VIP EXCLUSIVE EVENT</span>
            <div className="event-header-title-row">
              <span className="event-header-title-line" aria-hidden="true" />
              <h2 className="event-header-title">優惠活動</h2>
              <span className="event-header-title-line" aria-hidden="true" />
            </div>
          </div>
        </div>
        <div className="event-drawer-body">
          {loading && <div className="event-loading">載入中…</div>}
          {!loading && events.length === 0 && (
            <div className="event-empty">目前沒有進行中的活動</div>
          )}
          {!loading && events.length > 0 && (
            <div className="event-list">
              {events.map((ev) => {
                const countdown = fmtCountdown(ev.end_at)
                return (
                  <div
                    key={ev.id}
                    className={`event-card ${ev.is_hot ? 'is-hot' : ''}`}
                    style={{ '--ev-color': ev.tag_color }}
                  >
                    <div className="event-card-top">
                      <span className="event-tag" style={{ color: ev.tag_color, borderColor: ev.tag_color }}>
                        {ev.tag}
                      </span>
                      {ev.is_hot && <span className="event-hot-badge">HOT</span>}
                      <span className="event-ends">
                        {countdown ? `剩 ${countdown}` : '長期活動'}
                      </span>
                    </div>
                    <h3 className="event-title">{ev.title}</h3>
                    <p className="event-desc">{ev.description}</p>
                    <button type="button" className="event-join-btn">立即參與</button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

export default EventDrawer
