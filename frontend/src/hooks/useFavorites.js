import { useEffect, useMemo, useState } from 'react'
import { addFavorite, getFavorites, removeFavorite } from '../services/favoritesApi'

export function useFavorites({ isAuthenticated, token, onRequireLogin }) {
  const [favoriteIds, setFavoriteIds] = useState([])
  const [isLoadingFavorites, setIsLoadingFavorites] = useState(false)

  useEffect(() => {
    if (!isAuthenticated || !token) {
      setFavoriteIds([])
      return
    }

    setIsLoadingFavorites(true)

    getFavorites(token)
      .then((payload) => {
        setFavoriteIds(payload.favorites ?? [])
      })
      .catch(() => {
        setFavoriteIds([])
      })
      .finally(() => {
        setIsLoadingFavorites(false)
      })
  }, [isAuthenticated, token])

  const toggleFavorite = async (gameId) => {
    if (!isAuthenticated || !token) {
      onRequireLogin?.()
      return
    }

    const isActive = favoriteIds.includes(gameId)
    const previous = favoriteIds
    const optimistic = isActive
      ? previous.filter((id) => id !== gameId)
      : [...previous, gameId]

    setFavoriteIds(optimistic)

    try {
      const payload = isActive
        ? await removeFavorite(token, gameId)
        : await addFavorite(token, gameId)

      setFavoriteIds(payload.favorites ?? optimistic)
    } catch {
      setFavoriteIds(previous)
    }
  }

  return useMemo(
    () => ({
      favoriteIds,
      isLoadingFavorites,
      toggleFavorite,
    }),
    [favoriteIds, isLoadingFavorites],
  )
}
