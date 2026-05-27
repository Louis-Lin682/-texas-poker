function LobbyIntroModal({ isOpen, onEnter }) {
  if (!isOpen) {
    return null
  }

  return (
    <div className="auth-modal-backdrop lobby-intro-backdrop" role="presentation">
      <div
        className="auth-modal lobby-intro-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lobby-intro-title"
      >
        <img
          className="lobby-intro-logo"
          src="/phantom-footer-logo.png"
          alt="Phantom Holdem logo"
        />

        <h3 id="lobby-intro-title">歡迎回來</h3>
        <p>祝您遊戲愉快!</p>

        <button type="button" className="auth-modal-button lobby-intro-button" onClick={onEnter}>
          進入遊戲
        </button>
      </div>
    </div>
  )
}

export default LobbyIntroModal
