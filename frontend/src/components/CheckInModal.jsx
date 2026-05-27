import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { useCheckIn } from '../hooks/useCheckIn'

const DAYS = [
  { day: 1, reward: 100 },
  { day: 2, reward: 100 },
  { day: 3, reward: 300 },
  { day: 4, reward: 300 },
  { day: 5, reward: 300 },
  { day: 6, reward: 800 },
  { day: 7, reward: 800 },
]

function fmt(n) {
  return n >= 1000 ? `${n / 1000}K` : String(n)
}

function CheckInModal({ isOpen, onClose, token, isAuthenticated, onBalanceUpdate }) {
  useBodyScrollLock(isOpen)
  const { status, loading, error, claim } = useCheckIn({ token, isAuthenticated, isOpen })

  if (!isOpen) return null

  const cycleDay = status?.cycle_day ?? 1
  const checkedToday = status?.checked_today ?? false
  const streak = status?.streak ?? 0
  const todayReward = status?.today_reward ?? 100

  const handleClaim = async () => {
    try {
      await claim()
      onBalanceUpdate?.()
    } catch {
      // ignore
    }
  }

  return (
    <div className="ci-backdrop" onClick={onClose}>
      <div className="ci-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="ci-dismiss" aria-label="關閉" onClick={onClose}>×</button>

        <div className="ci-inner">
          <div className="ci-header">
            <span className="ci-header-title">每日簽到</span>
            <span className="ci-header-sub">斷簽將從第 1 天重新計算</span>
          </div>

          <div className="ci-streak-row">
            <span className="ci-streak-num">{streak}</span>
            <span className="ci-streak-label">連續簽到天數</span>
          </div>

          <div className="ci-grid">
            {DAYS.flatMap(({ day, reward }) => {
              const isDone = checkedToday ? day <= cycleDay : day < cycleDay
              const isToday = !checkedToday && day === cycleDay
              const isLocked = day > cycleDay

              const cell = (
                <div
                  key={day}
                  className={`ci-day ${isDone ? 'is-done' : ''} ${isToday ? 'is-today' : ''} ${isLocked ? 'is-locked' : ''} ${day === 7 ? 'is-special' : ''}`}
                >
                  <span className="ci-day-label">Day {day}</span>
                  <span className="ci-day-amount">{fmt(reward)}</span>
                  <span className="ci-day-unit">籌碼</span>
                  {isDone && (
                    <img
                      className="ci-stamp"
                      src="/stamp.png"
                      alt=""
                      style={{ '--stamp-delay': `${(day - 1) * 80}ms` }}
                    />
                  )}
                </div>
              )

              return day === 5 ? [<div key="spacer" className="ci-day-spacer" />, cell] : [cell]
            })}
          </div>

          {error && <p className="ci-error">{error}</p>}

          <button
            type="button"
            className={`ci-claim-btn ${checkedToday ? 'is-claimed' : ''}`}
            disabled={checkedToday || loading}
            onClick={handleClaim}
          >
            {checkedToday ? '今日已簽到' : loading ? '處理中...' : `領取 ${fmt(todayReward)} 籌碼`}
          </button>
        </div>
        <div className="ci-bottom-img">
          <img src="/public/SignIn_icon.png" alt="" />
        </div>
      </div>
    </div>
  )
}

export default CheckInModal
