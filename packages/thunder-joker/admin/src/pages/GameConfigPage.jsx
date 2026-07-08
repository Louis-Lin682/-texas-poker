import { useEffect, useState } from 'react'
import { api } from '../services/api.js'

const WEIGHT_FIELDS = [
  { key: 'weight.wild',             label: 'wild 權重' },
  { key: 'weight.joker',            label: 'joker 權重' },
  { key: 'weight.bell',             label: 'bell 權重' },
  { key: 'weight.scatter',          label: 'scatter 權重' },
  { key: 'weight.clownhat-red',     label: '紅小丑帽 權重' },
  { key: 'weight.clownhat-purple',  label: '紫小丑帽 權重' },
  { key: 'weight.clownhat-blue',    label: '藍小丑帽 權重' },
  { key: 'weight.clownhat-golden',  label: '金小丑帽 權重' },
  { key: 'weight.A',                label: 'A 權重' },
  { key: 'weight.K',                label: 'K 權重' },
  { key: 'weight.Q',                label: 'Q 權重' },
  { key: 'weight.J',                label: 'J 權重' },
  { key: 'weight.10',               label: '10 權重' },
]

const PAYOUT_FIELDS = [
  { key: 'payout.wild',            label: 'wild 賠率' },
  { key: 'payout.joker',           label: 'joker 賠率' },
  { key: 'payout.bell',            label: 'bell 賠率' },
  { key: 'payout.clownhat-red',    label: '紅小丑帽 賠率' },
  { key: 'payout.clownhat-purple', label: '紫小丑帽 賠率' },
  { key: 'payout.clownhat-blue',   label: '藍小丑帽 賠率' },
  { key: 'payout.clownhat-golden', label: '金小丑帽 賠率' },
  { key: 'payout.A',               label: 'A 賠率' },
  { key: 'payout.K',               label: 'K 賠率' },
  { key: 'payout.Q',               label: 'Q 賠率' },
  { key: 'payout.J',               label: 'J 賠率' },
  { key: 'payout.10',              label: '10 賠率' },
]

function cfgToForm(cfg) {
  const out = { ...cfg }
  for (const { key } of PAYOUT_FIELDS) {
    if (Array.isArray(cfg[key])) out[key] = cfg[key].join(',')
  }
  for (const k of ['lightning.base_mults', 'lightning.free_mults', 'joker.mults']) {
    if (Array.isArray(cfg[k])) out[k] = cfg[k].join(',')
  }
  return out
}

function formToCfg(form) {
  const cfg = { ...form }
  for (const { key } of PAYOUT_FIELDS) {
    if (typeof cfg[key] === 'string') cfg[key] = cfg[key].split(',').map(Number)
  }
  for (const k of ['lightning.base_mults', 'lightning.free_mults', 'joker.mults']) {
    if (typeof cfg[k] === 'string') cfg[k] = cfg[k].split(',').map(Number)
  }
  for (const k of Object.keys(cfg)) {
    if (typeof cfg[k] === 'string' && !Array.isArray(cfg[k]) && !k.includes('mults') && !k.includes('payout')) {
      const n = Number(cfg[k])
      if (!isNaN(n) && cfg[k] !== '') cfg[k] = n
    }
  }
  return cfg
}

function Input({ form, k, type = 'number', placeholder }) {
  return (
    <input
      className="admin-input"
      type={type}
      value={form[k] ?? ''}
      placeholder={placeholder}
      onChange={e => form.__set(k, e.target.value)}
    />
  )
}

