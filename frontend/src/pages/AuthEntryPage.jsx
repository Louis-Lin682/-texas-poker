import { useState } from 'react'
import AuthFormModal from '../components/AuthFormModal'

function AuthEntryPage({ onBack, onAuthSuccess }) {
  const [authMode, setAuthMode] = useState('')

  return (
    <div className="auth-entry-shell">
      <div className="auth-entry-stage">
        <div className="auth-entry-bg" aria-hidden="true" />
        <div className="auth-entry-vignette" aria-hidden="true" />
        <div className="auth-entry-mask auth-entry-mask-main" aria-hidden="true" />
        <div className="auth-entry-mask auth-entry-mask-soft" aria-hidden="true" />

        <button type="button" className="auth-entry-back" onClick={onBack}>
          返回大廳
        </button>

        <div className="auth-entry-content">
          <div className="auth-entry-badge">會員入口</div>
          <h1>歡迎回來</h1>
          <p>進入俱樂部前，先選擇登入或註冊，收藏與帳號資料都會同步保存。</p>

          <div className="auth-entry-actions">
            <button
              type="button"
              className="auth-entry-button auth-entry-button-primary"
              onClick={() => setAuthMode('login')}
            >
              登入
            </button>
            <button
              type="button"
              className="auth-entry-button auth-entry-button-secondary"
              onClick={() => setAuthMode('register')}
            >
              註冊
            </button>
          </div>
        </div>
      </div>

      <AuthFormModal
        mode={authMode}
        isOpen={Boolean(authMode)}
        onClose={() => setAuthMode('')}
        onAuthSuccess={(token) => {
          setAuthMode('')
          onAuthSuccess?.(token)
        }}
      />
    </div>
  )
}

export default AuthEntryPage
