import { useEffect, useState } from 'react'
import {
  App, Button, Card, Form, Input, InputNumber,
  Space, Table, Typography, Statistic, Row, Col,
} from 'antd'
import { adminApi } from '../services/adminApi'

const { Title, Text } = Typography

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

// payout arrays are edited as comma-separated strings
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

const HIST_COLS = [
  { title: '版本',   dataIndex: 'version',    render: v => `v${v}`, width: 70 },
  { title: '修改人', dataIndex: 'changed_by', width: 120 },
  { title: '備註',   dataIndex: 'note',       render: v => v || '—' },
  { title: '時間',   dataIndex: 'created_at', render: v => new Date(v).toLocaleString('zh-TW'), width: 180 },
]

function cfgToForm(cfg) {
  const out = { ...cfg }
  for (const { key } of PAYOUT_FIELDS) {
    if (Array.isArray(cfg[key])) out[key] = cfg[key].join(',')
  }
  if (Array.isArray(cfg['lightning.base_mults'])) out['lightning.base_mults'] = cfg['lightning.base_mults'].join(',')
  if (Array.isArray(cfg['lightning.free_mults'])) out['lightning.free_mults'] = cfg['lightning.free_mults'].join(',')
  if (Array.isArray(cfg['joker.mults']))           out['joker.mults']          = cfg['joker.mults'].join(',')
  return out
}

function formToCfg(values) {
  const cfg = { ...values }
  for (const { key } of PAYOUT_FIELDS) {
    if (typeof cfg[key] === 'string') cfg[key] = cfg[key].split(',').map(Number)
  }
  for (const k of ['lightning.base_mults', 'lightning.free_mults', 'joker.mults']) {
    if (typeof cfg[k] === 'string') cfg[k] = cfg[k].split(',').map(Number)
  }
  return cfg
}

