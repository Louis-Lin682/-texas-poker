import { useEffect, useMemo, useState } from 'react'
import { getGames } from '../services/gamesApi'

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export function useGames() {
  const [games,       setGames]       = useState([])
  const [gameConfigs, setGameConfigs] = useState({}) // slug → { status, notice }
  const [isLoadingGames, setIsLoadingGames] = useState(true)

  // Load games list (static, one-shot)
  useEffect(() => {
    let cancelled = false
    setIsLoadingGames(true)
    const attempt = (delay = 0) => {
      setTimeout(() => {
        if (cancelled) return
        getGames()
          .then(payload => { if (!cancelled) setGames(payload.games ?? []) })
          .catch(() => { if (!cancelled) attempt(3000) })
          .finally(() => { if (!cancelled) setIsLoadingGames(false) })
      }, delay)
    }
    attempt()
    return () => { cancelled = true }
  }, [])

  // Poll game configs every 30s so lobby reflects admin changes
  useEffect(() => {
    let cancelled = false
    function fetchConfigs() {
      fetch(`${API_BASE}/game-configs`)
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (!cancelled && d?.configs) {
            const map = {}
            d.configs.forEach(c => { map[c.slug] = c })
            setGameConfigs(map)
          }
        })
        .catch(() => {})
    }
    fetchConfigs()
    const id = setInterval(fetchConfigs, 30000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  return useMemo(() => {
    const mergedGames = games.map(g => {
      const cfg = gameConfigs[g.slug]
      if (!cfg) return g
      return {
        ...g,
        ...(cfg.status && cfg.status !== 'open' ? { status: 'maintenance' } : {}),
        ...(cfg.display_name                      ? { name: cfg.display_name }  : {}),
        ...(cfg.image_url                         ? { imageUrl: cfg.image_url } : {}),
        ...(cfg.badge                             ? { badge: cfg.badge }        : {}),
        ...(cfg.category                          ? { category: cfg.category }  : {}),
        ...(cfg.is_hot !== null && cfg.is_hot !== undefined ? { featured: cfg.is_hot } : {}),
      }
    })
    return {
      games: mergedGames,
      featuredGames: mergedGames.filter(g => g.featured),
      pokerGames:    mergedGames.filter(g => g.category === 'poker'),
      electronicGames: mergedGames.filter(g => g.category === 'electronic'),
      isLoadingGames,
    }
  }, [games, gameConfigs, isLoadingGames])
}
