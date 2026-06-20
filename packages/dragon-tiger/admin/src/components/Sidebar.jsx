import { useNavigate } from 'react-router-dom'

const NAV = [
  { path: '/config',   label: '賠率設定' },
  { path: '/members',  label: '會員管理' },
  { path: '/ledger',   label: '帳務明細' },
  { path: '/accounts', label: '後台帳號' },
]

export default function Sidebar({ currentPath, onLogout }) {
  const navigate = useNavigate()
  return (
    <aside className="admin-sidebar">
      <div className="admin-sidebar-logo">
        <span className="admin-sidebar-title">龍虎鬥</span>
        <span className="admin-sidebar-sub">後台管理</span>
      </div>
      <nav className="admin-nav">
        {NAV.map(n => (
          <button
            key={n.path}
            className={`admin-nav-item${currentPath.startsWith(n.path) ? ' is-active' : ''}`}
            onClick={() => navigate(n.path)}
          >
            {n.label}
          </button>
        ))}
      </nav>
      <button className="admin-logout-btn" onClick={onLogout}>登出</button>
    </aside>
  )
}
