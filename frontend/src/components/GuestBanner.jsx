function GuestBanner({ onGoLogin }) {
  return (
    <section className="guest-banner">
      <div className="guest-avatar" aria-hidden="true">?</div>

      <div className="guest-copy">
        <strong>訪客模式</strong>
        <span>登入後解鎖收藏、紀錄與更多功能</span>
      </div>

      <button type="button" className="guest-login-button" onClick={onGoLogin}>
        登入
      </button>
    </section>
  )
}

export default GuestBanner
