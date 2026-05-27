const CONTENT = {
  favorite: {
    kicker: 'Favorite Access',
    title:  '登入後即可收藏',
    body:   '先完成註冊或登入，才可以收藏哦',
  },
  member: {
    kicker: 'Member Access',
    title:  '請先登入或註冊',
    body:   '登入後才能使用個人頁面與相關功能',
  },
  default: {
    kicker: 'Login Required',
    title:  '請先登入或註冊',
    body:   '完成登入後即可繼續使用此功能',
  },
}

function AuthPromptModal({ isOpen, onClose, onGoLogin, context = 'default' }) {
  if (!isOpen) return null

  const { kicker, title, body } = CONTENT[context] ?? CONTENT.default

  return (
    <div className="auth-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="auth-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="auth-modal-kicker">{kicker}</p>
        <h3 id="auth-modal-title">{title}</h3>
        <p>{body}</p>

        <div className="auth-modal-actions">
          <button type="button" className="auth-modal-button auth-modal-button-muted" onClick={onClose}>
            我知道了
          </button>
          <button type="button" className="auth-modal-button" onClick={onGoLogin}>
            去登入
          </button>
        </div>
      </div>
    </div>
  )
}

export default AuthPromptModal
