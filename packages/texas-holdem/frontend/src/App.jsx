import { useCallback, useState } from 'react'
import LoginPage     from './pages/LoginPage.jsx'
import GameTablePage from './pages/GameTablePage.jsx'

const TOKEN_KEY = 'th_auth_token'

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

  const applyBalance = useCallback((bal) => {
    setUser(u => u ? { ...u, balance: bal } : u)
  }, [])

  if (!token) return <LoginPage onLogin={handleLogin} />
  return <GameTablePage auth={{ token, user, applyBalance }} onLogout={handleLogout} />
}
