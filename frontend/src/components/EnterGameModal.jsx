import { useEffect, useState } from 'react'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'

const STEP = 100

function EnterGameModal({ game, auth, minBuyIn = 2000, isOpen, onClose, onGoLogin, onConfirm }) {
  const MIN_BUY_IN = minBuyIn
  const balance = auth.user?.balance ?? 0
  const maxBuyIn = Math.floor(balance / STEP) * STEP
  const [buyIn, setBuyIn] = useState(MIN_BUY_IN)

  // Reset slider to min whenever the modal opens (picks up latest minBuyIn from backend)
  useEffect(() => {
    if (isOpen) setBuyIn(MIN_BUY_IN)
  }, [isOpen, MIN_BUY_IN])

  useBodyScrollLock(isOpen)

  if (!isOpen || !game) return null

  const isAuthenticated = auth.isAuthenticated
  const hasEnoughBalance = balance >= MIN_BUY_IN

  if (!auth.isAuthenticated) {
    return (
      <div className="auth-modal-backdrop" role="presentation" onClick={onClose}>
        <div
          className="auth-modal enter-game-modal"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="auth-modal-kicker">Game Access</p>
          <h3>請先登入或註冊</h3>
          <p>登入後才能進入遊戲桌，立即完成帳號設置吧！</p>
          <div className="auth-modal-actions">
            <button type="button" className="auth-modal-button auth-modal-button-muted" onClick={onClose}>
              取消
            </button>
            <button type="button" className="auth-modal-button" onClick={onGoLogin}>
              去登入 / 註冊
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (auth.user?.suspended_at) {
    return (
      <div className="auth-modal-backdrop" role="presentation" onClick={onClose}>
        <div
          className="auth-modal enter-game-modal"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="auth-modal-kicker" style={{ color: '#ff4d4f' }}>帳號停權</p>
          <h3>您已被停權</h3>
          <p>如有疑問，請聯繫客服。</p>
          <div className="auth-modal-actions" style={{ gridTemplateColumns: '1fr' }}>
            <button type="button" className="auth-modal-button" onClick={onClose}>
              我知道了
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!hasEnoughBalance) {
    return (
      <div className="auth-modal-backdrop" role="presentation" onClick={onClose}>
        <div
          className="auth-modal enter-game-modal"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="auth-modal-kicker">餘額不足</p>
          <h3>無法進入遊戲</h3>
          <p>
            進入遊戲最少需要 <span className="enter-game-highlight">{new Intl.NumberFormat('en-US').format(MIN_BUY_IN)}</span> 點，
            您目前的餘額為 <span className="enter-game-highlight">{new Intl.NumberFormat('en-US').format(balance)}</span> 點。
          </p>
          <div className="auth-modal-actions" style={{ gridTemplateColumns: '1fr' }}>
            <button type="button" className="auth-modal-button" onClick={onClose}>
              我知道了
            </button>
          </div>
        </div>
      </div>
    )
  }

  const clampedBuyIn = Math.min(Math.max(MIN_BUY_IN, buyIn), maxBuyIn)

  return (
    <div className="auth-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="auth-modal enter-game-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="auth-modal-kicker">Buy-in</p>
        <h3>帶多少籌碼入場？</h3>

        <div className="enter-game-balance-row">
          <span className="enter-game-balance-label">可用餘額</span>
          <span className="enter-game-balance-value">{new Intl.NumberFormat('en-US').format(balance)}</span>
        </div>

        <div className="enter-game-buyin-display">
          {new Intl.NumberFormat('en-US').format(clampedBuyIn)}
        </div>

        <div className="enter-game-slider-row">
          <span className="enter-game-slider-min">{new Intl.NumberFormat('en-US').format(clampedBuyIn)}</span>
          <input
            type="range"
            className="pt-raise-slider enter-game-slider"
            min={MIN_BUY_IN}
            max={maxBuyIn}
            step={STEP}
            value={clampedBuyIn}
            onChange={(e) => setBuyIn(Number(e.target.value))}
          />
          <span className="enter-game-slider-max">{new Intl.NumberFormat('en-US').format(maxBuyIn)}</span>
        </div>

        <div className="enter-game-quick-btns">
          {[0.25, 0.5, 0.75, 1].map((ratio) => {
            const val = Math.round((MIN_BUY_IN + (maxBuyIn - MIN_BUY_IN) * ratio) / STEP) * STEP
            const label = ratio === 1 ? '全部' : `${Math.round(ratio * 100)}%`
            return (
              <button
                key={ratio}
                type="button"
                className={`enter-game-quick-btn ${clampedBuyIn === val ? 'is-active' : ''}`}
                onClick={() => setBuyIn(val)}
              >
                {label}
              </button>
            )
          })}
        </div>

        <div className="auth-modal-actions">
          <button type="button" className="auth-modal-button auth-modal-button-muted" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="auth-modal-button"
            onClick={() => onConfirm(clampedBuyIn)}
          >
            確認進場
          </button>
        </div>
      </div>
    </div>
  )
}

export default EnterGameModal
