import { useState } from 'react'
import PageShell from '../components/PageShell'
import VipPageHeader from '../components/VipPageHeader'
import { postDeposit } from '../services/depositApi'

const PRESETS = [1000, 3000, 5000, 10000, 30000, 50000]

function fmt(n) {
  return Number(n).toLocaleString('en-US')
}

function DepositPage({ auth }) {
  const [selected, setSelected] = useState(null)
  const [custom, setCustom] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null) // { amount, balance }
  const [error, setError] = useState('')

  const amount = selected ?? (custom ? Number(custom) : null)

  async function handleConfirm() {
    if (!amount || amount < 1) { setError('請選擇或輸入金額'); return }
    setError('')
    setLoading(true)
    try {
      const data = await postDeposit(amount)
      setResult({ amount: data.amount, bonus: data.bonus ?? 0, balance: data.balance })
      auth?.refreshUser?.()
    } catch (e) {
      setError(e?.message || '儲值失敗，請稍後再試')
    } finally {
      setLoading(false)
    }
  }

  function handleReset() {
    setResult(null)
    setSelected(null)
    setCustom('')
    setError('')
  }

  return (
    <PageShell title="" accent="#e2ce87">
      <VipPageHeader title="儲值中心" eyebrow="DEPOSIT" />
      <div className="deposit-page">

        {/* Current balance */}
        <div className="deposit-balance-card">
          <span className="deposit-balance-label">當前餘額</span>
          <span className="deposit-balance-value">
            <img src="/chip-blackgold.png" alt="" className="deposit-chip-icon" />
            {fmt(auth?.user?.balance ?? 0)}
          </span>
        </div>

        {result ? (
          /* ── Success state ── */
          <div className="deposit-success">
            <div className="deposit-success-icon">✓</div>
            <div className="deposit-success-title">儲值成功</div>
            <div className="deposit-success-amount">+{fmt(result.amount)} 籌碼</div>
            {result.bonus > 0 && (
              <div className="deposit-success-bonus">
                🎁 首儲回饋 +{fmt(result.bonus)} 籌碼
              </div>
            )}
            <div className="deposit-success-balance">
              餘額已更新為 <strong>{fmt(result.balance)}</strong>
            </div>
            <button type="button" className="deposit-confirm-btn" onClick={handleReset}>
              繼續儲值
            </button>
          </div>
        ) : (
          <>
            {/* Preset amounts */}
            <div className="deposit-section-label">選擇金額</div>
            <div className="deposit-presets">
              {PRESETS.map(p => (
                <button
                  key={p}
                  type="button"
                  className={`deposit-preset${selected === p ? ' deposit-preset--active' : ''}`}
                  onClick={() => { setSelected(p); setCustom('') }}
                >
                  {fmt(p)}
                </button>
              ))}
            </div>

            {/* Custom amount */}
            <div className="deposit-section-label">自訂金額</div>
            <div className="deposit-custom-wrap">
              <input
                type="number"
                className="deposit-custom-input"
                placeholder="輸入金額"
                min={1}
                max={1000000}
                value={custom}
                onChange={e => { setCustom(e.target.value); setSelected(null) }}
              />
            </div>

            {error && <div className="deposit-error">{error}</div>}

            <div className="deposit-note">模擬儲值 · 確認後籌碼立即到帳</div>

            <button
              type="button"
              className="deposit-confirm-btn"
              disabled={!amount || loading}
              onClick={handleConfirm}
            >
              {loading ? '處理中…' : amount ? `確認儲值 ${fmt(amount)} 籌碼` : '請選擇金額'}
            </button>
          </>
        )}
      </div>
    </PageShell>
  )
}

export default DepositPage
