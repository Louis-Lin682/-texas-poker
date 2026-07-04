import { useNavigate } from 'react-router-dom'

function PageShell({ title, accent = '#f0c96b', bodyClassName, titleLeft, children }) {
  const navigate = useNavigate()

  return (
    <div className="app-shell">
      <div className="phone-frame sub-page-frame">
        <header className="sub-page-header" style={{ '--page-accent': accent }}>
          <button type="button" className="sub-page-back" onClick={() => navigate('/')}>
            <img src="/arrow.webp" alt="" />
          </button>
          <h1 className={`sub-page-title${titleLeft ? ' sub-page-title-left' : ''}`}>{title}</h1>
          {!titleLeft && <span className="sub-page-header-end" />}
        </header>
        <div className={`sub-page-body${bodyClassName ? ` ${bodyClassName}` : ''}`}>
          {children}
        </div>
      </div>
    </div>
  )
}

export default PageShell
