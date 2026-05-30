import { useEffect, useState } from 'react'
import PageShell from '../components/PageShell'
import VipPageHeader from '../components/VipPageHeader'
import { claimQuest, getQuests } from '../services/questApi'
import { usePageReady } from '../hooks/usePageReady'

const TOKEN_KEY = 'texas_holdem_auth_token'

const TABS = [
  { id: 'daily',       label: '每日任務' },
  { id: 'weekly',      label: '週常任務' },
  { id: 'achievement', label: '成就'     },
]

const TIER_IMG = [
  '/Achievement/Achievement1.png',
  '/Achievement/Achievement2.png',
  '/Achievement/Achievement3.png',
  '/Achievement/Achievement4.png',
  '/Achievement/Achievement5.png',
]

function pct(current, target) {
  return Math.min(100, Math.round((current / target) * 100))
}

function fmt(n) {
  return Number(n).toLocaleString('en-US')
}

function getResetCountdown(type) {
  const now = new Date()
  if (type === 'daily') {
    const next = new Date(now)
    next.setDate(next.getDate() + 1)
    next.setHours(0, 0, 0, 0)
    const ms = next - now
    const h = Math.floor(ms / 3600000)
    const m = Math.floor((ms % 3600000) / 60000)
    const s = Math.floor((ms % 60000) / 1000)
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')} 後重置`
  }
  if (type === 'weekly') {
    const day = now.getDay() === 0 ? 7 : now.getDay()
    const daysUntilMon = 8 - day
    const next = new Date(now)
    next.setDate(next.getDate() + daysUntilMon)
    next.setHours(0, 0, 0, 0)
    const ms = next - now
    const d = Math.floor(ms / 86400000)
    const h = Math.floor((ms % 86400000) / 3600000)
    return `${d}天 ${String(h).padStart(2,'0')}h 後重置`
  }
  return null
}

function QuestItem({ quest, type, onClaim, claiming }) {
  const p = pct(quest.progress, quest.target)
  return (
    <div
      className={`quest-item ${quest.claimed ? 'is-claimed' : quest.claimable ? 'is-done' : ''}`}
      data-type={type}
    >
      <div className="quest-item-info">
        <span className="quest-item-title">{quest.title}</span>
        <span className="quest-item-progress-text">
          {fmt(Math.min(quest.progress, quest.target))} / {fmt(quest.target)}
        </span>
      </div>
      <div className="quest-progress-bar">
        <div className="quest-progress-fill" style={{ width: `${p}%` }} />
      </div>
      <div className="quest-item-footer">
        <div className="quest-reward">
          <img src="/chip-blackgold.png" alt="" className="quest-reward-chip" />
          <span>+{fmt(quest.reward)} 籌碼</span>
        </div>
        {quest.claimed ? (
          <span className="quest-claimed-badge">已領取</span>
        ) : (
          <button
            type="button"
            className={`quest-claim-btn ${!quest.claimable ? 'is-disabled' : ''}`}
            disabled={!quest.claimable || claiming}
            onClick={() => quest.claimable && onClaim(quest.id)}
          >
            {claiming ? '…' : quest.claimable ? '領取' : '未完成'}
          </button>
        )}
      </div>
    </div>
  )
}

function AchievementGroup({ group, onClaim, claiming }) {
  const currentTier = group.tiers.find(t => !t.claimed && !t.locked) ?? group.tiers[group.tiers.length - 1]
  const p = currentTier ? pct(group.progress, currentTier.target) : 100

  return (
    <div className="ach-group">
      <div className="ach-group-header">
        <span className="ach-group-title">{group.title}</span>
        <span className="ach-group-progress">{fmt(group.progress)} 次</span>
      </div>
      <div className="quest-progress-bar ach-progress-bar">
        <div className="quest-progress-fill" style={{ width: `${p}%` }} />
      </div>
      <div className="ach-tiers">
        {group.tiers.map((t, i) => (
          <div
            key={t.id}
            className={`ach-tier ${t.claimed ? 'is-claimed' : t.locked ? 'is-locked' : t.claimable ? 'is-claimable' : 'is-current'}`}
          >
            <img
              className="ach-tier-icon"
              src={t.locked ? '/Achievement/lock.png' : (TIER_IMG[i] ?? TIER_IMG[TIER_IMG.length - 1])}
              alt=""
            />
            <span className="ach-tier-target">{fmt(t.target)}</span>
            <span className="ach-tier-reward">+{fmt(t.reward)}</span>
            {t.claimed ? (
              <span className="quest-claimed-badge ach-badge">✓</span>
            ) : t.locked ? (
              <span className="ach-tier-locked-label">鎖定</span>
            ) : (
              <button
                type="button"
                className={`quest-claim-btn ach-claim-btn ${!t.claimable ? 'is-disabled' : ''}`}
                disabled={!t.claimable || claiming === t.id}
                onClick={() => t.claimable && onClaim(t.id)}
              >
                {claiming === t.id ? '…' : t.claimable ? '領取' : `${fmt(Math.min(group.progress, t.target))}/${fmt(t.target)}`}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function QuestPage() {
  const [tab, setTab]         = useState('daily')
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [claiming, setClaiming] = useState(null)
  const [tick, setTick]       = useState(0)
  const isAuth = Boolean(localStorage.getItem(TOKEN_KEY))
  usePageReady(!loading)

  useEffect(() => {
    if (!isAuth) { setLoading(false); return }
    getQuests()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  async function handleClaim(id) {
    setClaiming(id)
    try {
      await claimQuest(id)
      const fresh = await getQuests()
      setData(fresh)
    } catch {}
    finally { setClaiming(null) }
  }

  const resetText = tab === 'daily' ? getResetCountdown('daily')
                  : tab === 'weekly' ? getResetCountdown('weekly')
                  : null

  return (
    <PageShell title="" accent="#ffb58a">
      <VipPageHeader title="任務中心" eyebrow="MISSION CENTER" />

      {/* Tab 切換 */}
      <div className="quest-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            className={`quest-tab-btn ${tab === t.id ? 'is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {resetText && (
        <div className="quest-reset-bar">
          <span className="quest-reset-time">{resetText}</span>
        </div>
      )}

      {!isAuth && (
        <p className="quest-empty">請先登入以查看任務進度</p>
      )}

      {isAuth && loading && (
        <p className="quest-empty">載入中…</p>
      )}

      {isAuth && !loading && data && (
        <>
          {tab === 'daily' && (
            <div className="quest-list">
              {data.daily.length === 0
                ? <p className="quest-empty">目前沒有每日任務</p>
                : data.daily.map(q => (
                    <QuestItem key={q.id} quest={q} type="daily" onClaim={handleClaim} claiming={claiming === q.id} />
                  ))
              }
            </div>
          )}

          {tab === 'weekly' && (
            <div className="quest-list">
              {data.weekly.length === 0
                ? <p className="quest-empty">目前沒有週常任務</p>
                : data.weekly.map(q => (
                    <QuestItem key={q.id} quest={q} type="weekly" onClaim={handleClaim} claiming={claiming === q.id} />
                  ))
              }
            </div>
          )}

          {tab === 'achievement' && (
            <div className="quest-list">
              {data.achievements.length === 0
                ? <p className="quest-empty">目前沒有成就</p>
                : data.achievements.map(g => (
                    <AchievementGroup key={g.action_type} group={g} onClaim={handleClaim} claiming={claiming} />
                  ))
              }
            </div>
          )}
        </>
      )}
    </PageShell>
  )
}

export default QuestPage
