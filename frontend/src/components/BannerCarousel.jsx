import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const SLIDES = [
  { src: '/banner/hero-banner.png', to: '/event' },
  { src: '/banner/checkin-banner.png', action: 'checkin' },
]

const AUTO_MS = 4000

function BannerCarousel({ onCheckin }) {
  const navigate = useNavigate()
  const [idx, setIdx] = useState(0)
  const [animKey, setAnimKey] = useState(0)
  const timerRef = useRef(null)
  const startXRef = useRef(null)
  const didDragRef = useRef(false)

  const startTimer = useCallback(() => {
    clearInterval(timerRef.current)
    timerRef.current = setInterval(
      () => setIdx(i => (i + 1) % SLIDES.length),
      AUTO_MS
    )
  }, [])

  useEffect(() => {
    startTimer()
    return () => clearInterval(timerRef.current)
  }, [startTimer])

  useEffect(() => {
    if (idx === 0) setAnimKey(k => k + 1)
  }, [idx])

  const goTo = useCallback((i) => {
    setIdx(((i % SLIDES.length) + SLIDES.length) % SLIDES.length)
    startTimer()
  }, [startTimer])

  const onTouchStart = (e) => {
    startXRef.current = e.touches[0].clientX
    didDragRef.current = false
  }
  const onTouchEnd = (e) => {
    if (startXRef.current === null) return
    const dx = e.changedTouches[0].clientX - startXRef.current
    startXRef.current = null
    if (Math.abs(dx) < 30) return
    didDragRef.current = true
    goTo(idx + (dx < 0 ? 1 : -1))
  }

  const handleClick = () => {
    if (didDragRef.current) { didDragRef.current = false; return }
    const { to, action } = SLIDES[idx]
    if (action === 'checkin') { onCheckin?.(); return }
    if (to) navigate(to)
  }

  const heroActive = idx === 0

  return (
    <section
      className="banner-carousel"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onClick={handleClick}
      style={{ cursor: (SLIDES[idx].to || SLIDES[idx].action) ? 'pointer' : 'default' }}
    >
      {SLIDES.map(({ src }, i) => (
        <img
          key={src}
          className={`banner-slide${i === idx ? ' banner-slide--active' : ''}`}
          src={src}
          alt=""
          draggable={false}
        />
      ))}

      <div className={`banner-hero-gradient${heroActive ? ' banner-hero-visible' : ''}`} />

      <div className={`banner-hero-content${heroActive ? ' banner-hero-visible' : ''}`}>
        <div className="hero-copy">
          <h1>
            <img key={`text-${animKey}`} className="hero-banner-text" src="/banner/hero-banner-text.png" alt="" />
            <img key={`span-${animKey}`} className="hero-banner-span" src="/banner/hero-banner-span.png" alt="" />
          </h1>
          <button type="button" className="cta-button">
            <img src="/banner/hero-banner-btn.png" alt="" />
          </button>
        </div>
      </div>

      <div className="banner-dots">
        {SLIDES.map((_, i) => (
          <button
            key={i}
            type="button"
            className={`banner-dot${i === idx ? ' banner-dot--active' : ''}`}
            onClick={(e) => { e.stopPropagation(); goTo(i) }}
          />
        ))}
      </div>
    </section>
  )
}

export default BannerCarousel
