import { useEffect, useState } from 'react'
import PageShell from '../components/PageShell'
import VipPageHeader from '../components/VipPageHeader'
import { getNews } from '../services/newsApi'

const CATEGORY_COLOR = {
  活動: '#57d46f',
  系統: '#4fd0ff',
  公告: '#f0c96b',
  更新: '#ff8c69',
}

function fmtDate(iso) {
  const d = new Date(iso)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

function groupByDate(items) {
  return items.reduce((acc, item) => {
    const key = fmtDate(item.published_at)
    if (!acc[key]) acc[key] = []
    acc[key].push(item)
    return acc
  }, {})
}

function NewsPage() {
  const [news,     setNews]     = useState([])
  const [loading,  setLoading]  = useState(true)
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    getNews()
      .then(data => setNews(data.news ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const grouped = groupByDate(news)

  return (
    <PageShell title="" accent="#4fd0ff">
      <VipPageHeader title="最新消息" eyebrow="LATEST NEWS" />

      {loading && <p className="quest-empty">載入中…</p>}

      {!loading && news.length === 0 && (
        <p className="quest-empty">目前沒有消息</p>
      )}

      {!loading && Object.entries(grouped).map(([date, items]) => (
        <div key={date} className="news-group">
          <div className="news-date-divider">
            <span>{date}</span>
          </div>
          {items.map(item => (
            <button
              key={item.id}
              type="button"
              className={`news-item ${expanded === item.id ? 'is-expanded' : ''}`}
              onClick={() => setExpanded(prev => prev === item.id ? null : item.id)}
            >
              <div className="news-item-header">
                <span
                  className="news-tag"
                  style={{ color: CATEGORY_COLOR[item.category] ?? '#aaa', borderColor: CATEGORY_COLOR[item.category] ?? '#aaa' }}
                >
                  {item.category}
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
