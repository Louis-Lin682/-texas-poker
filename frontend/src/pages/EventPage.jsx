import { useEffect, useState } from 'react'
import PageShell from '../components/PageShell'
import VipPageHeader from '../components/VipPageHeader'
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

function EventPage() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    getEvents()
      .then(data => setEvents(data.events ?? []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const hasCountdown = events.some(e => e.end_at)
    if (!hasCountdown) return
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [events])

  return (
    <PageShell title="" accent="#d4af37">
      <VipPageHeader title="優惠活動" eyebrow="VIP EXCLUSIVE EVENT" />

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
                {ev.image_url && (
                  <img className="event-card-img" src={ev.image_url} alt={ev.title} />
                )}
                <h3 className="event-title">{ev.title}</h3>
                <p className="event-desc">{ev.description}</p>
                <button type="button" className="event-join-btn">立即參與</button>
              </div>
            )
          })}
        </div>
      )}
    </PageShell>
  )
}

export default EventPage
