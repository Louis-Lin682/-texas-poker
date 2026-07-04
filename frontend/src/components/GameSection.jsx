import HeartIcon from './HeartIcon'
import MaintenanceSpriteOverlay from './MaintenanceSpriteOverlay'

function GameSection({ items, isLoading, favoriteIds, onToggleFavorite, onGameClick }) {
  if (!isLoading && (!items || items.length === 0)) return null

  const displayed = items?.slice(0, 5) ?? []
  const [big, ...smalls] = displayed

  return (
    <section className="hot-section">
      <div className="hot-banner-title">
          <img src="/PopularTags.webp" alt="熱門遊戲" />
        </div>
      {isLoading ? (
        <div className="hot-grid">
          <div className="game-tile hot-card-big hot-skeleton" />
          <div className="hot-card-small-grid">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="game-tile hot-card-small hot-skeleton" />
            ))}
          </div>
        </div>
      ) : (
        <div className="hot-grid">
          {big && (
            <article
              className="game-tile hot-card-big"
              onClick={() => onGameClick?.(big)}
            >
              <button
                type="button"
                className={`fav-btn ${favoriteIds.includes(big.id) ? 'is-active' : ''}`}
                onClick={(e) => { e.stopPropagation(); onToggleFavorite(big.id) }}
              >
                <HeartIcon filled={favoriteIds.includes(big.id)} />
              </button>
              <div className="game-art">
                <img
                  className="game-image"
                  src="/games/electronic/thunder-joker-straight.webp"
                  alt={big.name}
                  loading="lazy"
                  onLoad={e => e.currentTarget.classList.add('img-loaded')}
                />
              </div>
              {big.status === 'maintenance' && <MaintenanceSpriteOverlay />}
            </article>
          )}

          <div className="hot-card-small-grid">
            {smalls.map((game) => (
              <article
                key={game.id}
                className="game-tile hot-card-small"
                onClick={() => onGameClick?.(game)}
              >
                <button
                  type="button"
                  className={`fav-btn ${favoriteIds.includes(game.id) ? 'is-active' : ''}`}
                  onClick={(e) => { e.stopPropagation(); onToggleFavorite(game.id) }}
                >
                  <HeartIcon filled={favoriteIds.includes(game.id)} />
                </button>
                <div className="game-art">
                  <img
                    className="game-image"
                    src={game.imageUrl}
                    alt={game.name}
                    loading="lazy"
                    onLoad={e => e.currentTarget.classList.add('img-loaded')}
                  />
                </div>
                {game.status === 'maintenance' && <MaintenanceSpriteOverlay />}
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

export default GameSection
