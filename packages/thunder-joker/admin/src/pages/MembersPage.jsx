import { useEffect, useState } from 'react'
import { api } from '../services/api.js'

function fmt(n) { return Number(n).toLocaleString('en-US') }

export default function MembersPage() {
  const [members, setMembers]   = useState([])
  const [q,       setQ]         = useState('')
  const [offset,  setOffset]    = useState(0)
  const [hasMore, setHasMore]   = useState(false)
  const [editing, setEditing]   = useState(null)   // { id, balance }
  const [saving,  setSaving]    = useState(false)
  const LIMIT = 20

  async function load(search = q, off = 0) {
    const d = await api.getMembers({ q: search, limit: LIMIT, offset: off })
    setMembers(off === 0 ? d.members : prev => [...prev, ...d.members])
    setHasMore(d.hasMore)
    setOffset(off + d.members.length)
  }

  useEffect(() => { load() }, [])

  async function handleSearch(e) {
    e.preventDefault()
    setOffset(0)
    await load(q, 0)
  }

  async function handleToggleSuspend(m) {
    await api.putMember(m.id, { suspended: !m.suspended_at })
    load(q, 0)
  }

  async function handleSaveBalance(e) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.putMember(editing.id, { balance: Number(editing.balance) })
      setEditing(null)
      load(q, 0)
    } finally { setSaving(false) }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h2 className="admin-page-title">會員管理</h2>
      </div>

      <form className="admin-search-bar" onSubmit={handleSearch}>
        <input
          className="admin-input"
          placeholder="搜尋帳號…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <button className="admin-btn-primary" type="submit">搜尋</button>
      </form>

      <div className="admin-card">
        <table className="admin-table">
          <thead>
            <tr><th>ID</th><th>帳號</th><th>餘額</th><th>狀態</th><th>操作</th></tr>
          </thead>
          <tbody>
            {members.map(m => (
              <tr key={m.id} className={m.suspended_at ? 'is-suspended' : ''}>
                <td>{m.id}</td>
                <td>{m.username}</td>
                <td>{fmt(m.balance)}</td>
                <td>{m.suspended_at ? <span className="admin-badge-red">停用</span> : <span className="admin-badge-green">正常</span>}</td>
                <td className="admin-actions">
                  <button className="admin-btn-ghost admin-btn-sm" onClick={() => setEditing({ id: m.id, balance: m.balance })}>
                    調整餘額
                  </button>
                  <button className="admin-btn-ghost admin-btn-sm" onClick={() => handleToggleSuspend(m)}>
                    {m.suspended_at ? '解除停用' : '停用'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {hasMore && (
          <button className="admin-btn-ghost" style={{ marginTop: '1rem' }} onClick={() => load(q, offset)}>
            載入更多
          </button>
        )}
      </div>

      {editing && (
        <div className="admin-modal-overlay" onClick={() => setEditing(null)}>
          <form className="admin-modal" onClick={e => e.stopPropagation()} onSubmit={handleSaveBalance}>
            <h3 className="admin-modal-title">調整餘額</h3>
            <input
              className="admin-input"
              type="number"
              min={0}
              value={editing.balance}
              onChange={e => setEditing(ed => ({ ...ed, balance: e.target.value }))}
            />
            <div className="admin-modal-footer">
              <button className="admin-btn-ghost"   type="button" onClick={() => setEditing(null)}>取消</button>
              <button className="admin-btn-primary" type="submit" disabled={saving}>確認</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
