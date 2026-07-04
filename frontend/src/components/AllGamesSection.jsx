import { useEffect, useMemo, useRef, useState } from 'react'
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

  const activeIndex = FILTERS.findIndex((f) => f.id === activeFilter)
  const sentinelRef = useRef(null)

  // Precompute per-filter index for each item (for show-more cutoff)
  const enriched = useMemo(() => {
    const idx = { all: 0, favorites: 0, electronic: 0, poker: 0 }
    return items.map((game) => {
      const match = {
        all:        true,
        favorites:  favoriteIds.includes(game.id),
        electronic: game.category === 'electronic',
        poker:      game.category === 'poker',
      }
      const filterIdx = {}
      Object.keys(match).forEach((fid) => {
        if (match[fid]) filterIdx[fid] = ++idx[fid]
      })
      return { game, match, filterIdx }
    })
  }, [items, favoriteIds])

  const totalInFilter  = enriched.filter((e) => e.match[activeFilter]).length
  const visibleInFilter = visibleCounts[activeFilter] ?? INITIAL_VISIBLE_COUNT
  const hasMore = totalInFilter > visibleInFilter
  const noFavorites = activeFilter === 'favorites' && totalInFilter === 0

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisibleCounts((c) => ({
            ...c,
            [activeFilter]: (c[activeFilter] ?? INITIAL_VISIBLE_COUNT) + INITIAL_VISIBLE_COUNT,
          }))
        }
      },
      { rootMargin: '600px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, activeFilter, visibleInFilter])

  function selectFilter(id) {
    if (id === activeFilter) return
    play('uiClick')
    setActiveFilter(id)
    setVisibleCounts((c) => ({ ...c, [id]: INITIAL_VISIBLE_COUNT }))
  }

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
            {FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                data-no-global-click="true"
                className={`game-filter-segment-button ${filter.id === activeFilter ? 'is-active' : ''}`}
                aria-pressed={filter.id === activeFilter}
                onTouchStart={() => selectFilter(filter.id)}
                onClick={() => selectFilter(filter.id)}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {noFavorites && <div className="all-games-empty">暫無收藏遊戲</div>}

        <div className="all-games-grid">
          {enriched.map(({ game, match, filterIdx }) => {
            const hidden = !match[activeFilter] || (filterIdx[activeFilter] ?? 0) > visibleInFilter
            const isFavorite = favoriteIds.includes(game.id)
            const isMaintenance = game.status === 'maintenance'
            const isPreview = game.status === 'preview'

            return (
              <article
                key={game.id}
                className={`game-tile all-game-tile ${isMaintenance ? 'is-maintenance' : ''} ${isPreview ? 'is-preview' : ''} ${filterIdx[activeFilter] === 1 ? 'is-pc-featured' : ''}`}
                style={hidden ? { display: 'none' } : undefined}
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
                  <img
                    className="game-image"
                    src={game.imageUrl}
                    alt={game.name}
                    loading="lazy"
                    onLoad={(e) => e.currentTarget.classList.add('img-loaded')}
                  />
                  {isMaintenance ? <MaintenanceSpriteOverlay /> : null}
                  {isPreview ? <PreviewOverlay /> : null}
                </div>
              </article>
            )
          })}
        </div>

        {hasMore && <div ref={sentinelRef} className="games-sentinel" />}
      </>}
    </section>
  )
}

export default AllGamesSection
