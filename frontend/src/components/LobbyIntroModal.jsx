import AngelFly from './AngelFly'

function LobbyIntroModal({ isOpen, onEnter }) {
  if (!isOpen) {
    return null
  }

  return (
    <div className="auth-modal-backdrop lobby-intro-backdrop" role="presentation">
      <div
        className="lobby-intro-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lobby-intro-title"
      >
        <AngelFly size={145} />
        <div className="lobby-intro-content">
          <h3 id="lobby-intro-title">歡迎回來</h3>
          <p>祝您遊戲愉快!</p>
        </div>
        <button type="button" className="lobby-intro-button" onClick={onEnter}>
          進入遊戲
        </button>
      </div>
    </div>
  )
}

export default LobbyIntroModal
