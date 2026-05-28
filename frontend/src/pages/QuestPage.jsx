import { useState } from 'react'
import PageShell from '../components/PageShell'
import VipPageHeader from '../components/VipPageHeader'

const DAILY = [
  { id: 'd1', title: '完成一局遊戲', current: 0, total: 1, reward: 500 },
  { id: 'd2', title: '累計下注 10,000 籌碼', current: 6200, total: 10000, reward: 1000 },
  { id: 'd3', title: '收藏一款遊戲', current: 1, total: 1, reward: 300, done: true },
  { id: 'd4', title: '登入大廳', current: 1, total: 1, reward: 200, done: true },
]

const WEEKLY = [
  { id: 'w1', title: '完成 20 局遊戲', current: 12, total: 20, reward: 5000 },
  { id: 'w2', title: '累計贏得 50,000 籌碼', current: 31400, total: 50000, reward: 8000 },
  { id: 'w3', title: '連續登入 7 天', current: 3, total: 7, reward: 10000 },
]

function QuestItem({ quest, onClaim }) {
  const pct = Math.min(100, Math.round((quest.current / quest.total) * 100))
  const isDone = quest.done || quest.current >= quest.total

  return (
    <div className={`quest-item ${isDone ? 'is-done' : ''}`}>
      <div className="quest-item-info">
        <span className="quest-item-title">{quest.title}</span>
        <span className="quest-item-progress-text">
          {quest.current.toLocaleString()} / {quest.total.toLocaleString()}
        </span>
      </div>
      <div className="quest-progress-bar">
        <div className="quest-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="quest-item-footer">
        <span className="quest-reward">+{quest.reward.toLocaleString()} 籌碼</span>
        <button
          type="button"
          className={`quest-claim-btn ${!isDone ? 'is-disabled' : ''}`}
          disabled={!isDone}
          onClick={() => isDone && onClaim(quest.id)}
        >
          {isDone ? '領取' : '未完成'}
        </button>
      </div>
    </div>
  )
}

function QuestPage() {
  const [claimed, setClaimed] = useState(new Set())

  const handleClaim = (id) => setClaimed((prev) => new Set([...prev, id]))

  const renderQuests = (quests) =>
    quests.map((q) => (
      <QuestItem
        key={q.id}
        quest={claimed.has(q.id) ? { ...q, done: false, current: 0 } : q}
        onClaim={handleClaim}
      />
    ))

  return (
    <PageShell title="" accent="#ffb58a">
      <VipPageHeader title="任務中心" eyebrow="MISSION CENTER" />
      <div className="quest-section-header">
        <span className="quest-section-title">每日任務</span>
        <span className="quest-reset-time">重置 18:22:05</span>
      </div>
      <div className="quest-list">{renderQuests(DAILY)}</div>

      <div className="quest-section-header" style={{ marginTop: 24 }}>
        <span className="quest-section-title">週常任務</span>
        <span className="quest-reset-time">重置 Mon 00:00</span>
      </div>
      <div className="quest-list">{renderQuests(WEEKLY)}</div>
    </PageShell>
  )
}

export default QuestPage
