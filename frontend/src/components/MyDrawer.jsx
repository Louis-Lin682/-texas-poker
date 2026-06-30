import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'

function ActionTile({ label, onClick }) {
  return (
    <button type="button" className="my-action-tile" onClick={onClick}>
      <span>{label}</span>
    </button>
  )
}

function MenuRow({ label, onClick, danger = false }) {
  return (
    <button
      type="button"
      className={`my-menu-row ${danger ? 'is-danger' : ''}`}
      onClick={onClick}
    >
      <span>{label}</span>
    </button>
  )
}

function MyDrawer({ isOpen, onClose, profile, isAuthenticated, isGuest, onGuestLogin, onGoLogin, onLogout }) {
  const [shouldRender, setShouldRender] = useState(isOpen)
  const [isClosing, setIsClosing] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true)
      setIsClosing(false)
      return
    }

    if (!shouldRender) {
      return
    }

    setIsClosing(true)

    const timer = window.setTimeout(() => {
      setShouldRender(false)
      setIsClosing(false)
    }, 280)

    return () => window.clearTimeout(timer)
  }, [isOpen, shouldRender])

  useBodyScrollLock(isOpen)

  const uidText = profile.id
    ? `UID ${String(profile.id).slice(0, 8).toUpperCase()}`
    : 'UID --'

  if (!shouldRender) {
    return null
  }

  const goTo = (path) => { onClose(); navigate(path) }

  return (
    <div
      className={`drawer-backdrop ${isClosing ? 'is-closing' : 'is-open'}`}
      role="presentation"
      onClick={onClose}
    >
      <section
        className={`my-drawer ${isClosing ? 'is-closing' : 'is-open'}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="my-drawer-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer-handle" aria-hidden="true" />

        <div className="my-drawer-header">
          <button
            type="button"
            className="favorites-close-button"
            aria-label="關閉我的頁面"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="my-drawer-scroll">
          {/* ── 未登入 ── */}
          {!isAuthenticated && (
            <div className="my-guest-cta">
              <img src="/phantom-footer-logo.png" alt="" className="my-guest-logo" />
              <p className="my-guest-hint">登入或以訪客身份繼續</p>
              <button type="button" className="my-guest-btn-login" onClick={onGoLogin}>
                登入 / 註冊
              </button>
              <button type="button" className="my-guest-btn-guest" onClick={onGuestLogin}>
                訪客模式（5,000 籌碼）
              </button>
            </div>
          )}

          {/* ── 已登入（訪客或正式） ── */}
          {isAuthenticated && (
            <>
              <section className="my-profile-card">
                {isGuest && (
                  <div className="my-guest-badge">訪客</div>
                )}
                <div className="my-profile-topline">
                  <div className="my-profile-avatar-wrap">
                    <div className="my-profile-avatar">
                      <img src="/phantom-footer-logo.png" alt="" />
                    </div>
                    {!isGuest && <div className="my-profile-vip">{profile.vip}</div>}
                  </div>

                  <div className="my-profile-copy">
                    <p>{isGuest ? '訪客帳號' : '玩家帳號'}</p>
                    <strong>{profile.account}</strong>
                    <span>{uidText}</span>
                  </div>
                </div>

                <div className="my-profile-balance">
                  <span>目前點數</span>
                  <strong>{profile.balance}</strong>
                </div>

                {isGuest && (
                  <button type="button" className="my-upgrade-btn" onClick={() => { onClose(); navigate('/auth', { state: { mode: 'register' } }) }}>
                    升級為正式帳號
                  </button>
                )}
              </section>

              <section className="my-drawer-section">
                <div className="my-section-heading">
                  <h3>常用服務</h3>
                </div>

                <div className="my-action-grid">
                  {!isGuest && <ActionTile label="儲值" onClick={() => goTo('/deposit')} />}
                  {!isGuest && <ActionTile label="任務中心" onClick={() => goTo('/quest')} />}
                  <ActionTile label="最新消息" onClick={() => goTo('/news')} />
                  <ActionTile label="帳務明細" onClick={() => goTo('/ledger')} />
                </div>
              </section>

              <section className="my-drawer-section">
                <div className="my-section-heading">
                  <h3>帳號與支援</h3>
                </div>

                <div className="my-menu-list">
                  <MenuRow label="設定" onClick={() => goTo('/settings')} />
                  <MenuRow label="客服" onClick={() => goTo('/support')} />
                  <MenuRow label="登出" danger onClick={onLogout} />
                </div>
              </section>
            </>
          )}
        </div>
      </section>
    </div>
  )
}

export default MyDrawer
