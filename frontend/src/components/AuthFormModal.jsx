import { useEffect, useState } from 'react'
import { login, register } from '../services/authApi'

function AuthFormModal({ mode, isOpen, onClose, onAuthSuccess }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      setUsername('')
      setPassword('')
      setConfirmPassword('')
      setErrorMessage('')
      setIsSubmitting(false)
    }
  }, [isOpen, mode])

  if (!isOpen) {
    return null
  }

  const isRegister = mode === 'register'

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!username.trim() || !password) {
      setErrorMessage('請輸入帳號與密碼')
      return
    }

    if (isRegister && password !== confirmPassword) {
      setErrorMessage('兩次密碼輸入不一致')
      return
    }

    setErrorMessage('')
    setIsSubmitting(true)

    try {
      if (isRegister) {
        await register({
          username: username.trim(),
          password,
        })
      }

      const payload = await login({
        username: username.trim(),
        password,
      })

      onAuthSuccess?.(payload.token)
    } catch (error) {
      setErrorMessage(error.message || '操作失敗，請稍後再試')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="auth-form-backdrop" role="presentation" onClick={onClose}>
      <div
        className="auth-form-modal"
        data-mode={isRegister ? 'register' : 'login'}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-form-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="auth-form-header">
          <h3 className={isRegister ? 'register-top' : 'login-top'}>
            {isRegister ? '註冊會員' : '會員登入'}
          </h3>
          <button type="button" className="auth-form-close" onClick={onClose} aria-label="close auth form">
            ×
          </button>
        </div>

        <form className="auth-form-body" onSubmit={handleSubmit}>
          <label className="auth-field">
            <span>帳號</span>
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="請輸入帳號"
              autoComplete="username"
            />
          </label>

          <label className="auth-field">
            <span>密碼</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="請輸入密碼"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
            />
          </label>

          {isRegister ? (
            <label className="auth-field">
              <span>確認密碼</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="請再次輸入密碼"
                autoComplete="new-password"
              />
            </label>
          ) : null}

          {errorMessage ? <p className="auth-form-error">{errorMessage}</p> : null}

          <button type="submit" className="auth-form-submit" disabled={isSubmitting}>
            {isSubmitting
              ? '處理中...'
              : <img src={isRegister ? '/register.png' : '/login.png'} alt={isRegister ? '完成註冊' : '立即登入'} />}
          </button>
        </form>
      </div>
    </div>
  )
}

export default AuthFormModal
