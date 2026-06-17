import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePageReady } from '../hooks/usePageReady'

function toDateStr(d) {
  return d.toISOString().slice(0, 10)
}
const TODAY = toDateStr(new Date())
const ONE_MONTH_AGO = toDateStr(new Date(new Date().setMonth(new Date().getMonth() - 1)))
import PageShell from '../components/PageShell'
import VipPageHeader from '../components/VipPageHeader'
import { getGames } from '../services/gamesApi'
import { getLedger } from '../services/ledgerApi'

const TOKEN_KEY = 'texas_holdem_auth_token'
const PAGE_SIZE = 10

const TYPE_LABEL = {
  buy_in:       '進場',
  cash_out:     '出場',
  hand_win:     '贏牌',
  hand_loss:    '輸牌',
  win:          '贏分',
  loss:         '扣分',
  checkin:      '簽到',
  quest_reward: '任務獎勵',
  deposit:      '儲值',
  bet_void:     '退注',
}

const GAME_LABEL = {
  'texas-holdem': '德州撲克',
  'big-two':      '大老二',
  'dragon-tiger': '龍虎鬥',
  'blackjack':    '21點',
}

const SUIT_RED  = new Set(['♥', '♦'])

// Blackjack card helpers
const BJ_SUIT_SYM = { h: '♥', d: '♦', c: '♣', s: '♠' }
const BJ_SUIT_RED = new Set(['h', 'd'])
const BJ_RESULT_LABEL = { win: '勝', lose: '負', push: '平', blackjack: 'BJ', fivecard: '5張', bust: '爆' }
function bjCard(c) {
  const rank = c.slice(0, -1)
  const suit = c.slice(-1)
  return (rank === 'T' ? '10' : rank) + (BJ_SUIT_SYM[suit] ?? suit)
}
function bjRed(c) { return BJ_SUIT_RED.has(c.slice(-1)) }
const DT_RESULT = { dragon: '龍勝', tiger: '虎勝', tie: '和局' }
const DT_BET_LABEL = {
  dragon: '龍', tiger: '虎', tie: '和',
  dragon_big: '龍大', dragon_small: '龍小', dragon_odd: '龍單', dragon_even: '龍雙',
  dragon_spade: '龍♠', dragon_heart: '龍♥', dragon_club: '龍♣', dragon_diamond: '龍♦',
  tiger_big: '虎大', tiger_small: '虎小', tiger_odd: '虎單', tiger_even: '虎雙',
  tiger_spade: '虎♠', tiger_heart: '虎♥', tiger_club: '虎♣', tiger_diamond: '虎♦',
}

const DATE_CHIPS = [
  { label: '今天',  value: 'today'      },
  { label: '本週',  value: 'week'       },
  { label: '上週',  value: 'last-week'  },
  { label: '本月',  value: 'month'      },
  { label: '上月',  value: 'last-month' },
  { label: '全部',  value: 'all'        },
]

function getPresetRange(value) {
  const now = new Date()
  if (value === 'today') {
    return {
      dateFrom: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(),
      dateTo: null,
    }
  }
  if (value === 'week') {
    const off = now.getDay() === 0 ? 6 : now.getDay() - 1
    return {
      dateFrom: new Date(now.getFullYear(), now.getMonth(), now.getDate() - off).toISOString(),
      dateTo: null,
    }
  }
  if (value === 'last-week') {
    const off = now.getDay() === 0 ? 6 : now.getDay() - 1
    const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - off)
    const lastMonday = new Date(thisMonday.getTime() - 7 * 86400_000)
    return {
      dateFrom: lastMonday.toISOString(),
      dateTo:   thisMonday.toISOString(),
    }
  }
  if (value === 'month') {
    return {
      dateFrom: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
      dateTo: null,
    }
  }
  if (value === 'last-month') {
    return {
      dateFrom: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString(),
      dateTo:   new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
    }
  }
  return { dateFrom: null, dateTo: null }
}

function fmt(n) {
  return new Intl.NumberFormat('en-US').format(Math.abs(n))
}

function fmtDate(iso) {
  if (!iso) return '年/月/日'
  return iso.replace(/-/g, '/')
}

