function MessageIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H10l-4 4v-4.3A2.5 2.5 0 0 1 4 13.5z" />
    </svg>
  )
}

function AccountDoorIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 5H6.5A2.5 2.5 0 0 0 4 7.5v9A2.5 2.5 0 0 0 6.5 19H10" />
      <path d="M13 8l4 4-4 4" />
      <path d="M9 12h8" />
    </svg>
  )
}

import { useNavigate } from 'react-router-dom'

function ProfileCard({ profile, isAuthenticated, isRefreshingBalance, onAccountAction, supportUnread = 0, onSupportRead }) {
  const navigate = useNavigate()
  const avatarText = profile.account ? profile.account.slice(0, 1).toUpperCase() : 'G'

  function handleMessageClick() {
    onSupportRead?.()
    navigate('/support')
  }

  return (
    <section className="profile-bar">
      <div className="avatar-wrap">
        <img src="/notice-angel.png" alt="avatar" className="avatar-img" />
        <span className="vip-tag">{profile.vip}</span>
      </div>

      <div className="profile-main">
        <div className="profile-header">
          <div className={`profile-identity ${isAuthenticated ? '' : 'is-hidden'}`}>
            {isAuthenticated ? (
              <>
                <span className="profile-label">玩家帳號</span>
                <strong>{profile.account}</strong>
              </>
            ) : null}
          </div>

          <div className="profile-badges">
            <button type="button" className="balance-add-button" aria-label="add chips" onClick={() => navigate('/deposit')}>
              +
            </button>
            <button type="button" className="round-icon cs-msg-btn" aria-label="客服訊息" onClick={handleMessageClick}>
              <MessageIcon />
              {supportUnread > 0 && (
                <span className="cs-msg-badge">{supportUnread > 9 ? '9+' : supportUnread}</span>
              )}
            </button>
            <button
              type="button"
              className="round-icon"
              aria-label={isAuthenticated ? 'logout account' : 'open login'}
              onClick={onAccountAction}
            >
              <AccountDoorIcon />
            </button>
          </div>
        </div>

        <div className="balance-card">
          <div className="balance-copy">
            {isRefreshingBalance
              ? <span className="balance-shimmer" aria-label="更新中" />
              : <strong>{profile.balance}</strong>
            }
          </div>
        </div>
      </div>
    </section>
  )
}

export default ProfileCard
