import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import Sidebar from './components/Sidebar.jsx'
import LoginPage from './pages/LoginPage.jsx'
import GameConfigPage from './pages/GameConfigPage.jsx'
import MembersPage from './pages/MembersPage.jsx'
import LedgerPage from './pages/LedgerPage.jsx'
import AdminAccountsPage from './pages/AdminAccountsPage.jsx'

function RequireAuth({ children }) {
  const token = localStorage.getItem('tj_admin_token')
  return token ? children : <Navigate to="/login" replace />
}

function AdminLayout({ onLogout }) {
  const location = useLocation()
  return (
    <div className="admin-shell">
      <Sidebar currentPath={location.pathname} onLogout={onLogout} />
      <main className="admin-main">
        <Routes>
          <Route path="/"         element={<Navigate to="/config" replace />} />
          <Route path="/config"   element={<GameConfigPage />} />
          <Route path="/members"  element={<MembersPage />} />
          <Route path="/ledger"   element={<LedgerPage />} />
          <Route path="/accounts" element={<AdminAccountsPage />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  const [authed, setAuthed] = useState(Boolean(localStorage.getItem('tj_admin_token')))
  const navigate = useNavigate()

  function handleLogin(token) {
    localStorage.setItem('tj_admin_token', token)
    setAuthed(true)
    navigate('/config')
  }

  function handleLogout() {
    localStorage.removeItem('tj_admin_token')
    localStorage.removeItem('tj_admin_role')
    setAuthed(false)
    navigate('/login')
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage onLogin={handleLogin} />} />
      <Route path="/*" element={
        <RequireAuth>
          <AdminLayout onLogout={handleLogout} />
        </RequireAuth>
      } />
    </Routes>
  )
}