function entryNote(e) {
  const game = e.game ? (GAME_LABEL[e.game] ?? e.game) : null
  if (e.type === 'buy_in')   return `帶入 ${fmt(Math.abs(e.amount))} 籌碼${game ? `・${game}` : ''}`
  if (e.type === 'cash_out') return `帶出 ${fmt(e.amount)} 籌碼${game ? `・${game}` : ''}`
  if ((e.type === 'hand_win' || e.type === 'hand_loss') && e.bet > 0)
    return `投注 ${fmt(e.bet)}`
  if (e.type === 'checkin')      return `每日簽到獎勵 +${fmt(e.amount)} 籌碼`
  if (e.type === 'quest_reward') return `任務獎勵 +${fmt(e.amount)} 籌碼`
  return null
}

function dateFmt(iso) {
  return new Date(iso).toLocaleString('zh-TW', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
}

function LedgerPage() {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''

  const [dateChip,   setDateChip]   = useState('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo,   setCustomTo]   = useState('')
  const [gameFilter, setGameFilter] = useState('all')
  const [gameOptions, setGameOptions] = useState([])

  const [entries,      setEntries]      = useState([])
  const [net,          setNet]          = useState(null)
  const [total,        setTotal]        = useState(null)
  const [totalBuyIn,   setTotalBuyIn]   = useState(null)
  const [totalCashOut, setTotalCashOut] = useState(null)
  const [offset,      setOffset]      = useState(0)
  const [hasMore,     setHasMore]     = useState(true)
  const [loading,     setLoading]     = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  usePageReady(!loading)
  const [error,       setError]       = useState(null)

  const sentinelRef  = useRef(null)
  const dateFromRef  = useRef(null)
  const dateToRef    = useRef(null)

  useEffect(() => {
    getGames()
      .then(data => setGameOptions((data.games ?? []).filter(g => g.route)))
      .catch(() => {})
  }, [])

  const effectiveRange = useMemo(() => {
    if (customFrom || customTo) {
      return {
        dateFrom: customFrom ? new Date(customFrom).toISOString() : null,
        dateTo: customTo
          ? new Date(new Date(customTo).getTime() + 86400_000).toISOString()
          : null,
      }
    }
    return getPresetRange(dateChip)
  }, [dateChip, customFrom, customTo])

  // Reset + initial fetch whenever filters change
  useEffect(() => {
    if (!token) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    setEntries([])
    setOffset(0)
    setHasMore(true)
    setNet(null)
    setTotal(null)
    setTotalBuyIn(null)
    setTotalCashOut(null)

    getLedger(token, {
      limit: PAGE_SIZE,
      offset: 0,
      game:     gameFilter !== 'all' ? gameFilter : undefined,
      dateFrom: effectiveRange.dateFrom ?? undefined,
      dateTo:   effectiveRange.dateTo   ?? undefined,
    })
      .then(data => {
        if (cancelled) return
        const rows = data.entries ?? []
        setEntries(rows)
        setNet(data.net ?? 0)
        setTotal(data.total ?? 0)
        setTotalBuyIn(data.totalBuyIn ?? 0)
        setTotalCashOut(data.totalCashOut ?? 0)
        setOffset(rows.length)
        setHasMore(rows.length === PAGE_SIZE)
      })
      .catch(() => { if (!cancelled) setError('載入失敗，請稍後再試') })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [token, gameFilter, effectiveRange])

  // Load next page
  const loadMore = useCallback(() => {
    if (!token || !hasMore || loading || loadingMore) return
    let cancelled = false
    setLoadingMore(true)

    getLedger(token, {
      limit: PAGE_SIZE,
      offset,
      game:     gameFilter !== 'all' ? gameFilter : undefined,
      dateFrom: effectiveRange.dateFrom ?? undefined,
      dateTo:   effectiveRange.dateTo   ?? undefined,
    })
      .then(data => {
        if (cancelled) return
        const rows = data.entries ?? []
        setEntries(prev => [...prev, ...rows])
        setOffset(prev => prev + rows.length)
        setHasMore(rows.length === PAGE_SIZE)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingMore(false) })

    return () => { cancelled = true }
  }, [token, hasMore, loading, loadingMore, offset, gameFilter, effectiveRange])

  // Infinite scroll: watch sentinel
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMore() },
      { rootMargin: '120px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadMore])

  const hasCustom = Boolean(customFrom || customTo)

  function selectChip(val) {
    setDateChip(val)
    setCustomFrom('')
    setCustomTo('')
  }

  function clearCustom() {
    setCustomFrom('')
    setCustomTo('')
  }

  return (
    <PageShell title="" accent="#66dd88">
      <VipPageHeader title="帳務明細" eyebrow="LEDGER" />

      {/* ── 日期快選 ── */}
      <div className="ledger-filters">
        <div className="ledger-filter-row-data">
          {DATE_CHIPS.map(o => (
            <button
              key={o.value}
              type="button"
              className={`ledger-chip ${!hasCustom && dateChip === o.value ? 'is-active' : ''}`}
              onClick={() => selectChip(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>

        {/* ── 自訂日期範圍 ── */}
        <div className="ledger-daterange-row">
          <div className="ledger-daterange-field">
            <span className="ledger-daterange-label">從</span>
            <span className={`ledger-date-value${!customFrom ? ' is-empty' : ''}`}>
              {fmtDate(customFrom)}
            </span>
            <input
              ref={dateFromRef}
              type="date"
              className="ledger-dateinput"
              value={customFrom}
              min={ONE_MONTH_AGO}
              max={TODAY}
              onChange={e => setCustomFrom(e.target.value)}
            />
          </div>
          <span className="ledger-daterange-sep">—</span>
          <div className="ledger-daterange-field">
            <span className="ledger-daterange-label">至</span>
            <span className={`ledger-date-value${!customTo ? ' is-empty' : ''}`}>
              {fmtDate(customTo)}
            </span>
            <input
              ref={dateToRef}
              type="date"
              className="ledger-dateinput"
              value={customTo}
              min={ONE_MONTH_AGO}
              max={TODAY}
              onChange={e => setCustomTo(e.target.value)}
            />
          </div>
          {hasCustom && (
            <button type="button" className="ledger-dateclear" onClick={clearCustom}>
              ✕
            </button>
          )}
        </div>

        {/* ── 遊戲種類 ── */}
        {gameOptions.length > 0 && (
          <>
            <div className="ledger-filter-divider">遊戲種類</div>
            <div className="ledger-filter-row">
              <button
                type="button"
                className={`ledger-chip ${gameFilter === 'all' ? 'is-active' : ''}`}
                onClick={() => setGameFilter('all')}
              >
                全部
              </button>
              {gameOptions.map(g => (
                <button
                  key={g.slug}
                  type="button"
                  className={`ledger-chip ${gameFilter === g.slug ? 'is-active' : ''}`}
                  onClick={() => setGameFilter(g.slug)}
                >
                  {g.name}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── 損益摘要 ── */}
      {!loading && !error && net !== null && (
        <div className="ledger-page-summary">
          <img src="/ledger-icon.png" className="ledger-summary-icon" alt="" />
          <div className="ledger-summary-right">
            {/* 累計損益 區 */}
            <div className="ledger-summary-net-block">
              <div className="ledger-summary-net-header">
                <span className="ledger-page-summary-label">累計損益</span>
                <span className="ledger-page-summary-count">{total} 筆</span>
              </div>
              <span className={`ledger-page-summary-net ${net >= 0 ? 'is-positive' : 'is-negative'}`}>
                {net >= 0 ? '+' : '-'}{fmt(net)}
              </span>
            </div>
            {/* 帶入 / 帶出 區 */}
            {(totalBuyIn > 0 || totalCashOut > 0) && (
              <div className="ledger-summary-buycash">
                {totalBuyIn > 0 && (
                  <span className="ledger-summary-buycash-item">
                    <span className="ledger-summary-buycash-label">帶入</span>
                    <span className="ledger-summary-buycash-val is-negative">-{fmt(totalBuyIn)}</span>
                  </span>
                )}
                {totalBuyIn > 0 && totalCashOut > 0 && (
                  <span className="ledger-summary-divider" aria-hidden="true" />
                )}
                {totalCashOut > 0 && (
                  <span className="ledger-summary-buycash-item">
                    <span className="ledger-summary-buycash-label">帶出</span>
                    <span className="ledger-summary-buycash-val is-positive">+{fmt(totalCashOut)}</span>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 列表 ── */}
      {loading && (
        <div className="ledger-page-loading">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="ledger-skeleton" />
          ))}
        </div>
      )}

      {error && <p className="ledger-page-error">{error}</p>}

      {!loading && !error && (
        entries.length === 0 ? (
          <p className="ledger-empty">此條件下無交易記錄</p>
        ) : (
          <>
            <div className="ledger-page-list">
              {entries.map(e => {
                const positive = e.amount > 0
                const note = entryNote(e)
                return (
                  <div key={e.id} className={`ledger-page-row ledger-page-row-${e.type}`}>
                    <span className={`ledger-type ledger-type-${e.type}`}>
                      {TYPE_LABEL[e.type] ?? e.type}
                    </span>
                    <div className="ledger-page-row-mid">
                      {e.room_id && <span className="ledger-room">#{e.room_id}</span>}
                      <span className="ledger-time">{dateFmt(e.created_at)}</span>
                      {note && <span className="ledger-note">{note}</span>}
                      {e.detail && e.game === 'blackjack' && (() => {
                        const d = e.detail
                        return (
                          <div className="ledger-bj-detail">
                            <span className="ledger-bj-row">
                              <span className="ledger-bj-side">莊</span>
                              {(d.dealerCards ?? []).map((c, i) => (
                                <span key={i} style={{ color: bjRed(c) ? '#e05050' : '#e8e0cc' }}>{bjCard(c)}</span>
                              ))}
                              <span className="ledger-bj-score">({d.dealerScore})</span>
                            </span>
                            {(d.hands ?? []).map((h, i) => (
                              <span key={i} className="ledger-bj-row">
                                <span className="ledger-bj-side">{d.hands.length > 1 ? `手${i + 1}` : '自'}</span>
                                {(h.cards ?? []).map((c, j) => (
                                  <span key={j} style={{ color: bjRed(c) ? '#e05050' : '#e8e0cc' }}>{bjCard(c)}</span>
                                ))}
                                <span className="ledger-bj-score">({h.score})</span>
                                <span className={`ledger-bj-result ledger-bj-${h.result}`}>
                                  {BJ_RESULT_LABEL[h.result] ?? h.result}
                                </span>
                              </span>
                            ))}
                          </div>
                        )
                      })()}
                      {e.detail && e.game === 'dragon-tiger' && (() => {
                        const d = e.detail
                        const dc = d.dragonCard, tc = d.tigerCard
                        return (
                          <div className="ledger-dt-detail">
                            <span className="ledger-dt-result">{DT_RESULT[d.result] ?? d.result}</span>
                            <span className="ledger-dt-cards">
                              龍<span style={{ color: SUIT_RED.has(dc?.suit) ? '#e05050' : '#e8e0cc' }}>
                                {dc ? `${dc.rank}${dc.suit}` : '—'}
                              </span>
                              {' vs '}
                              虎<span style={{ color: SUIT_RED.has(tc?.suit) ? '#e05050' : '#e8e0cc' }}>
                                {tc ? `${tc.rank}${tc.suit}` : '—'}
                              </span>
                            </span>
                            {d.bets && Object.keys(d.bets).length > 0 && (
                              <span className="ledger-dt-bets">
                                {Object.entries(d.bets).map(([z, amt]) =>
                                  `${DT_BET_LABEL[z] ?? z} ${fmt(amt)}`
                                ).join('・')}
                              </span>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                    <span className={`ledger-amount ${e.amount === 0 ? '' : positive ? 'is-positive' : 'is-negative'}`}>
                      {e.amount === 0 ? '0' : `${positive ? '+' : '-'}${fmt(e.amount)}`}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Infinite scroll sentinel */}
            <div ref={sentinelRef} className="ledger-sentinel">
              {loadingMore && <div className="ledger-load-more-spinner" />}
              {!hasMore && !loadingMore && (
                <p className="ledger-end-hint">已顯示全部 {total} 筆</p>
              )}
            </div>
          </>
        )
      )}
    </PageShell>
  )
}

export default LedgerPage
