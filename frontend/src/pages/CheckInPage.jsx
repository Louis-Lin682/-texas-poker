import { useState } from 'react'
import PageShell from '../components/PageShell'

const DAYS = [
  { day: 1, reward: '500', unit: '籌碼', done: true },
  { day: 2, reward: '800', unit: '籌碼', done: true },
  { day: 3, reward: '1,200', unit: '籌碼', done: true },
  { day: 4, reward: '2,000', unit: '籌碼', isToday: true },
  { day: 5, reward: '3,500', unit: '籌碼' },
  { day: 6, reward: '5,000', unit: '籌碼' },
  { day: 7, reward: '10,000', unit: '籌碼', isSpecial: true },
]

function CheckInPage() {
  const [claimed, setClaimed] = useState(false)

  return (
    <PageShell title="簽到獎勵" accent="#8f63ff">
      <div className="checkin-streak-banner">
        <span className="checkin-streak-count">3</span>
        <div className="checkin-streak-text">
          <strong>連續簽到天數</strong>
          <span>再簽 4 天可解鎖週獎勵</span>
        </div>
        <div className="checkin-streak-flame">🔥</div>
      </div>

      <div className="checkin-grid">
        {DAYS.slice(0, 6).map(({ day, reward, unit, done, isToday }) => (
          <div
            key={day}
            className={`checkin-day ${done ? 'is-done' : ''} ${isToday ? 'is-today' : ''} ${!done && !isToday ? 'is-locked' : ''}`}
          >
            <span className="checkin-day-label">Day {day}</span>
            {done ? (
              <span className="checkin-day-check">✓</span>
            ) : (
              <span className="checkin-day-reward-amount">{reward}</span>
            )}
            <span className="checkin-day-unit">{done ? '已領取' : unit}</span>
          </div>
        ))}
      </div>

      <div className="checkin-day checkin-day-special is-locked">
        <span className="checkin-day-label">Day 7 · 週獎勵</span>
        <span className="checkin-day-reward-amount">10,000</span>
        <span className="checkin-day-unit">籌碼 + 限定道具</span>
      </div>

      <button
        type="button"
        className={`checkin-claim-btn ${claimed ? 'is-claimed' : ''}`}
        onClick={() => setClaimed(true)}
        disabled={claimed}
      >
        {claimed ? '今日已簽到' : '立即簽到'}
      </button>

      <p className="checkin-note">每日 00:00 重置，斷簽將從第 1 天重新計算</p>
    </PageShell>
  )
}

export default CheckInPage
