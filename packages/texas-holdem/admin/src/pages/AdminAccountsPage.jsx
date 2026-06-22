import { useEffect, useState } from 'react'
import { api } from '../services/api.js'

const ROLE_LABEL = {
  super_admin:   '超級管理員',
  game_operator: '遊戲操作員',
  finance:       '財務',
  cs:            '客服',
}

export default function AdminAccountsPage() {
  const [accounts, setAccounts] = useState([])
  const [form,     setForm]     = useState({ username: '', password: '', role: 'cs' })
  const [status,   setStatus]   = useState(null)
  const myRole = localStorage.getItem('th_admin_role')

  useEffect(() => { api.getAccounts().then(d => setAccounts(d.accounts)) }, [])

  async function handleCreate(e) {
    e.preventDefault()
    setStatus('saving')
    try {
      await api.postAccount(form)
      setForm({ username: '', password: '', role: 'cs' })
      const d = await api.getAccounts()
      setAccounts(d.accounts)
      setStatus('ok')
      setTimeout(() => setStatus(null), 2000)
    } catch (err) {
      setStatus(err.message)
    }
  }

  if (myRole !== 'super_admin') {
    return (
      <div className="admin-page">
        <div className="admin-page-header"><h2 className="admin-page-title">後台帳號</h2></div>
        <div className="admin-card"><p className="admin-error">權限不足</p></div>
      </div>
    )
  }

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h2 className="admin-page-title">後台帳號管理</h2>
      </div>

      <div className="admin-card">
        <table className="admin-table">
          <thead>
            <tr><th>ID</th><th>帳號</th><th>角色</th><th>建立時間</th><th>狀態</th></tr>
          </thead>
          <tbody>
            {accounts.map(a => (
              <tr key={a.id} className={a.suspended_at ? 'is-suspended' : ''}>
                <td>{a.id}</td>
                <td>{a.username}</td>
                <td>{ROLE_LABEL[a.role] ?? a.role}</td>
                <td>{new Date(a.created_at).toLocaleString('zh-TW')}</td>
                <td>{a.suspended_at
                  ? <span className="admin-badge-red">停用</span>
                  : <span className="admin-badge-green">正常</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="admin-card" style={{ marginTop: '1.5rem' }}>
        <h3 className="admin-section-title">新增帳號</h3>
        <form className="admin-config-grid" onSubmit={handleCreate}>
          <div className="admin-field">
            <label className="admin-label">帳號</label>
            <input className="admin-input" value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))} required />
          </div>
          <div className="admin-field">
            <label className="admin-label">密碼</label>
            <input className="admin-input" type="password" value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required />
          </div>
          <div className="admin-field">
            <label className="admin-label">角色</label>
            <select className="admin-input" value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              {Object.entries(ROLE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div className="admin-form-footer" style={{ gridColumn: '1/-1' }}>
            {status === 'ok'     && <span className="admin-status-ok">已新增</span>}
            {status === 'saving' && <span className="admin-status-info">處理中…</span>}
            {status && status !== 'ok' && status !== 'saving' && <span className="admin-error">{status}</span>}
            <button className="admin-btn-primary" type="submit" disabled={status === 'saving'}>新增</button>
          </div>
        </form>
      </div>
    </div>
  )
}
