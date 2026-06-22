import { useState } from 'react'
import { api } from '../services/api.js'

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { token, role } = await api.login({ username, password })
      localStorage.setItem('tj_admin_role', role)
      onLogin(token)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="admin-login-wrap">
      <form className="admin-login-card" onSubmit={handleSubmit}>
        <h1 className="admin-login-title">Thunder Joker 後台</h1>
        <input className="admin-input" type="text"     placeholder="帳號" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" />
        <input className="admin-input" type="password" placeholder="密碼" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
        {error && <p className="admin-error">{error}</p>}
        <button className="admin-btn-primary" type="submit" disabled={loading}>
          {loading ? '登入中…' : '登入'}
        </button>
      </form>
    </div>
  )
}
