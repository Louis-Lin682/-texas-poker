import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import PageShell from '../components/PageShell'
import VipPageHeader from '../components/VipPageHeader'
import { getLotteryGames, getCurrentDraw, getResults, getMyBets, placeBet } from '../services/lotteryApi'

const SLUG_BY_ROUTE = { '/lottery/539': 'lotto539', '/lottery/649': 'lotto649', '/lottery/638': 'lotto638' }

function fmt(n) { return Number(n).toLocaleString('en-US') }

function BallGrid({ count, selected, onToggle, label }) {
  return (
    <div className="lottery-ball-grid">
      {Array.from({ length: count }, (_, i) => i + 1).map(n => (
        <button
          key={n}
          type="button"
          className={`lottery-ball ${selected.includes(n) ? 'is-picked' : ''}`}
          onClick={() => onToggle(n)}
        >
          {String(n).padStart(2, '0')}
        </button>
      ))}
    </div>
  )
}

function DrawResult({ result, game }) {
  return (
    <div className="lottery-result-row">
      <span className="lottery-result-date">{result.drawDate?.slice(0, 10)}</span>
      <div className="lottery-result-balls">
        {result.numbers?.map(n => (
          <span key={n} className="lottery-result-ball">{String(n).padStart(2, '0')}</span>
        ))}
        {result.bonusNumber && (
          <span className="lottery-result-ball is-bonus">{String(result.bonusNumber).padStart(2, '0')}</span>
        )}
        {result.extraNumber && (
          <span className="lottery-result-ball is-extra">{String(result.extraNumber).padStart(2, '0')}</span>
        )}
      </div>
    </div>
  )
}

function MyBetRow({ bet }) {
  const statusLabel = { pending: '待開獎', won: '中獎', lost: '未中' }[bet.status] ?? bet.status
  const statusCls   = { pending: '', won: 'is-won', lost: 'is-lost' }[bet.status] ?? ''
  return (
    <div className={`lottery-bet-row ${statusCls}`}>
      <div className="lottery-bet-meta">
        <span className="lottery-bet-date">{bet.placed_at?.slice(0, 10)}</span>
        <span className="lottery-bet-status">{statusLabel}</span>
        {bet.prize > 0 && <span className="lottery-bet-prize">+{fmt(bet.prize)}</span>}
      </div>
      <div className="lottery-bet-numbers">
        {bet.numbers?.map(n => (
          <span key={n} className={`lottery-bet-ball ${bet.draw_numbers?.includes(n) ? 'is-match' : ''}`}>
            {String(n).padStart(2, '0')}
          </span>
        ))}
        {bet.extra_number && (
          <span className={`lottery-bet-ball is-extra ${bet.draw_extra === bet.extra_number ? 'is-match' : ''}`}>
            {String(bet.extra_number).padStart(2, '0')}
          </span>
        )}
      </div>
    </div>
  )
}

