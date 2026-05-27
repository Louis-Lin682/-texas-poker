import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { adminApi, clearToken, getToken, setToken } from '../services/adminApi'

const Ctx = createContext(null)

export function AdminAuthProvider({ children }) {
  const [admin,   setAdmin]   = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    fetch('/admin/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async r => {
        if (r.ok) {
          const d = await r.json()
          if (d.admin) setAdmin(d.admin)
        } else {
          clearToken()
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (username, password) => {
    const data = await adminApi.login(username, password)
    setToken(data.token)
    setAdmin(data.admin)
  }, [])

  const logout = useCallback(async () => {
    await adminApi.logout().catch(() => {})
    clearToken()
    setAdmin(null)
  }, [])

  return (
    <Ctx.Provider value={{ admin, loading, login, logout }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAdminAuth() { return useContext(Ctx) }
