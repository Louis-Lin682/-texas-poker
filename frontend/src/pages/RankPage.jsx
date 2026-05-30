import { useEffect, useState } from 'react'
import PageShell from '../components/PageShell'
import VipPageHeader from '../components/VipPageHeader'
import { useAuth } from '../hooks/useAuth'
import { getRank } from '../services/gamesApi'
import { usePageReady } from '../hooks/usePageReady'

const MEDAL = {
  1: { color: '#f0c96b', glow: 'rgba(240,201,107,0.75)', label: 'gold'   },
  2: { color: '#a8c8e8', glow: 'rgba(100,170,230,0.68)', label: 'silver' },
  3: { color: '#e8a060', glow: 'rgba(220,140,60,0.68)',  label: 'bronze' },
}

function fmt(n) {
  return Number(n).toLocaleString('en-US')
}

function CountUp({ target, duration = 860 }) {
  const [display, setDisplay] = useState(0)
  useEffect(() => {
    const n = Number(target)
    if (!n) { setDisplay(0); return }
    let rafId
    const start = Date.now()
    const tick = () => {
      const p = Math.min((Date.now() - start) / duration, 1)
      const eased = 1 - (1 - p) ** 3
      setDisplay(Math.round(n * eased))
      if (p < 1) rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [target, duration])
  return fmt(display)
}

function PodiumAvatar({ name, rank }) {
  const { color, glow } = MEDAL[rank]
  return (
    <div className={`rk-avatar rk-avatar-${rank}`} style={{ '--av-color': color, '--av-glow': glow }}>
      {String(name)[0].toUpperCase()}
    </div>
  )
}

function RankPage() {
  const auth = useAuth()
  const [tab, setTab] = useState('weekly')
  const [list, setList] = useState([])
  const [myRank, setMyRank] = useState(null)
  const [loading, setLoading] = useState(true)
  usePageReady(!loading)

  useEffect(() => {
    setLoading(true)
    getRank(tab, auth.token)
      .then(res => {
        setList(res.list ?? [])
        setMyRank(res.myRank ?? null)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [tab, auth.token])

  const [first, second, third, ...rest] = list
  const hasPodium = list.length >= 3

  return (
    <PageShell title="" accent="#f0c96b" bodyClassName="rk-body">
      <VipPageHeader title="排行榜" eyebrow="LEADERBOARD" />

      {/* ── 固定：tabs + 頒獎台 ── */}
      <div className="rk-static">
        <div className="rk-tabs">
          <button
            type="button"
            className={`rk-tab ${tab === 'weekly' ? 'is-active' : ''}`}
            onClick={() => setTab('weekly')}
          >
            週排行
          </button>
          <button
            type="button"
            className={`rk-tab ${tab === 'monthly' ? 'is-active' : ''}`}
            onClick={() => setTab('monthly')}
          >
            月排行
          </button>
        </div>

        {!loading && hasPodium && (
          <div className="rk-podium">
            {/* 2nd */}
            <div className="rk-ps rk-ps-2">
              <PodiumAvatar name={second.username} rank={2} />
              <span className="rk-ps-name">{second.username}</span>
              <span className="rk-ps-chips"><CountUp target={second.score} /></span>
              <div className="rk-stand rk-stand-2">2</div>
            </div>

            {/* 1st */}
            <div className="rk-ps rk-ps-1">
              <div className="rk-crown-wrap">
                <img className="rk-crown-img" src="/crown.png" alt="" />
              </div>
              <PodiumAvatar name={first.username} rank={1} />
              <span className="rk-ps-name rk-ps-name-1">{first.username}</span>
              <span className="rk-ps-chips"><CountUp target={first.score} /></span>
              <div className="rk-stand rk-stand-1">1</div>
            </div>

            {/* 3rd */}
            <div className="rk-ps rk-ps-3">
              <PodiumAvatar name={third.username} rank={3} />
              <span className="rk-ps-name">{third.username}</span>
              <span className="rk-ps-chips"><CountUp target={third.score} /></span>
              <div className="rk-stand rk-stand-3">3</div>
            </div>
          </div>
        )}
      </div>

      {/* ── 可滑動：第 4 名起 ── */}
      <div className="rk-list">
        {loading ? (
          <div className="rk-loading">載入中…</div>
        ) : list.length === 0 ? (
          <div className="rk-loading">暫無排行資料</div>
        ) : (
          (hasPodium ? rest : list).map((entry, i) => {
            const rank = hasPodium ? i + 4 : i + 1
            return (
              <div key={entry.username} className="rk-row">
                <span className="rk-row-num">{rank}</span>
                <div className="rk-row-avatar">{String(entry.username)[0].toUpperCase()}</div>
                <span className="rk-row-name">{entry.username}</span>
                <span className="rk-row-score"><CountUp target={entry.score} duration={700} /></span>
              </div>
            )
          })
        )}
      </div>

      {/* ── 固定底部 ── */}
      <div className="rk-footer">
        {myRank && (
          <div className="rk-self">
            <span className="rk-self-label">我的排名</span>
            <span className="rk-self-pos"># {myRank.rank}</span>
            <span className="rk-self-chips"><CountUp target={myRank.score} /> 籌碼</span>
          </div>
        )}
        <p className="rk-note">
          {tab === 'weekly' ? '統計近 7 天遊戲淨收益，每日更新' : '統計近 30 天遊戲淨收益，每日更新'}
        </p>
      </div>

    </PageShell>
  )
}

export default RankPage
