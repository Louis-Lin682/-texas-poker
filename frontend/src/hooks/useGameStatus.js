import { useEffect, useState } from 'react'

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export function useGameStatus(slug) {
  const [config, setConfig] = useState(null)

  useEffect(() => {
    fetch(`${API_BASE}/game-configs/${slug}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setConfig(d) })
      .catch(() => {})
  }, [slug])

  return config
}
