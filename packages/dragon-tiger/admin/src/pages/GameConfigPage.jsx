import { useEffect, useState } from 'react'
import { api } from '../services/api.js'

const FIELDS = [
  { key: 'payout.dragon',     label: '龍 賠率 (1:N)',    type: 'number', step: 0.1 },
  { key: 'payout.tiger',      label: '虎 賠率 (1:N)',    type: 'number', step: 0.1 },
  { key: 'payout.tie',        label: '和 賠率 (1:N)',    type: 'number', step: 1   },
  { key: 'payout.tie_refund', label: '和局退還比例',      type: 'number', step: 0.05, hint: '0.5 = 退半' },
  { key: 'payout.big',        label: '大 賠率 (1:N)',    type: 'number', step: 0.1 },
  { key: 'payout.small',      label: '小 賠率 (1:N)',    type: 'number', step: 0.1 },
  { key: 'payout.odd',        label: '單 賠率 (1:N)',    type: 'number', step: 0.1 },
  { key: 'payout.even',       label: '雙 賠率 (1:N)',    type: 'number', step: 0.1 },
  { key: 'payout.suit',       label: '花色 賠率 (1:N)',  type: 'number', step: 0.5 },
  { key: 'seven_rule',        label: '7 規則',           type: 'select', options: [
    { value: 'push', label: 'push — 退還邊注' },
    { value: 'lose', label: 'lose — 莊家吃注' },
  ]},
  { key: 'min_bet',           label: '最低下注',         type: 'number', step: 1   },
  { key: 'max_bet',           label: '最高下注',         type: 'number', step: 100 },
  { key: 'bet_time_ms',       label: '下注時間 (毫秒)',   type: 'number', step: 1000 },
]

export default function GameConfigPage() {
  const [config,   setConfig]   = useState({})
  const [form,     setForm]     = useState({})
  const [note,     setNote]     = useState('')
  const [history,  setHistory]  = useState([])
  const [status,   setStatus]   = useState(null)   // null | 'saving' | 'ok' | string(error)
  const [showHist, setShowHist] = useState(false)

  useEffect(() => {
    api.getConfig().then(d => { setConfig(d.config); setForm(d.config) })
    api.getConfigHistory().then(d => setHistory(d.history))
  }, [])

  function handleChange(key, val) {
    setForm(f => ({ ...f, [key]: val }))
  }

  async function handleSave(e) {
    e.preventDefault()
    setStatus('saving')
    try {
      const parsed = {}
      for (const f of FIELDS) {
        parsed[f.key] = f.type === 'number' ? Number(form[f.key]) : form[f.key]
      }
      const { config: newCfg } = await api.putConfig({ config: parsed, note })
      setConfig(newCfg)
      setForm(newCfg)
      setNote('')
      setStatus('ok')
      const hist = await api.getConfigHistory()
      setHistory(hist.history)
      setTimeout(() => setStatus(null), 2000)
    } catch (err) {
      setStatus(err.message)
    }
  }

  function handleRollback(snap) {
    setForm({ ...snap })
    setNote('從版本還原')
  }

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h2 className="admin-page-title">賠率設定</h2>
        <span className="admin-page-hint">儲存後下一局生效，當前局不受影響</span>
      </div>

      <form className="admin-card" onSubmit={handleSave}>
        <div className="admin-config-grid">
          {FIELDS.map(f => (
            <div key={f.key} className="admin-field">
              <label className="admin-label">
                {f.label}
                {f.hint && <span className="admin-field-hint">{f.hint}</span>}
              </label>
              {f.type === 'select' ? (
                <select
                  className="admin-input"
                  value={form[f.key] ?? ''}
                  onChange={e => handleChange(f.key, e.target.value)}
                >
                  {f.options.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  className="admin-input"
                  type="number"
                  step={f.step}
                  min={0}
                  value={form[f.key] ?? ''}
                  onChange={e => handleChange(f.key, e.target.value)}
                />
              )}
            </div>
          ))}
        </div>

        <div className="admin-field" style={{ marginTop: '1rem' }}>
          <label className="admin-label">備註（選填）</label>
          <input
            className="admin-input"
            type="text"
            placeholder="例：活動期間調整賠率"
            value={note}
            onChange={e => setNote(e.target.value)}
          />
        </div>

        <div className="admin-form-footer">
          {status === 'ok'     && <span className="admin-status-ok">已儲存，下一局生效</span>}
          {status === 'saving' && <span className="admin-status-info">儲存中…</span>}
          {status && status !== 'ok' && status !== 'saving' && <span className="admin-error">{status}</span>}
          <button className="admin-btn-primary" type="submit" disabled={status === 'saving'}>
            儲存設定
          </button>
        </div>
      </form>

      <div className="admin-card" style={{ marginTop: '1.5rem' }}>
        <button className="admin-btn-ghost" onClick={() => setShowHist(h => !h)}>
          {showHist ? '▲ 收起' : '▼ 查看歷史版本'}
        </button>
        {showHist && (
          <table className="admin-table" style={{ marginTop: '1rem' }}>
            <thead>
              <tr>
                <th>版本</th><th>修改人</th><th>備註</th><th>時間</th><th></th>
              </tr>
            </thead>
            <tbody>
              {history.map(h => (
                <tr key={h.id}>
                  <td>v{h.version}</td>
                  <td>{h.changed_by}</td>
                  <td>{h.note || '—'}</td>
                  <td>{new Date(h.created_at).toLocaleString('zh-TW')}</td>
                  <td>
                    <button className="admin-btn-ghost admin-btn-sm" onClick={() => handleRollback(h.config)}>
                      套用此版本
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
