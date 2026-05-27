import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '../services/apiClient'

const DEFAULT_STATUS = { streak: 0, checked_today: false, cycle_day: 1, today_reward: 100 }

export function useCheckIn({ token, isAuthenticated, isOpen }) {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchStatus = useCallback(async () => {
    if (!isAuthenticated || !token) return
    try {
      const data = await apiRequest('/checkin', {
        headers: { Authorization: `Bearer ${token}` },
      })
      setStatus(data)
    } catch (err) {
      console.error('[CheckIn] GET failed:', err)
      setStatus((prev) => prev ?? DEFAULT_STATUS)
    }
  }, [isAuthenticated, token])

  useEffect(() => {
    if (isOpen) fetchStatus()
  }, [isOpen, fetchStatus])

  const claim = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiRequest('/checkin', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      setStatus((prev) => ({
        ...prev,
        streak: data.streak,
        cycle_day: data.cycle_day,
        checked_today: true,
      }))
      return data
    } catch (err) {
      console.error('[CheckIn] POST failed:', err)
      setError(err.message ?? '領取失敗，請稍後再試')
      throw err
    } finally {
      setLoading(false)
    }
  }, [token])

  return { status, loading, error, claim }
}
