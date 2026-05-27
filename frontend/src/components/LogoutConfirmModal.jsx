function LogoutConfirmModal({ isOpen, onClose, onConfirm }) {
  if (!isOpen) {
    return null
  }

  return (
    <div className="auth-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="auth-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="logout-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="auth-modal-kicker">Account Exit</p>
        <h3 id="logout-modal-title">確定要登出？</h3>

        <div className="auth-modal-actions">
          <button type="button" className="auth-modal-button auth-modal-button-muted" onClick={onClose}>
            先不要
          </button>
          <button type="button" className="auth-modal-button" onClick={onConfirm}>
            確認登出
          </button>
        </div>
      </div>
    </div>
  )
}

export default LogoutConfirmModal
