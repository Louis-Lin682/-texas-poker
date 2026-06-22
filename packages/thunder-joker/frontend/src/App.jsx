import { useState, useCallback } from 'react'
import LoginPage from './pages/LoginPage.jsx'
import ThunderJokerPage from './pages/ThunderJokerPage.jsx'
import { apiRequest } from './services/apiClient.js'

const TOKEN_KEY = 'tj_auth_token'

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? null)
  const [user,  setUser]  = useState(null)

  function handleLogin(t, u) {
    localStorage.setItem(TOKEN_KEY, t)
    setToken(t)
    setUser(u)
  }

  function handleLogout() {
    localStorage.removeItem(TOKEN_KEY)
    setToken(null)
    setUser(null)
  }

  const refreshUser = useCallback(async () => {
    const t = localStorage.getItem(TOKEN_KEY)
    if (!t) return
    try {
      const data = await apiRequest('/auth/me', { headers: { Authorization: `Bearer ${t}` } })
      setUser(data.user)
    } catch {
      handleLogout()
    }
  }, [])

  const applyBalance = useCallback((bal) => {
    setUser(u => u ? { ...u, balance: bal } : u)
  }, [])

  if (!token) {
    return <LoginPage onLogin={handleLogin} />
  }

  return (
    <ThunderJokerPage
      auth={{ token, user, applyBalance, refreshUser }}
      onLogout={handleLogout}
    />
  )
}
