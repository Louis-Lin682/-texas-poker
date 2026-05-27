import PageShell from '../components/PageShell'

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

function EventPage() {
  return (
    <PageShell title="限時活動" accent="#57d46f">
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
            <button type="button" className="event-join-btn">
              立即參與
            </button>
          </div>
        ))}
      </div>
    </PageShell>
  )
}

export default EventPage
