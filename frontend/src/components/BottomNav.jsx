function FooterIcon({ iconType }) {
  if (iconType === 'favorite') {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: '#f0d48a' }}>
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    )
  }

  if (iconType === 'profile') {
    return <span className="footer-icon footer-icon-profile" aria-hidden="true" />
  }

  return <span className="footer-icon" aria-hidden="true" />
}

function BottomNav({ items, onCenterClick, onLeftClick, onRightClick }) {
  const centerItem = items.find((item) => item.type === 'image')
  const sideItems = items.filter((item) => item.type !== 'image').slice(0, 2)
  const [leftItem, rightItem] = sideItems

  return (
    <nav className="bottom-nav">
      {leftItem ? (
        <button
          type="button"
          className={`nav-item ${leftItem.active ? 'active' : ''}`}
          onClick={onLeftClick}
        >
          <div className="nav-item-icon">
            <img src="/event.webp" alt="" />
            <span>{leftItem.label}</span>
          </div>
        </button>
      ) : null}

      {centerItem ? (
        <button
          type="button"
          className={`nav-item nav-center-button ${centerItem.active ? 'active' : ''}`}
          aria-label={centerItem.label}
          onClick={onCenterClick}
        >
          <span className="nav-center-ring">
            <img src="/phantom-footer-logo.webp" alt="" />
          </span>
          <span>{centerItem.label}</span>
        </button>
      ) : null}

      {rightItem ? (
        <button
          type="button"
          className={`nav-item ${rightItem.active ? 'active' : ''}`}
          onClick={onRightClick}
        >
          <div className="nav-item-icon">
            <img src="/info.webp" alt="" />
            <span>{rightItem.label}</span>
          </div>
        </button>
      ) : null}
    </nav>
  )
}

export default BottomNav
