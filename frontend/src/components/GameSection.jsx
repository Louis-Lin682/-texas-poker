import { useCallback, useEffect, useRef, useState } from 'react'
import HeartIcon from './HeartIcon'
import SectionHeader from './SectionHeader'

const PEEK = 25   // px of side card peeking
const GAP  = 10   // px gap between cards
const ANIM = 270  // ms slide animation

function GameSection({ items, isLoading, favoriteIds, onToggleFavorite, onGameClick }) {
  const n = items?.length ?? 0

  const [trackIdx, setTrackIdx] = useState(2)
  const [hasAnim,  setHasAnim]  = useState(true)
  const [cardW,    setCardW]    = useState(0)
  const wrapperRef = useRef(null)
  const startXRef  = useRef(null)
  const wasDragRef = useRef(false)
  const isAnimRef  = useRef(false)
  const idxRef     = useRef(2)  // mirrors trackIdx for event handlers

  const setIdx = useCallback((v) => {
    const next = typeof v === 'function' ? v(idxRef.current) : v
    idxRef.current = next
    setTrackIdx(next)
  }, [])

  // ─── Measure card width ───────────────────────────────────
  useEffect(() => {
    const measure = () => {
      const w = wrapperRef.current?.offsetWidth ?? 0
      if (w > 0) setCardW((w - 2 * PEEK - 3 * GAP) / 2)
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (wrapperRef.current) ro.observe(wrapperRef.current)
    return () => ro.disconnect()
  }, [])

  // ─── Navigation ───────────────────────────────────────────
  const advance = useCallback((dir) => {
    if (isAnimRef.current) return
    isAnimRef.current = true
    setHasAnim(true)
    setIdx(prev => prev + dir)
  }, [setIdx])

  // isCenter is decided by the game's LOGICAL index (0..n-1), not array position.
  // All clones of the same game share the same logical index, so they always
  // have the same scale. The seamless jump changes trackIdx but not any
  // card's logical-center status → zero className change → zero flash.
  const logicalOf    = (i) => ((i - 2) % n + n) % n
  const logicalCtrA  = n > 0 ? ((trackIdx - 2) % n + n) % n : 0
  const logicalCtrB  = n > 0 ? ((trackIdx - 1) % n + n) % n : 0
  const isCenterCard = (i) => { const l = logicalOf(i); return l === logicalCtrA || l === logicalCtrB }

  // ─── Transition end → seamless jump ───────────────────────
  const handleTransitionEnd = useCallback((e) => {
    if (e.target !== e.currentTarget) return   // ignore child card transitions
    if (e.propertyName !== 'transform') return
    const prev = idxRef.current
    if (prev <= 1 || prev >= n + 2) {
      // Batch both in one render: no-transition + new position.
      // Because isCenter is logical, NO card changes className → no flash.
      setHasAnim(false)
      setIdx(prev <= 1 ? n + 1 : 2)
      requestAnimationFrame(() => { isAnimRef.current = false })
    } else {
      isAnimRef.current = false
    }
  }, [n, setIdx])

  // ─── Drag / swipe ─────────────────────────────────────────
  const onDown = (e) => {
    startXRef.current = e.touches?.[0]?.clientX ?? e.clientX
    wasDragRef.current = false
  }
  const onMove = (e) => {
    if (startXRef.current === null) return
    if (Math.abs((e.touches?.[0]?.clientX ?? e.clientX) - startXRef.current) > 6)
      wasDragRef.current = true
  }
  const onUp = (e) => {
    const x0 = startXRef.current
    if (x0 === null) return
    startXRef.current = null
    const dx = (e.changedTouches?.[0]?.clientX ?? e.clientX) - x0
    if (Math.abs(dx) > 40) advance(dx < 0 ? 1 : -1)
  }

  // ─── Early returns ────────────────────────────────────────
  if (!isLoading && n === 0) return null

  // ─── Derived values ───────────────────────────────────────
  const ready      = !isLoading && n > 0 && cardW > 0
  const translateX = ready ? PEEK + GAP - trackIdx * (cardW + GAP) : 0
  const g          = (i) => items[((i) % n + n) % n]
  const extItems   = ready ? [g(-2), g(-1), ...items, g(0), g(1), g(2)] : []
  const logicalIdx = ready ? logicalCtrA : 0

  return (
    <section className="content-panel">
      <SectionHeader title="熱門遊戲" />

      <div
        ref={wrapperRef}
        className="gs-wrapper"
        onTouchStart={onDown}
        onTouchMove={onMove}
        onTouchEnd={onUp}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={() => { startXRef.current = null }}
      >
        {isLoading && (
          <div className="gs-skeleton">
            <div className="gs-skeleton-card gs-skeleton-side" />
            <div className="gs-skeleton-card gs-skeleton-center" />
            <div className="gs-skeleton-card gs-skeleton-center" />
            <div className="gs-skeleton-card gs-skeleton-side" />
          </div>
        )}
        {ready && (
          <div
            className="gs-track"
            style={{
              transform:  `translateX(${translateX}px)`,
              transition: hasAnim
                ? `transform ${ANIM}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`
                : 'none',
            }}
            onTransitionEnd={handleTransitionEnd}
          >
            {extItems.map((game, i) => {
              const isCenter  = isCenterCard(i)
              const isVisible = i >= trackIdx - 1 && i <= trackIdx + 2
              return (
                <div
                  key={i}
                  className={`gs-card game-card-shell ${isCenter ? 'gs-card--center' : 'gs-card--side'}`}
                  style={{ flex: `0 0 ${cardW}px`, width: cardW, pointerEvents: isVisible ? 'auto' : 'none' }}
                  onClick={() => {
                    if (wasDragRef.current || isCenter) return
                    if (i === trackIdx - 1)      advance(-1)
                    else if (i === trackIdx + 2) advance(1)
                  }}
                >
                  {/* <img className="game-badge-image" src="/hot-badge.png" alt="" aria-hidden="true" /> */}
                  <article
                    className="game-tile"
                    onClick={(e) => {
                      if (wasDragRef.current) { e.stopPropagation(); return }
                      if (!isCenter) return
                      e.stopPropagation()
                      onGameClick?.(game)
                    }}
                  >
                    <button
                      type="button"
                      className={`fav-btn ${favoriteIds.includes(game.id) ? 'is-active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (isCenter && !wasDragRef.current) onToggleFavorite(game.id)
                      }}
                    >
                      <HeartIcon filled={favoriteIds.includes(game.id)} />
                    </button>
                    <div className="game-art">
                      <img className="game-image" src={game.imageUrl} alt={game.name} loading="lazy" />
                      <div className="art-glow" />
                      <div className="art-title"><span>{game.name}</span></div>
                    </div>
                  </article>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="gs-progress">
        {ready && items.map((_, i) => (
          <button
            key={i}
            type="button"
            className={`gs-dot ${i === logicalIdx ? 'gs-dot--active' : ''}`}
            onClick={() => {
              if (isAnimRef.current) return
              isAnimRef.current = true
              setHasAnim(true)
              setIdx(i + 2)
            }}
            aria-label={`切換到第 ${i + 1} 個遊戲`}
          />
        ))}
      </div>
    </section>
  )
}

export default GameSection
