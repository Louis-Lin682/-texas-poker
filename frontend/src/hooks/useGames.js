import { useEffect, useMemo, useState } from 'react'
import { getGames } from '../services/gamesApi'

export function useGames() {
  const [games, setGames] = useState([])
  const [isLoadingGames, setIsLoadingGames] = useState(true)

  useEffect(() => {
    let cancelled = false
    setIsLoadingGames(true)

    const attempt = (delay = 0) => {
      setTimeout(() => {
        if (cancelled) return
        getGames()
          .then((payload) => {
            if (!cancelled) setGames(payload.games ?? [])
          })
          .catch(() => {
            if (!cancelled) attempt(3000)
          })
          .finally(() => {
            if (!cancelled) setIsLoadingGames(false)
          })
      }, delay)
    }
    attempt()
    return () => { cancelled = true }
  }, [])

  return useMemo(
    () => ({
      games,
      featuredGames: games.filter((game) => game.featured),
      pokerGames: games.filter((game) => game.category === 'poker'),
      electronicGames: games.filter((game) => game.category === 'electronic'),
      isLoadingGames,
    }),
    [games, isLoadingGames],
  )
}
