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

function MyDrawer({ isOpen, onClose, profile, onLogout }) {
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
          <section className="my-profile-card">
            <div className="my-profile-topline">
              <div className="my-profile-avatar-wrap">
                <div className="my-profile-avatar">
                  <img src="/phantom-footer-logo.png" alt="" />
                </div>

                <div className="my-profile-vip">{profile.vip}</div>
              </div>

              <div className="my-profile-copy">
                <p>玩家帳號</p>
                <strong>{profile.account}</strong>
                <span>{uidText}</span>
              </div>
            </div>

            <div className="my-profile-balance">
              <span>目前點數</span>
              <strong>{profile.balance}</strong>
            </div>
          </section>

          <section className="my-drawer-section">
            <div className="my-section-heading">
              <h3>常用服務</h3>
            </div>

            <div className="my-action-grid">
              <ActionTile label="儲值紀錄" onClick={() => {}} />
              <ActionTile label="任務中心" onClick={() => goTo('/quest')} />
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
        </div>
      </section>
    </div>
  )
}

export default MyDrawer
