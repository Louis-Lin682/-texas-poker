import { useCallback, useEffect, useMemo, useState } from 'react'
import { getMe } from '../services/authApi'

const TOKEN_STORAGE_KEY = 'texas_holdem_auth_token'

export function useAuth() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_STORAGE_KEY) ?? '')
  const [user, setUser] = useState(null)
  const [isCheckingAuth, setIsCheckingAuth] = useState(Boolean(token))
  const [isRefreshingBalance, setIsRefreshingBalance] = useState(false)

  useEffect(() => {
    if (!token) {
      setUser(null)
      setIsCheckingAuth(false)
      localStorage.removeItem(TOKEN_STORAGE_KEY)
      return
    }

    localStorage.setItem(TOKEN_STORAGE_KEY, token)
    setIsCheckingAuth(true)

    let cancelled = false
    const attempt = (retriesLeft = 10) => {
      getMe(token)
        .then((nextUser) => {
          if (cancelled) return
          setUser(nextUser)
          setIsCheckingAuth(false)
        })
        .catch((err) => {
          if (cancelled) return
          if (err.status === 401 || err.status === 403) {
            setToken('')
            setUser(null)
            localStorage.removeItem(TOKEN_STORAGE_KEY)
            setIsCheckingAuth(false)
          } else if (retriesLeft > 0) {
            // 503 (starting up) or 500 (DB reconnecting) — retry
            const delay = err.status === 503 ? 2000 : 3000
            setTimeout(() => { if (!cancelled) attempt(retriesLeft - 1) }, delay)
          } else {
            // exhausted retries: keep token, show guest state
            setIsCheckingAuth(false)
          }
        })
    }
    attempt()
    return () => { cancelled = true }
  }, [token])

  const refreshUser = useCallback(async () => {
    if (!token) return null
    setIsRefreshingBalance(true)
    try {
      const nextUser = await getMe(token)
      setUser(nextUser)
      return nextUser
    } catch {
      return null
    } finally {
      setIsRefreshingBalance(false)
    }
  }, [token])

  // Update balance directly from a server-pushed value (e.g. balance_update WS
  // message after cashout) without a round-trip to /me, preventing a race where
  // the lobby's mount refreshUser hits the DB before the cashout UPDATE commits.
  const applyBalance = useCallback((balance) => {
    setUser(prev => prev ? { ...prev, balance } : prev)
  }, [])

  const value = useMemo(
    () => ({
      isAuthenticated: Boolean(token && user),
      isCheckingAuth,
      isRefreshingBalance,
      token,
      user,
      setToken,
      refreshUser,
      applyBalance,
      logout: () => setToken(''),
    }),
    [isCheckingAuth, isRefreshingBalance, token, user, refreshUser, applyBalance],
  )

  return value
}
