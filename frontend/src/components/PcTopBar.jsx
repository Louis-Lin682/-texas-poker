import { useNavigate } from 'react-router-dom'
import GuestBanner from './GuestBanner'

function PcTopBar({
  profile,
  isAuthenticated,
  isRefreshingBalance,
  supportUnread = 0,
  onSupportRead,
  onAccountAction,
  onGoLogin,
  onAvatarClick,
}) {
  const navigate = useNavigate()

  return (
    <header className="pc-top-bar">

      <div className="pc-top-profile">
        {isAuthenticated ? (
          <>
            <button type="button" className="pc-avatar-wrap" onClick={onAvatarClick} aria-label="更換頭像">
              <img src={profile.avatar} alt="avatar" className="pc-avatar-img" />
              <span className="vip-tag">{profile.vip}</span>
            </button>
            <div className="pc-profile-info">
              <span className="pc-username">{profile.account}</span>
              <div className="pc-balance">
                {isRefreshingBalance
                  ? <span className="balance-shimmer" />
                  : <strong>{profile.balance}</strong>
                }
              </div>
            </div>
            <button
              type="button"
              className="pc-top-btn"
              onClick={() => navigate('/deposit')}
              aria-label="儲值"
            >
              +
            </button>
            <button
              type="button"
              className="pc-top-btn"
              onClick={() => navigate('/ledger')}
              aria-label="帳務"
            >
              ☰
            </button>
            <button
              type="button"
              className="pc-top-btn pc-cs-btn"
              onClick={() => { onSupportRead?.(); navigate('/support') }}
              aria-label="客服"
            >
              {supportUnread > 0 && (
                <span className="cs-msg-badge">{supportUnread > 9 ? '9+' : supportUnread}</span>
              )}
              ✉
            </button>
            <button
              type="button"
              className="pc-top-btn"
              onClick={() => navigate('/settings')}
              aria-label="設定"
            >
              ⚙
            </button>
            <button
              type="button"
              className="pc-top-btn"
              onClick={onAccountAction}
              aria-label="登出"
            >
              ⏻
            </button>
          </>
        ) : (
          <GuestBanner onGoLogin={onGoLogin} />
        )}
      </div>
    </header>
  )
}

export default PcTopBar
