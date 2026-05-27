import { useState } from 'react'
import PageShell from '../components/PageShell'

const NEWS = [
  {
    id: 1,
    date: '2026/05/20',
    tag: '活動',
    tagColor: '#57d46f',
    title: '週年慶雙倍籌碼回饋開跑',
    content:
      '即日起至 5/31，所有玩家每日首局遊戲結束後將自動獲得雙倍籌碼補發，無需額外操作。活動期間登入即可參與，老玩家同樣享有。',
  },
  {
    id: 2,
    date: '2026/05/20',
    tag: '系統',
    tagColor: '#4fd0ff',
    title: '5/20 系統例行維護公告',
    content:
      '本次維護於 2026/05/20 凌晨 04:00 — 06:00 進行，期間遊戲服務暫停。維護完成後將推送版本更新，優化登入速度與畫面渲染效能。',
  },
  {
    id: 3,
    date: '2026/05/15',
    tag: '公告',
    tagColor: '#f0c96b',
    title: '德州撲克主桌正式上線',
    content:
      '本平台首款旗艦遊戲「Texas Hold\'em」現已正式開放，支援多人同桌競技。目前開放免費體驗，未來將新增排名賽與私人房間功能。',
  },
  {
    id: 4,
    date: '2026/05/10',
    tag: '活動',
    tagColor: '#57d46f',
    title: '新手任務挑戰限時開放',
    content:
      '完成指定新手任務可累積解鎖獎勵，包含免費籌碼、裝備道具與限定稱號。任務中心隨時可查看進度，5/31 截止前完成才能領取。',
  },
]

function NewsPage() {
  const [expanded, setExpanded] = useState(null)

  const toggle = (id) => setExpanded((prev) => (prev === id ? null : id))

  const grouped = NEWS.reduce((acc, item) => {
    if (!acc[item.date]) acc[item.date] = []
    acc[item.date].push(item)
    return acc
  }, {})

  return (
    <PageShell title="最新消息" accent="#4fd0ff">
      {Object.entries(grouped).map(([date, items]) => (
        <div key={date} className="news-group">
          <div className="news-date-divider">
            <span>{date}</span>
          </div>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`news-item ${expanded === item.id ? 'is-expanded' : ''}`}
              onClick={() => toggle(item.id)}
            >
              <div className="news-item-header">
                <span className="news-tag" style={{ color: item.tagColor, borderColor: item.tagColor }}>
                  {item.tag}
                </span>
                <span className="news-item-title">{item.title}</span>
                <span className="news-item-chevron">{expanded === item.id ? '∧' : '∨'}</span>
              </div>
              {expanded === item.id && (
                <p className="news-item-content">{item.content}</p>
              )}
            </button>
          ))}
        </div>
      ))}
    </PageShell>
  )
}

export default NewsPage
