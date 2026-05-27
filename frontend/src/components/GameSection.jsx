import HeartIcon from './HeartIcon'
import SectionHeader from './SectionHeader'

function FeaturedGameCard({ game, className, isFavorite, onToggleFavorite, onGameClick }) {
  return (
    <div className={`game-card-shell ${className}`}>
      <img className="game-badge-image" src="/hot-badge.png" alt="熱門遊戲" />

      <article className="game-tile" onClick={() => onGameClick?.(game)}>
        <button
          type="button"
          className={`fav-btn ${isFavorite ? 'is-active' : ''}`}
          aria-label={isFavorite ? `取消收藏 ${game.name}` : `收藏 ${game.name}`}
          aria-pressed={isFavorite}
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(game.id) }}
        >
          <HeartIcon filled={isFavorite} />
        </button>

        <div className="game-art">
          <img className="game-image" src={game.imageUrl} alt={game.name} loading="lazy" />
          <div className="art-glow" />
          <div className="art-title">
            <span>{game.name}</span>
          </div>
        </div>
      </article>
    </div>
  )
}

function GameSection({ items, favoriteIds, onToggleFavorite, onGameClick }) {
  return (
    <section className="content-panel">
      <SectionHeader title="熱門遊戲" />

      <div className="games-showcase">
        {items.slice(0, 4).map((game) => (
          <FeaturedGameCard
            key={game.id}
            game={game}
            className="game-tile-featured"
            isFavorite={favoriteIds.includes(game.id)}
            onToggleFavorite={onToggleFavorite}
            onGameClick={onGameClick}
          />
        ))}
      </div>
    </section>
  )
}

export default GameSection