export default function LotteryPage({ auth, routeSlug }) {
  const navigate = useNavigate()
  const [games,    setGames]    = useState([])
  const [slug,     setSlug]     = useState(routeSlug ?? 'lotto539')
  const [draw,     setDraw]     = useState(null)
  const [results,  setResults]  = useState([])
  const [myBets,   setMyBets]   = useState([])
  const [picked,   setPicked]   = useState([])
  const [extra,    setExtra]    = useState(null)
  const [tab,      setTab]      = useState('bet')  // bet | results | mybets
  const [loading,  setLoading]  = useState(false)
  const [msg,      setMsg]      = useState(null)    // { ok, text }

  const game = games.find(g => g.slug === slug)

  const loadDraw = useCallback(async (s) => {
    try {
      const data = await getCurrentDraw(s)
      setDraw(data.draw)
    } catch { setDraw(null) }
  }, [])

  const loadResults = useCallback(async (s) => {
    try {
      const data = await getResults(s, 10)
      setResults(data.results ?? [])
    } catch { setResults([]) }
  }, [])

  const loadMyBets = useCallback(async () => {
    if (!auth?.token) return
    try {
      const data = await getMyBets()
      setMyBets(data.bets ?? [])
    } catch { setMyBets([]) }
  }, [auth?.token])

  useEffect(() => {
    getLotteryGames().then(d => setGames(d.games ?? [])).catch(() => {})
  }, [])

  useEffect(() => {
    setPicked([]); setExtra(null); setMsg(null)
    loadDraw(slug)
    loadResults(slug)
  }, [slug, loadDraw, loadResults])

  useEffect(() => {
    if (tab === 'mybets') loadMyBets()
  }, [tab, loadMyBets])

  function togglePick(n) {
    if (!game) return
    setPicked(prev => {
      if (prev.includes(n)) return prev.filter(x => x !== n)
      if (prev.length >= game.pickCount) return prev
      return [...prev, n]
    })
  }

  function randomPick() {
    if (!game) return
    const pool = Array.from({ length: game.poolSize }, (_, i) => i + 1)
    const shuffled = pool.sort(() => Math.random() - 0.5)
    setPicked(shuffled.slice(0, game.pickCount).sort((a, b) => a - b))
    if (game.hasExtra) setExtra(Math.ceil(Math.random() * game.extraPoolSize))
  }

  async function handleBet() {
    if (!game) return
    if (picked.length !== game.pickCount) {
      setMsg({ ok: false, text: `請選 ${game.pickCount} 個號碼` }); return
    }
    if (game.hasExtra && !extra) {
      setMsg({ ok: false, text: `請選第二區號碼 (1-${game.extraPoolSize})` }); return
    }
    if (!auth?.token) { setMsg({ ok: false, text: '請先登入' }); return }
    if (!draw) { setMsg({ ok: false, text: '目前沒有開放投注' }); return }

    setLoading(true); setMsg(null)
    try {
      await placeBet({ slug, numbers: picked, extraNumber: extra })
      setMsg({ ok: true, text: '投注成功！' })
      setPicked([]); setExtra(null)
      auth?.refreshUser?.()
      loadMyBets()
    } catch (e) {
      setMsg({ ok: false, text: e?.message ?? '投注失敗' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <PageShell title="" accent="#e8a020">
      <VipPageHeader title="樂透彩" eyebrow="LOTTERY" />

      {/* Game tabs */}
      <div className="lottery-game-tabs">
        {[
          { slug: 'lotto539', label: '今彩539' },
          { slug: 'lotto649', label: '大樂透' },
          { slug: 'lotto638', label: '威力彩' },
        ].map(g => (
          <button
            key={g.slug}
            className={`lottery-game-tab ${slug === g.slug ? 'is-active' : ''}`}
            onClick={() => setSlug(g.slug)}
          >
            {g.label}
          </button>
        ))}
      </div>

      {/* Draw info */}
      {draw ? (
        <div className="lottery-draw-info">
          <span className="lottery-draw-date">{draw.draw_date}</span>
          <span className="lottery-draw-pool">
            獎池 <strong>{fmt(Math.round(draw.prize_pool))}</strong> 籌碼
          </span>
        </div>
      ) : (
        <div className="lottery-draw-info lottery-no-draw">今日無開放投注</div>
      )}

      {/* Sub-tabs */}
      <div className="lottery-sub-tabs">
        {[['bet','選號投注'],['results','開獎紀錄'],['mybets','我的投注']].map(([t, l]) => (
          <button key={t} className={`lottery-sub-tab ${tab === t ? 'is-active' : ''}`} onClick={() => setTab(t)}>{l}</button>
        ))}
      </div>

      {/* === BET TAB === */}
      {tab === 'bet' && game && (
        <div className="lottery-bet-panel">
          <div className="lottery-pick-header">
            <span>選 {game.pickCount} 個號碼（1–{game.poolSize}）</span>
            <button className="lottery-quick-pick" onClick={randomPick}>隨機</button>
          </div>

          <BallGrid count={game.poolSize} selected={picked} onToggle={togglePick} />

          {game.hasExtra && (
            <>
              <div className="lottery-pick-header" style={{ marginTop: 12 }}>
                <span>第二區（1–{game.extraPoolSize}）</span>
              </div>
              <div className="lottery-ball-grid lottery-extra-grid">
                {Array.from({ length: game.extraPoolSize }, (_, i) => i + 1).map(n => (
                  <button
                    key={n}
                    className={`lottery-ball is-extra ${extra === n ? 'is-picked' : ''}`}
                    onClick={() => setExtra(n)}
                  >
                    {String(n).padStart(2, '0')}
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="lottery-picked-preview">
            {picked.map(n => <span key={n} className="lottery-preview-ball">{String(n).padStart(2, '0')}</span>)}
            {extra && <span className="lottery-preview-ball is-extra">{String(extra).padStart(2, '0')}</span>}
          </div>

          {msg && <div className={`lottery-msg ${msg.ok ? 'is-ok' : 'is-err'}`}>{msg.text}</div>}

          <button
            className="lottery-bet-btn"
            disabled={loading || !draw}
            onClick={handleBet}
          >
            {loading ? '投注中…' : `投注 ${game.betAmount} 籌碼`}
          </button>

          {/* Prize tier table */}
          <div className="lottery-tier-table">
            <div className="lottery-tier-header">獎級結構（每期彩金池分配）</div>
            {game.tiers?.map(t => (
              <div key={t.tier} className="lottery-tier-row">
                <span className="lottery-tier-name">{t.name}</span>
                <span className="lottery-tier-cond">
                  {t.matchMain} 個號碼{t.matchBonus ? '＋特別號' : ''}{t.matchExtra ? '＋第二區' : ''}
                </span>
                <span className="lottery-tier-share">{(t.poolShare * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* === RESULTS TAB === */}
      {tab === 'results' && (
        <div className="lottery-results-panel">
          {results.length === 0
            ? <div className="lottery-empty">尚無開獎紀錄</div>
            : results.map(r => <DrawResult key={r.id} result={r} game={game} />)
          }
        </div>
      )}

      {/* === MY BETS TAB === */}
      {tab === 'mybets' && (
        <div className="lottery-mybets-panel">
          {!auth?.token
            ? <div className="lottery-empty">請先登入</div>
            : myBets.filter(b => b.game_slug === slug).length === 0
              ? <div className="lottery-empty">尚無投注紀錄</div>
              : myBets.filter(b => b.game_slug === slug).map(b => <MyBetRow key={b.id} bet={b} />)
          }
        </div>
      )}
    </PageShell>
  )
}
