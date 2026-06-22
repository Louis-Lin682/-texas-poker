import { useEffect, useState } from 'react'
import {
  App, Button, Card, Form, Input, InputNumber, Select,
  Space, Table, Typography,
} from 'antd'
import { adminApi } from '../services/adminApi'

const { Title, Text } = Typography

const FIELDS = [
  { key: 'payout.dragon',     label: '龍 賠率 (1:N)' },
  { key: 'payout.tiger',      label: '虎 賠率 (1:N)' },
  { key: 'payout.tie',        label: '和 賠率 (1:N)' },
  { key: 'payout.tie_refund', label: '和局退還比例',  hint: '0.5 = 退半注' },
  { key: 'payout.big',        label: '大 賠率 (1:N)' },
  { key: 'payout.small',      label: '小 賠率 (1:N)' },
  { key: 'payout.odd',        label: '單 賠率 (1:N)' },
  { key: 'payout.even',       label: '雙 賠率 (1:N)' },
  { key: 'payout.suit',       label: '花色 賠率 (1:N)' },
]

const HIST_COLS = [
  { title: '版本',    dataIndex: 'version',    render: v => `v${v}`, width: 70 },
  { title: '修改人',  dataIndex: 'changed_by', width: 120 },
  { title: '備註',    dataIndex: 'note',        render: v => v || '—' },
  {
    title: '時間', dataIndex: 'created_at',
    render: v => new Date(v).toLocaleString('zh-TW'),
    width: 180,
  },
]

export default function DragonTigerConfigPage() {
  const { message } = App.useApp()
  const [form]      = Form.useForm()
  const [loading,  setLoading]  = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [history,  setHistory]  = useState([])
  const [histOpen, setHistOpen] = useState(false)

  useEffect(() => {
    setLoading(true)
    adminApi.getDtConfig()
      .then(d => form.setFieldsValue({ ...d.config, note: '' }))
      .catch(() => message.error('讀取設定失敗'))
      .finally(() => setLoading(false))
  }, [form])

  async function onFinish(values) {
    const { note, seven_rule, min_bet, max_bet, bet_time_ms, ...payouts } = values
    const config = {
      ...payouts,
      seven_rule,
      min_bet:      Number(min_bet),
      max_bet:      Number(max_bet),
      bet_time_ms:  Number(bet_time_ms),
    }
    setSaving(true)
    try {
      await adminApi.saveDtConfig(config, note ?? '')
      message.success('已儲存，下一局生效')
      form.setFieldValue('note', '')
    } catch (e) {
      message.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function loadHistory() {
    try {
      const d = await adminApi.getDtConfigHistory()
      setHistory(d.history)
      setHistOpen(true)
    } catch {
      message.error('讀取歷史失敗')
    }
  }

  function applyVersion(cfg) {
    form.setFieldsValue({ ...cfg, note: '從歷史版本還原' })
    setHistOpen(false)
  }

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16 }} align="center">
        <Title level={4} style={{ margin: 0 }}>龍虎鬥 賠率設定</Title>
        <Text type="secondary">儲存後下一局生效，當前局不受影響</Text>
      </Space>

      <Card loading={loading}>
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0 24px' }}>
            {FIELDS.map(f => (
              <Form.Item key={f.key} name={f.key} label={f.hint ? `${f.label}（${f.hint}）` : f.label}>
                <InputNumber step={0.01} min={0} precision={2} style={{ width: '100%' }} />
              </Form.Item>
            ))}
            <Form.Item name="seven_rule" label="7 規則">
              <Select options={[
                { value: 'push', label: 'push — 退還邊注' },
                { value: 'lose', label: 'lose — 莊家吃注' },
              ]} />
            </Form.Item>
            <Form.Item name="min_bet" label="最低下注">
              <InputNumber step={1} min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="max_bet" label="最高下注">
              <InputNumber step={100} min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="bet_time_ms" label="下注時間（毫秒）">
              <InputNumber step={1000} min={5000} style={{ width: '100%' }} />
            </Form.Item>
          </div>

          <Form.Item name="note" label="備註（選填）">
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
              {
                title: '',
                render: (_, row) => (
                  <Button size="small" onClick={() => applyVersion(row.config)}>套用</Button>
                ),
                width: 80,
              },
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