export default function GameConfigPage() {
  const [form,      setForm]      = useState({})
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)
  const [status,    setStatus]    = useState(null)
  const [rtp,       setRtp]       = useState(null)
  const [rtpSince,  setRtpSince]  = useState(null)  // null = 全部時間
  const [history,   setHistory]   = useState([])
  const [histOpen,  setHistOpen]  = useState(false)

  function setField(k, v) {
    setForm(f => ({ ...f, [k]: v }))
  }

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.getConfig().then(d => setForm({ ...cfgToForm(d.config), note: '' })),
      api.getRtp().then(d => { setRtp(d); setRtpSince(null) }).catch(() => {}),
    ])
      .catch(() => setStatus('讀取設定失敗'))
      .finally(() => setLoading(false))
  }, [])

  async function handleSave(e) {
    e.preventDefault()
    const { note, ...rest } = form
    setSaving(true)
    setStatus(null)
    try {
      await api.putConfig({ config: formToCfg(rest), note: note ?? '' })
      setStatus('ok')
      setTimeout(() => setStatus(null), 2500)
      // 存檔後自動切換到新版本統計
      const newRtp = await api.getRtp().catch(() => null)
      if (newRtp) {
        const newVersion = newRtp.currentVersion
        setRtp(await api.getRtp(newVersion).catch(() => newRtp))
        setRtpSince(newVersion)
      }
    } catch (err) {
      setStatus(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function loadHistory() {
    try {
      const d = await api.getConfigHistory()
      setHistory(d.history)
      setHistOpen(true)
    } catch {}
  }

  function applyVersion(cfg) {
    setForm({ ...cfgToForm(cfg), note: '從歷史版本還原' })
    setHistOpen(false)
  }

  const F = { ...form, __set: setField }

  if (loading) return <div className="admin-page"><p>載入中…</p></div>

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h2 className="admin-page-title">Thunder Joker 遊戲設定</h2>
        <span className="admin-page-hint">儲存後次回合生效</span>
      </div>

      {rtp && (
        <div className="admin-card" style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <span className="admin-label" style={{ margin: 0 }}>
              統計範圍：{rtpSince != null ? `v${rtpSince} 起（新 config）` : '全部時間'}
            </span>
            {rtpSince != null && (
              <button type="button" className="admin-btn-outline" style={{ padding: '2px 10px', fontSize: '0.8rem' }}
                onClick={async () => { const d = await api.getRtp().catch(()=>null); if(d){setRtp(d);setRtpSince(null)} }}>
                顯示全部
              </button>
            )}
            {rtpSince == null && rtp.currentVersion != null && (
              <button type="button" className="admin-btn-outline" style={{ padding: '2px 10px', fontSize: '0.8rem' }}
                onClick={async () => { const d = await api.getRtp(rtp.currentVersion).catch(()=>null); if(d){setRtp(d);setRtpSince(rtp.currentVersion)} }}>
                僅看 v{rtp.currentVersion}（目前版本）
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
            <div><div className="admin-label">累計下注</div><strong>{Number(rtp.totalBet).toLocaleString()}</strong></div>
            <div><div className="admin-label">累計派彩</div><strong>{Number(rtp.totalPayout).toLocaleString()}</strong></div>
            <div><div className="admin-label">實際 RTP</div><strong>{rtp.actualRtp ?? '—'}%</strong></div>
            <div><div className="admin-label">總轉數</div><strong>{rtp.spins}</strong></div>
          </div>
        </div>
      )}

      <form className="admin-card" onSubmit={handleSave}>

        <h3 className="admin-section-title">下注限制</h3>
        <div className="admin-config-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div className="admin-field"><label className="admin-label">最低下注</label><Input form={F} k="min_bet" /></div>
          <div className="admin-field"><label className="admin-label">最高下注</label><Input form={F} k="max_bet" /></div>
        </div>

        <h3 className="admin-section-title" style={{ marginTop: '1.5rem' }}>符號權重</h3>
        <div className="admin-config-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {WEIGHT_FIELDS.map(({ key, label }) => (
            <div key={key} className="admin-field">
              <label className="admin-label">{label}</label>
              <Input form={F} k={key} />
            </div>
          ))}
        </div>

        <h3 className="admin-section-title" style={{ marginTop: '1.5rem' }}>賠率表（格式：0,0,X,X,X）</h3>
        <div className="admin-config-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {PAYOUT_FIELDS.map(({ key, label }) => (
            <div key={key} className="admin-field">
              <label className="admin-label">{label}</label>
              <Input form={F} k={key} type="text" placeholder="0,0,X,X,X" />
            </div>
          ))}
        </div>

        <h3 className="admin-section-title" style={{ marginTop: '1.5rem' }}>閃電功能</h3>
        <div className="admin-config-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <div className="admin-field"><label className="admin-label">一般轉 閃電觸發機率 (%)</label><Input form={F} k="lightning.base_prob" /></div>
          <div className="admin-field"><label className="admin-label">免費轉 閃電觸發機率 (%)</label><Input form={F} k="lightning.free_prob" /></div>
          <div className="admin-field"><label className="admin-label">一般轉倍率池</label><Input form={F} k="lightning.base_mults" type="text" placeholder="2,2,3" /></div>
          <div className="admin-field"><label className="admin-label">免費轉倍率池</label><Input form={F} k="lightning.free_mults" type="text" placeholder="2,3" /></div>
        </div>

        <h3 className="admin-section-title" style={{ marginTop: '1.5rem' }}>免費旋轉</h3>
        <div className="admin-config-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <div className="admin-field"><label className="admin-label">3 scatter 觸發次數</label><Input form={F} k="free.spins_3scatter" /></div>
          <div className="admin-field"><label className="admin-label">4 scatter 觸發次數</label><Input form={F} k="free.spins_4scatter" /></div>
          <div className="admin-field"><label className="admin-label">5 scatter 觸發次數</label><Input form={F} k="free.spins_5scatter" /></div>
          <div className="admin-field"><label className="admin-label">最多累積次數</label><Input form={F} k="free.max_total" /></div>
          <div className="admin-field"><label className="admin-label">3 scatter 再觸發</label><Input form={F} k="free.retrigger_3scatter" /></div>
          <div className="admin-field"><label className="admin-label">4 scatter 再觸發</label><Input form={F} k="free.retrigger_4scatter" /></div>
          <div className="admin-field"><label className="admin-label">5 scatter 再觸發</label><Input form={F} k="free.retrigger_5scatter" /></div>
        </div>

        <h3 className="admin-section-title" style={{ marginTop: '1.5rem' }}>Joker 倍率（免費轉）</h3>
        <div className="admin-config-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          <div className="admin-field"><label className="admin-label">倍率池（逗號分隔）</label><Input form={F} k="joker.mults" type="text" placeholder="1,1,2,3,5" /></div>
          <div className="admin-field"><label className="admin-label">最高累積倍率</label><Input form={F} k="joker.max" /></div>
        </div>

        <h3 className="admin-section-title" style={{ marginTop: '1.5rem' }}>大獎動畫閾值（贏得 ÷ 下注）</h3>
        <div className="admin-config-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <div className="admin-field"><label className="admin-label">big 閾值 (倍)</label><Input form={F} k="win_level.big" /></div>
          <div className="admin-field"><label className="admin-label">mega 閾值 (倍)</label><Input form={F} k="win_level.mega" /></div>
          <div className="admin-field"><label className="admin-label">epic 閾值 (倍)</label><Input form={F} k="win_level.epic" /></div>
          <div className="admin-field"><label className="admin-label">super 閾值 (倍)</label><Input form={F} k="win_level.super" /></div>
        </div>

        <div className="admin-field" style={{ marginTop: '1.5rem' }}>
          <label className="admin-label">備註（選填）</label>
          <input className="admin-input" type="text" placeholder="例：活動期間調整賠率"
            value={form.note ?? ''} onChange={e => setField('note', e.target.value)} />
        </div>

        <div className="admin-form-footer" style={{ marginTop: '1.5rem' }}>
          {status === 'ok'    && <span className="admin-status-ok">已儲存，立即生效（次回合）</span>}
          {status && status !== 'ok' && <span className="admin-error">{status}</span>}
          <button type="button" className="admin-btn-ghost" onClick={loadHistory}>查看歷史</button>
          <button type="submit" className="admin-btn-primary" disabled={saving}>
            {saving ? '儲存中…' : '儲存設定'}
          </button>
        </div>
      </form>

      {histOpen && (
        <div className="admin-card" style={{ marginTop: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h3 className="admin-section-title" style={{ margin: 0 }}>歷史版本</h3>
            <button className="admin-btn-ghost admin-btn-sm" onClick={() => setHistOpen(false)}>收起</button>
          </div>
          <table className="admin-table">
            <thead>
              <tr><th>版本</th><th>修改人</th><th>備註</th><th>時間</th><th></th></tr>
            </thead>
            <tbody>
              {history.map(row => (
                <tr key={row.id}>
                  <td>v{row.version}</td>
                  <td>{row.changed_by}</td>
                  <td>{row.note || '—'}</td>
                  <td>{new Date(row.created_at).toLocaleString('zh-TW')}</td>
                  <td><button className="admin-btn-ghost admin-btn-sm" onClick={() => applyVersion(row.config)}>套用</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
