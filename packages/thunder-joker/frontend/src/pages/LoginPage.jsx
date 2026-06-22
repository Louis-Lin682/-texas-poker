import { useState } from 'react'
import { API_BASE_URL } from '../services/apiClient.js'

const TOKEN_KEY = 'tj_auth_token'

async function authFetch(path, body) {
  const res  = await fetch(`${API_BASE_URL}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.message ?? '請求失敗')
  return data
}

export default function LoginPage({ onLogin }) {
  const [mode,     setMode]     = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/register'
      const data = await authFetch(path, { username, password })
      localStorage.setItem(TOKEN_KEY, data.token)
      onLogin(data.token, data.user)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="tj-login-wrap">
      <form className="tj-login-card" onSubmit={handleSubmit}>
        <h1 className="tj-login-title">Thunder Joker</h1>
        <input
          className="tj-login-input"
          type="text"
          placeholder="帳號"
          value={username}
          onChange={e => setUsername(e.target.value)}
          autoComplete="username"
        />
        <input
          className="tj-login-input"
          type="password"
          placeholder="密碼"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        {error && <p className="tj-login-error">{error}</p>}
        <button className="tj-login-btn" type="submit" disabled={loading}>
          {loading ? '處理中…' : mode === 'login' ? '登入' : '註冊'}
        </button>
        <button
          type="button"
          className="tj-login-switch"
          onClick={() => { setMode(m => m === 'login' ? 'register' : 'login'); setError('') }}
        >
          {mode === 'login' ? '還沒有帳號？註冊' : '已有帳號？登入'}
        </button>
      </form>
    </div>
  )
}
