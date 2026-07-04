function LogoutConfirmModal({ isOpen, onClose, onConfirm }) {
  if (!isOpen) {
    return null
  }

  return (
    <div className="auth-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="logout-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="logout-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <img src="/phantom-footer-logo.png" alt="" />
        <div className="logout-modal-title-row">
          <h3 id="logout-modal-title">確定要登出？</h3>
        </div>

        <div className="logout-modal-actions">
          <button type="button" className="logout-modal-btn logout-modal-btn--cancel" onClick={onClose}>
            <img src="/auth-button-left.png" alt="" />
            <span>先不要</span>
          </button>
          <button type="button" className="logout-modal-btn logout-modal-btn--confirm" onClick={onConfirm}>
            <img src="/auth-button-right.png" alt="" />
            <span>確認登出</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default LogoutConfirmModal
