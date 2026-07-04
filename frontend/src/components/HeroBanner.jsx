import { useEffect, useRef, useState } from 'react'

function HeroBanner() {
  const sectionRef = useRef(null)
  const [animKey, setAnimKey] = useState(0)

  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setAnimKey(k => k + 1) },
      { threshold: 0.3 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <section className="hero-banner" ref={sectionRef}>
      <img className="hero-image" src="/hero-banner.webp" alt="Casino hero banner" />

      <div className="hero-copy">
        <h1>
          <img key={animKey} className="hero-banner-text" src="/hero-banner-text.webp" alt="hero-banner-text" />
          <img key={`span-${animKey}`} className="hero-banner-span" src="/hero-banner-span.webp" alt="hero-banner-span" />
        </h1>
        <button type="button" className="cta-button">
          <img className="hero-banner-span" src="/hero-banner-btn.webp" alt="hero-banner-btn" />
        </button>
      </div>
    </section>
  )
}

export default HeroBanner