export default function ThunderJokerConfigPage() {
  const { message } = App.useApp()
  const [form]      = Form.useForm()
  const [loading,  setLoading]  = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [history,  setHistory]  = useState([])
  const [histOpen, setHistOpen] = useState(false)
  const [rtp,      setRtp]      = useState(null)

  useEffect(() => {
    setLoading(true)
    adminApi.getSlotConfig()
      .then(d => form.setFieldsValue({ ...cfgToForm(d.config), note: '' }))
      .catch(() => message.error('讀取設定失敗'))
      .finally(() => setLoading(false))
    adminApi.getSlotRtp().then(setRtp).catch(() => {})
  }, [form])

  async function onFinish(values) {
    const { note, ...rest } = values
    setSaving(true)
    try {
      await adminApi.saveSlotConfig(formToCfg(rest), note ?? '')
      message.success('已儲存，立即生效（次回合）')
      form.setFieldValue('note', '')
    } catch (e) {
      message.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function loadHistory() {
    try {
      const d = await adminApi.getSlotConfigHistory()
      setHistory(d.history)
      setHistOpen(true)
    } catch {
      message.error('讀取歷史失敗')
    }
  }

  function applyVersion(cfg) {
    form.setFieldsValue({ ...cfgToForm(cfg), note: '從歷史版本還原' })
    setHistOpen(false)
  }

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16 }} align="center">
        <Title level={4} style={{ margin: 0 }}>Thunder Joker 老虎機設定</Title>
        <Text type="secondary">儲存後次回合生效</Text>
      </Space>

      {rtp && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col><Statistic title="累計下注"    value={rtp.totalBet}    suffix="籌碼" /></Col>
          <Col><Statistic title="累計派彩"    value={rtp.totalPayout} suffix="籌碼" /></Col>
          <Col><Statistic title="實際 RTP"   value={rtp.actualRtp ?? '—'} suffix="%" /></Col>
          <Col><Statistic title="總轉數"      value={rtp.spins} /></Col>
        </Row>
      )}

      <Card loading={loading}>
        <Form form={form} layout="vertical" onFinish={onFinish}>

          <Title level={5}>下注限制</Title>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0 24px' }}>
            <Form.Item name="min_bet" label="最低下注">
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="max_bet" label="最高下注">
              <InputNumber min={1} step={100} style={{ width: '100%' }} />
            </Form.Item>
          </div>

          <Title level={5} style={{ marginTop: 8 }}>符號權重（數字越大=越常出現）</Title>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0 24px' }}>
            {WEIGHT_FIELDS.map(f => (
              <Form.Item key={f.key} name={f.key} label={f.label}>
                <InputNumber min={0} step={1} style={{ width: '100%' }} />
              </Form.Item>
            ))}
          </div>

          <Title level={5} style={{ marginTop: 8 }}>賠率表（格式：1x,2x,3x,4x,5x）</Title>
          <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>前兩個通常為 0（需 3 個才中），例：0,0,22,75,300</Text>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0 24px' }}>
            {PAYOUT_FIELDS.map(f => (
              <Form.Item key={f.key} name={f.key} label={f.label}>
                <Input placeholder="0,0,X,X,X" style={{ width: '100%' }} />
              </Form.Item>
            ))}
          </div>

          <Title level={5} style={{ marginTop: 8 }}>閃電功能</Title>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0 24px' }}>
            <Form.Item name="lightning.base_prob"  label="一般轉 閃電倍率觸發機率 (%)">
              <InputNumber min={0} max={100} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="lightning.free_prob"  label="免費轉 閃電倍率觸發機率 (%)">
              <InputNumber min={0} max={100} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="lightning.base_mults" label="一般轉倍率池（逗號分隔）">
              <Input placeholder="2,2,3" />
            </Form.Item>
            <Form.Item name="lightning.free_mults" label="免費轉倍率池（逗號分隔）">
              <Input placeholder="2,3" />
            </Form.Item>
          </div>

          <Title level={5} style={{ marginTop: 8 }}>免費旋轉</Title>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0 24px' }}>
            <Form.Item name="free.spins_3scatter"     label="3 scatter 觸發次數">
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="free.spins_4scatter"     label="4 scatter 觸發次數">
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="free.spins_5scatter"     label="5 scatter 觸發次數">
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="free.max_total"          label="最多累積次數">
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="free.retrigger_3scatter" label="3 scatter 再觸發">
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="free.retrigger_4scatter" label="4 scatter 再觸發">
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="free.retrigger_5scatter" label="5 scatter 再觸發">
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </div>

          <Title level={5} style={{ marginTop: 8 }}>Joker 倍率累積（免費旋轉）</Title>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0 24px' }}>
            <Form.Item name="joker.mults" label="倍率池（逗號分隔，每個 joker 隨機取一）">
              <Input placeholder="1,1,2,3,5" />
            </Form.Item>
            <Form.Item name="joker.max" label="最高累積倍率">
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
          </div>

          <Title level={5} style={{ marginTop: 8 }}>大獎動畫閾值（贏得倍數 ÷ 下注）</Title>
          <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>例：big=2 表示贏到 2 倍下注才顯示大獎動畫；數字越大越難觸發</Text>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0 24px' }}>
            <Form.Item name="win_level.big"   label="big 閾值 (倍)">
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="win_level.mega"  label="mega 閾值 (倍)">
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="win_level.epic"  label="epic 閾值 (倍)">
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="win_level.super" label="super 閾值 (倍)">
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
          </div>

          <Form.Item name="note" label="備註（選填）" style={{ marginTop: 8 }}>
            <Input placeholder="例：活動期間調整賠率" />
          </Form.Item>

          <Space>
            <Button type="primary" htmlType="submit" loading={saving}>儲存設定</Button>
            <Button onClick={loadHistory}>查看歷史版本</Button>
          </Space>
        </Form>
      </Card>

      {histOpen && (
        <Card style={{ marginTop: 16 }} title="歷史版本" extra={<Button size="small" onClick={() => setHistOpen(false)}>收起</Button>}>
          <Table
            dataSource={history}
            columns={[
              ...HIST_COLS,
              { title: '', render: (_, row) => <Button size="small" onClick={() => applyVersion(row.config)}>套用</Button>, width: 80 },
            ]}
            rowKey="id"
            size="small"
            pagination={false}
          />
        </Card>
      )}
    </div>
  )
}
