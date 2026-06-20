import { useEffect, useState } from 'react'
import { api } from '../services/api.js'

function fmt(n) { return Number(n).toLocaleString('en-US') }

const TYPE_LABEL = {
  dt_round:  '遊戲局',
  deposit:   '存款',
  withdraw:  '提款',
  checkin:   '簽到',
  admin_adj: '後台調整',
}

export default function LedgerPage() {
  const [entries, setEntries] = useState([])
  const [userId,  setUserId]  = useState('')
  const [offset,  setOffset]  = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const LIMIT = 50

  async function load(uid = userId, off = 0) {
    const params = { limit: LIMIT, offset: off }
    if (uid) params.user_id = uid
    const d = await api.getLedger(params)
    setEntries(off === 0 ? d.entries : prev => [...prev, ...d.entries])
    setHasMore(d.hasMore)
    setOffset(off + d.entries.length)
  }

  useEffect(() => { load() }, [])

  function handleSearch(e) {
    e.preventDefault()
    setOffset(0)
    load(userId, 0)
  }

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h2 className="admin-page-title">帳務明細</h2>
      </div>

      <form className="admin-search-bar" onSubmit={handleSearch}>
        <input
          className="admin-input"
          placeholder="會員 ID 篩選（空白 = 全部）"
          value={userId}
          onChange={e => setUserId(e.target.value)}
        />
        <button className="admin-btn-primary" type="submit">查詢</button>
      </form>

      <div className="admin-card">
        <table className="admin-table">
          <thead>
            <tr><th>時間</th><th>帳號</th><th>類型</th><th>金額</th><th>備註</th></tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.id}>
                <td>{new Date(e.created_at).toLocaleString('zh-TW')}</td>
                <td>{e.username}</td>
                <td>{TYPE_LABEL[e.type] ?? e.type}</td>
                <td className={e.amount >= 0 ? 'admin-amt-pos' : 'admin-amt-neg'}>
                  {e.amount >= 0 ? '+' : ''}{fmt(e.amount)}
                </td>
                <td className="admin-meta">{e.meta ? JSON.stringify(e.meta).slice(0, 60) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {hasMore && (
          <button className="admin-btn-ghost" style={{ marginTop: '1rem' }} onClick={() => load(userId, offset)}>
            載入更多
          </button>
        )}
      </div>
    </div>
  )
}
