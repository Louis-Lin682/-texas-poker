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

const RESULT_LABEL = { dragon: '龍勝', tiger: '虎勝', tie: '和局' }
const BET_LABEL = {
  dragon: '龍', tiger: '虎', tie: '和',
  dragon_big: '龍大', dragon_small: '龍小', dragon_odd: '龍單', dragon_even: '龍雙',
  dragon_spade: '龍♠', dragon_heart: '龍♥', dragon_club: '龍♣', dragon_diamond: '龍♦',
  tiger_big: '虎大', tiger_small: '虎小', tiger_odd: '虎單', tiger_even: '虎雙',
  tiger_spade: '虎♠', tiger_heart: '虎♥', tiger_club: '虎♣', tiger_diamond: '虎♦',
}

function DetailCell({ detail }) {
  if (!detail) return <span className="admin-detail-empty">—</span>

  const d = typeof detail === 'string' ? JSON.parse(detail) : detail

  if (d.result) {
    const dc = d.dragonCard
    const tc = d.tigerCard
    const bets = d.bets ? Object.entries(d.bets).filter(([, v]) => v > 0) : []
    return (
      <div className="admin-detail-block">
        <div className="admin-detail-result">
          {RESULT_LABEL[d.result] ?? d.result}
          {dc && tc && (
            <span className="admin-detail-cards">
              　龍 {dc.rank}{dc.suit} vs 虎 {tc.rank}{tc.suit}
            </span>
          )}
        </div>
        {bets.length > 0 && (
          <div className="admin-detail-bets">
            {bets.map(([zone, amt]) => (
              <span key={zone} className="admin-detail-bet-tag">
                {BET_LABEL[zone] ?? zone} {fmt(amt)}
              </span>
            ))}
          </div>
        )}
        <div className="admin-detail-payout">
          下注 {fmt(d.totalBet)}　派彩 {fmt(d.payout)}
        </div>
      </div>
    )
  }

  return <span className="admin-detail-empty">{JSON.stringify(d).slice(0, 80)}</span>
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
            <tr><th>時間</th><th>帳號</th><th>類型</th><th>損益</th><th>開牌 / 下注明細</th></tr>
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
                <td><DetailCell detail={e.detail} /></td>
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
