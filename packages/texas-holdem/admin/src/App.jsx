import { useState } from 'react'
import { api }       from './services/api.js'
import MembersPage   from './pages/MembersPage.jsx'
import LedgerPage    from './pages/LedgerPage.jsx'
import AdminAccountsPage from './pages/AdminAccountsPage.jsx'

const TOKEN_KEY = 'th_admin_token'
const ROLE_KEY  = 'th_admin_role'

const PAGES = [
  { key: 'members',  label: '會員管理' },
  { key: 'ledger',   label: '帳務明細' },
  { key: 'accounts', label: '後台帳號' },
]

export default function App() {
  const [token,    setToken]    = useState(() => localStorage.getItem(TOKEN_KEY) ?? null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState(null)
  const [page,     setPage]     = useState('members')

  async function handleLogin(e) {
    e.preventDefault()
    setError(null)
    try {
      const { token: t, admin } = await api.login(username, password)
      localStorage.setItem(TOKEN_KEY, t)
      localStorage.setItem(ROLE_KEY, admin.role)
      setToken(t)
    } catch (err) {
      setError(err.message)
    }
  }

  function handleLogout() {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(ROLE_KEY)
    setToken(null)
  }

  if (!token) {
    return (
      <div className="admin-login-page">
        <div className="admin-login-card">
          <h1 className="admin-login-title">德州撲克 後台</h1>
          <form className="admin-login-form" onSubmit={handleLogin}>
            <input className="admin-input" placeholder="帳號" value={username}
              onChange={e => setUsername(e.target.value)} required />
            <input className="admin-input" type="password" placeholder="密碼" value={password}
              onChange={e => setPassword(e.target.value)} required />
            {error && <div className="admin-error">{error}</div>}
            <button className="admin-btn-primary" type="submit">登入</button>
          </form>
        </div>
      </div>
    )
  }

  const pageEl = page === 'members'  ? <MembersPage />
               : page === 'ledger'   ? <LedgerPage />
               : page === 'accounts' ? <AdminAccountsPage />
               : null

  return (
    <div className="admin-layout">
      <nav className="admin-nav">
        <span className="admin-nav-title">德州撲克</span>
        {PAGES.map(p => (
          <button key={p.key} className={`admin-nav-item${page === p.key ? ' active' : ''}`}
            onClick={() => setPage(p.key)}>
            {p.label}
          </button>
        ))}
        <button className="admin-nav-item admin-nav-logout" onClick={handleLogout}>登出</button>
      </nav>
      <main className="admin-main">{pageEl}</main>
    </div>
  )
}
