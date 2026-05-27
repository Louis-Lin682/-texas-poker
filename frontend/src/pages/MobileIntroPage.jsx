function MobileIntroPage() {
  return (
    <div className="intro-shell">
      <div className="intro-phone">
        <div className="intro-statusbar">
          <span>SKETCH</span>
          <span>100%</span>
        </div>

        <div className="intro-content">
          <div className="intro-logo-mark">
            <div className="intro-logo-skull" />
          </div>

          <div className="intro-heading">
            <h1>PHANTOM HOLD&apos;EM</h1>
            <p>THE OFFICIAL TEXAS HOLDEM LOUNGE</p>
          </div>

          <div className="intro-copy-block">
            <div className="intro-copy-line" />
            <div className="intro-copy-line short" />
          </div>

          <div className="intro-feature-list">
            <div className="intro-feature-card">
              <span>♠</span>
              <strong>Texas Holdem Only</strong>
              <p>目前僅開放德州撲克玩法</p>
            </div>

            <div className="intro-feature-card">
              <span>✦</span>
              <strong>Official Mobile Lobby</strong>
              <p>先看氛圍與視覺，不放表單元件</p>
            </div>
          </div>

          <div className="intro-divider">
            <span />
            <p>Midnight Table</p>
            <span />
          </div>

          <div className="intro-icons">
            <div className="intro-icon-ring">♣</div>
            <div className="intro-icon-ring">♦</div>
            <div className="intro-icon-ring">♥</div>
          </div>
        </div>

        <div className="intro-floor-glow" />
      </div>
    </div>
  )
}

export default MobileIntroPage
