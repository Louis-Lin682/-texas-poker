import { useMemo, useState } from 'react'
import HeartIcon from './HeartIcon'
import MaintenanceSpriteOverlay from './MaintenanceSpriteOverlay'

const FILTERS = [
  { id: 'all',        label: '全部' },
  { id: 'favorites',  label: '收藏' },
  { id: 'electronic', label: '電子' },
  { id: 'poker',      label: '撲克' },
]

const INITIAL_VISIBLE_COUNT = 12


function PreviewOverlay() {
  return (
    <div className="preview-overlay" aria-hidden="true">
      <div className="preview-glow" />
      <div className="preview-badge">
        <span className="preview-badge-sub">COMING SOON</span>
        <span className="preview-badge-main">即將登場</span>
        <div className="preview-badge-rule" />
      </div>
    </div>
  )
}

function AllGamesSection({ items, isLoading, favoriteIds, onToggleFavorite, play, onGameClick }) {
  const [activeFilter, setActiveFilter] = useState('all')
  const [visibleCounts, setVisibleCounts] = useState(() => ({
    all:        INITIAL_VISIBLE_COUNT,
    favorites:  INITIAL_VISIBLE_COUNT,
    electronic: INITIAL_VISIBLE_COUNT,
    poker:      INITIAL_VISIBLE_COUNT,
  }))
  const [animateBatchFrom, setAnimateBatchFrom] = useState(null)

  const activeIndex = FILTERS.findIndex((filter) => filter.id === activeFilter)

  const filteredItems = useMemo(() => {
    if (activeFilter === 'all')       return items
    if (activeFilter === 'favorites') return items.filter(game => favoriteIds.includes(game.id))
    return items.filter((game) => game.category === activeFilter)
  }, [activeFilter, items, favoriteIds])

  const visibleItems = filteredItems.slice(0, visibleCounts[activeFilter] ?? INITIAL_VISIBLE_COUNT)
  const hasMore = filteredItems.length > visibleItems.length

  return (
    <section className="content-panel">
      <div className="hot-banner-title">
        <img src="/allGameTags.png" alt="全部遊戲" />
      </div>

      {isLoading && (
        <div className="all-games-skeleton-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="all-games-skeleton-card" />
          ))}
        </div>
      )}

      {!isLoading && <>
        <div className="game-filter-panel">
          <div className="game-filter-segment" role="tablist" aria-label="遊戲類型篩選">
            <span
              className="game-filter-thumb"
              aria-hidden="true"
              style={{ transform: `translateX(${activeIndex * 100}%)` }}
            />

            {FILTERS.map((filter) => {
              const isActive = filter.id === activeFilter

              return (
                <button
                  key={filter.id}
                  type="button"
                  data-no-global-click="true"
                  className={`game-filter-segment-button ${isActive ? 'is-active' : ''}`}
                  aria-pressed={isActive}
                  onTouchStart={() => {
                    if (filter.id === activeFilter) return
                    play('uiClick')
                    setAnimateBatchFrom(null)
                    setActiveFilter(filter.id)
                    setVisibleCounts((current) => ({
                      ...current,
                      [filter.id]: INITIAL_VISIBLE_COUNT,
                    }))
                  }}
                  onClick={() => {
                    if (filter.id === activeFilter) return
                    play('uiClick')
                    setAnimateBatchFrom(null)
                    setActiveFilter(filter.id)
                    setVisibleCounts((current) => ({
                      ...current,
                      [filter.id]: INITIAL_VISIBLE_COUNT,
                    }))
                  }}
                >
                  {filter.label}
                </button>
              )
            })}
          </div>

        </div>

        {activeFilter === 'favorites' && filteredItems.length === 0 ? (
          <div className="all-games-empty">暫無收藏遊戲</div>
        ) : null}

        <div className="all-games-grid">
          {visibleItems.map((game, index) => {
            const isFavorite = favoriteIds.includes(game.id)
            const isMaintenance = game.status === 'maintenance'
            const isPreview = game.status === 'preview'
            const isNew = animateBatchFrom !== null && index >= animateBatchFrom

            return (
              <article
                key={game.id}
                className={`game-tile all-game-tile ${isMaintenance ? 'is-maintenance' : ''} ${isPreview ? 'is-preview' : ''} ${isNew ? 'is-new-batch' : ''}`}
                style={isNew ? { '--batch-delay': `${(index - animateBatchFrom) * 40}ms` } : undefined}
                onClick={() => onGameClick?.(game)}
              >
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
                  <img className="game-image" src={game.imageUrl} alt={game.name} loading="lazy" onLoad={e => e.currentTarget.classList.add('img-loaded')} />
                  {isMaintenance ? <MaintenanceSpriteOverlay /> : null}
                  {isPreview ? <PreviewOverlay /> : null}
                </div>
              </article>
            )
          })}
        </div>

        {hasMore ? (
          <button
            type="button"
            className="show-more-games-button"
            onClick={() => {
              play?.('uiWhoosh')
              setAnimateBatchFrom(visibleItems.length)
              setVisibleCounts((current) => ({
                ...current,
                [activeFilter]: (current[activeFilter] ?? INITIAL_VISIBLE_COUNT) + INITIAL_VISIBLE_COUNT,
              }))
            }}
          >
            顯示更多
          </button>
        ) : null}
      </>}
    </section>
  )
}

export default AllGamesSection
