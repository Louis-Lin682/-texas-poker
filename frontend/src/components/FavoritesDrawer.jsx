import { useEffect, useMemo, useState } from 'react'
import HeartIcon from './HeartIcon'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { useAudio } from '../hooks/useAudio'

function FavoritesDrawer({
  isOpen,
  onClose,
  games,
  favoriteIds,
  onToggleFavorite,
}) {
  const { play } = useAudio()
  const [shouldRender, setShouldRender] = useState(isOpen)
  const [isClosing, setIsClosing] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true)
      setIsClosing(false)
      return
    }

    if (!shouldRender) {
      return
    }

    setIsClosing(true)

    const timer = window.setTimeout(() => {
      setShouldRender(false)
      setIsClosing(false)
    }, 280)

    return () => window.clearTimeout(timer)
  }, [isOpen, shouldRender])

  useBodyScrollLock(isOpen)

  const favoriteGames = useMemo(() => {
    const orderMap = new Map(favoriteIds.map((id, index) => [id, index]))

    return games
      .filter((game) => favoriteIds.includes(game.id))
      .sort((left, right) => orderMap.get(left.id) - orderMap.get(right.id))
  }, [favoriteIds, games])

  if (!shouldRender) {
    return null
  }

  const isEmpty = favoriteGames.length === 0

  return (
    <div
      className={`drawer-backdrop ${isClosing ? 'is-closing' : 'is-open'}`}
      role="presentation"
      onClick={onClose}
    >
      <section
        className={`favorites-drawer ${isClosing ? 'is-closing' : 'is-open'}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="favorites-drawer-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer-handle" aria-hidden="true" />

        <div className="favorites-drawer-header">
          <button
            type="button"
            className="favorites-close-button"
            aria-label="關閉收藏頁"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {isEmpty ? (
          <div className="favorites-empty-state">
            <img
              className="favorites-empty-logo"
              src="/phantom-footer-logo.png"
              alt="Phantom Holdem logo"
            />
            <strong>還沒有收藏的遊戲</strong>
            <p>看到喜歡的遊戲時點一下愛心，這裡就會幫你收好。</p>
            <button type="button" className="show-more-games-button" onClick={() => { play('uiWhoosh'); onClose() }}>
              去逛遊戲
            </button>
          </div>
        ) : (
          <div className="favorites-list">
            <span className="favorites-count-badge">{favoriteGames.length} 款遊戲</span>
            {favoriteGames.map((game) => (
              <article key={game.id} className="favorite-card">
                <img
                  className="favorite-card-image"
                  src={game.imageUrl}
                  alt={game.name}
                  loading="lazy"
                />

                <div className="favorite-card-copy">
                  <div className="favorite-card-topline">
                    <span className={`favorite-category favorite-category-${game.category}`}>
                      {game.category === 'poker' ? '撲克' : '電子'}
                    </span>
                    <span className={`favorite-status favorite-status-${game.status}`}>
                      {game.status === 'playable'
                        ? '開放中'
                        : game.status === 'maintenance'
                          ? '維護中'
                          : '即將登場'}
                    </span>
                  </div>

                  <strong>{game.name}</strong>
                </div>

                <button
                  type="button"
                  className="favorite-card-action"
                  aria-label={`取消收藏 ${game.name}`}
                  onClick={() => onToggleFavorite(game.id)}
                >
                  <HeartIcon filled />
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

export default FavoritesDrawer
