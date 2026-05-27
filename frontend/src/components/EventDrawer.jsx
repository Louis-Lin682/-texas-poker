import { useEffect, useState } from 'react'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'

const EVENTS = [
  {
    id: 1,
    tag: '限時',
    tagColor: '#57d46f',
    title: '週末籌碼風暴',
    desc: '週六、週日期間每局遊戲額外獲得 2 倍籌碼獎勵，打越多賺越多，把握時機衝排行。',
    ends: '2026/05/24 23:59',
    countdown: '04天 14:22:08',
    hot: true,
  },
  {
    id: 2,
    tag: '首儲',
    tagColor: '#f0c96b',
    title: '首儲雙倍回饋',
    desc: '首次完成儲值即享 100% 回饋，最高可獲 50,000 籌碼。新手上路最佳助力，限量名額快速領取。',
    ends: '2026/05/31 23:59',
    countdown: '11天 14:22:08',
  },
  {
    id: 3,
    tag: '新手',
    tagColor: '#4fd0ff',
    title: '新手登場禮包',
    desc: '完成帳號註冊並進行首局遊戲，即可獲得 5,000 籌碼新手禮包，助你快速起步。',
    ends: '長期活動',
    countdown: null,
  },
]

function EventDrawer({ isOpen, onClose }) {
  const [shouldRender, setShouldRender] = useState(isOpen)
  const [isClosing, setIsClosing] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true)
      setIsClosing(false)
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
          <span className="event-drawer-title">限時活動</span>
          <button type="button" className="event-drawer-close" onClick={onClose} aria-label="關閉">✕</button>
        </div>
        <div className="event-drawer-body">
          <div className="event-list">
            {EVENTS.map((ev) => (
              <div key={ev.id} className={`event-card ${ev.hot ? 'is-hot' : ''}`} style={{ '--ev-color': ev.tagColor }}>
                <div className="event-card-top">
                  <span className="event-tag" style={{ color: ev.tagColor, borderColor: ev.tagColor }}>
                    {ev.tag}
                  </span>
                  {ev.hot && <span className="event-hot-badge">HOT</span>}
                  <span className="event-ends">
                    {ev.countdown ? `剩 ${ev.countdown}` : ev.ends}
                  </span>
                </div>
                <h3 className="event-title">{ev.title}</h3>
                <p className="event-desc">{ev.desc}</p>
                <button type="button" className="event-join-btn">立即參與</button>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

export default EventDrawer
