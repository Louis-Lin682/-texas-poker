import { useState } from 'react'
import { api }      from '../api.js'

export default function LoginPage({ onLogin }) {
  const [tab,      setTab]      = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState(null)
  const [loading,  setLoading]  = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const fn = tab === 'login' ? api.login : api.register
      const { token, user } = await fn(username.trim(), password)
      onLogin(token, user)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <img src="/texas-holdem/texas-holdem.png" alt="德州撲克" className="login-logo" />
        <h1 className="login-title">德州撲克</h1>
        <div className="login-tabs">
          <button className={`login-tab${tab === 'login'    ? ' active' : ''}`} onClick={() => setTab('login')}>登入</button>
          <button className={`login-tab${tab === 'register' ? ' active' : ''}`} onClick={() => setTab('register')}>註冊</button>
        </div>
        <form className="login-form" onSubmit={handleSubmit}>
          <input
            className="login-input"
            placeholder="帳號"
            value={username}
            onChange={e => setUsername(e.target.value)}
            required
            autoComplete="username"
          />
          <input
            className="login-input"
            type="password"
            placeholder="密碼"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
          />
          {error && <div className="login-error">{error}</div>}
          <button className="login-submit" type="submit" disabled={loading}>
            {loading ? '處理中…' : tab === 'login' ? '登入' : '註冊'}
          </button>
        </form>
      </div>
    </div>
  )
}
