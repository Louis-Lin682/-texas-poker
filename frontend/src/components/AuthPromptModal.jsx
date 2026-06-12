const CONTENT = {
  favorite: {
    title: '登入後即可收藏',
    body:  '先完成註冊或登入，才可以收藏哦',
  },
  member: {
    title: '請先登入或註冊',
    body:  '登入後才能使用個人頁面與相關功能',
  },
  game: {
    title: '請先登入或註冊',
    body:  '登入後才能進入遊戲桌，立即完成帳號設置吧！',
  },
  default: {
    title: '請先登入或註冊',
    body:  '完成登入後即可繼續使用此功能',
  },
}

function AuthPromptModal({ isOpen, onClose, onGoLogin, context = 'default' }) {
  if (!isOpen) return null

  const { title, body } = CONTENT[context] ?? CONTENT.default

  return (
    <div className="auth-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="auth-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <img className="auth-modal-angel" src="/notice-angel.png" alt="" aria-hidden="true" />
        <div className="auth-modal-content">
          <h3 id="auth-modal-title">{title}</h3>
          <p>{body}</p>
        </div>
        <div className="auth-modal-actions">
          <button type="button" className="auth-modal-btn-dismiss" onClick={onClose}>
            我知道了
          </button>
          <button type="button" className="auth-modal-btn-login" onClick={onGoLogin}>
            去登入
          </button>
        </div>
      </div>
    </div>
  )
}

export default AuthPromptModal
