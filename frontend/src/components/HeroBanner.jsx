function HeroBanner() {
  return (
    <section className="hero-banner">
      <img className="hero-image" src="/hero-banner.png" alt="Casino hero banner" />
      <div className="hero-overlay" />

      <div className="hero-copy">
        <h1>
          新戶首儲加碼
          <br />
          最高 100% 回饋
        </h1>
        <p>完成首次儲值即可享有對應回饋，先領入場禮金，再上桌體驗德州主桌與熱門牌局。</p>
        <button type="button" className="cta-button">
          立即加入
        </button>
      </div>
    </section>
  )
}

export default HeroBanner
