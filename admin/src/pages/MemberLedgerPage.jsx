import { ArrowLeftOutlined, SearchOutlined } from '@ant-design/icons'
import { Button, DatePicker, Input, Select, Space, Table, Tag, Typography } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { adminApi } from '../services/adminApi'
import { DATE_CHIPS, getPresetRange } from '../utils/dateRange'

const { Title, Text } = Typography
const { RangePicker } = DatePicker

const TYPE_OPTIONS = [
  { value: '', label: '全部類型' },
  { value: 'buy_in',    label: '進場' },
  { value: 'cash_out',  label: '出場' },
  { value: 'hand_win',  label: '贏牌' },
  { value: 'hand_loss', label: '輸牌' },
  { value: 'win',       label: '贏分' },
  { value: 'loss',      label: '扣分' },
  { value: 'checkin',   label: '簽到' },
]

const TYPE_LABEL = {
  buy_in: '進場', cash_out: '出場', hand_win: '贏牌', hand_loss: '輸牌',
  win: '贏分', loss: '扣分', checkin: '簽到',
}
const TYPE_COLOR = {
  buy_in: 'orange', cash_out: 'blue', hand_win: 'green', hand_loss: 'red',
  win: 'green', loss: 'red', checkin: 'purple',
}

const PAGE_SIZE = 50

export default function MemberLedgerPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [member,    setMember]    = useState(null)
  const [rows,      setRows]      = useState([])
  const [total,     setTotal]     = useState(0)
  const [summary,   setSummary]   = useState(null)
  const [page,      setPage]      = useState(1)
  const [loading,   setLoading]   = useState(false)
  const [chip,      setChip]      = useState('all')
  const [range,     setRange]     = useState(null)
  const [type,      setType]      = useState('')
  const [userSearch, setUserSearch] = useState('')

  // load member name once
  useEffect(() => {
    adminApi.getMember(id).then(r => setMember(r.member)).catch(() => {})
  }, [id])

  async function load(p = 1, currentChip = chip, currentRange = range, currentType = type) {
    setLoading(true)
    try {
      let dateFrom, dateTo
      if (currentChip !== 'all' && currentChip !== 'custom') {
        const preset = getPresetRange(currentChip)
        dateFrom = preset.dateFrom
        dateTo   = preset.dateTo
      } else if (currentChip === 'custom' && currentRange?.[0]) {
        dateFrom = currentRange[0].startOf('day').toISOString()
        dateTo   = currentRange[1] ? currentRange[1].endOf('day').toISOString() : null
      }

      const res = await adminApi.getMemberLedger(id, {
        limit: PAGE_SIZE,
        offset: (p - 1) * PAGE_SIZE,
        dateFrom,
        dateTo,
        type: currentType,
      })
      setRows(res.ledger)
      setTotal(res.total)
      setSummary(res.summary)
      setPage(p)
    } catch { } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [id])

  function onChipClick(val) {
    setChip(val)
    setRange(null)
    load(1, val, null, type)
  }

  function onRangeChange(val) {
    setRange(val)
    setChip('custom')
    load(1, 'custom', val, type)
  }

  function onTypeChange(val) {
    setType(val)
    load(1, chip, range, val)
  }

  // account search: navigate to that member's ledger
  function onUserSearch(val) {
    const trimmed = val.trim()
    if (!trimmed) return
    adminApi.getMembers({ search: trimmed, limit: 1 }).then(r => {
      if (r.members?.[0]) navigate(`/members/${r.members[0].id}/ledger`)
    }).catch(() => {})
  }

  const columns = [
    {
      title: '類型', dataIndex: 'type', key: 'type', width: 80,
      render: v => <Tag color={TYPE_COLOR[v] || 'default'}>{TYPE_LABEL[v] || v}</Tag>,
    },
    {
      title: '金額', dataIndex: 'amount', key: 'amount', width: 110, align: 'right',
      render: v => (
        <span style={{ color: v >= 0 ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>
          {v >= 0 ? '+' : ''}{v.toLocaleString()}
        </span>
      ),
    },
    { title: '遊戲', dataIndex: 'game', key: 'game', width: 110, render: v => v || '—' },
    { title: '房間', dataIndex: 'room_id', key: 'room_id', width: 80, render: v => v ? `#${v}` : '—' },
    {
      title: '時間', dataIndex: 'created_at', key: 'created_at',
      render: v => new Date(v).toLocaleString('zh-TW', { hour12: false }),
    },
  ]

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(`/members/${id}`)}>返回</Button>
        <Title level={4} style={{ color: '#e8e8e8', margin: 0 }}>
          帳務記錄 {member && `— ${member.username}`}
        </Title>
      </div>

      {/* filters */}
      <Space wrap style={{ marginBottom: 12 }}>
        {DATE_CHIPS.map(c => (
          <Button
            key={c.value}
            size="small"
            type={chip === c.value ? 'primary' : 'default'}
            style={chip === c.value ? { background: '#c49010', borderColor: '#c49010' } : {}}
            onClick={() => onChipClick(c.value)}
          >
            {c.label}
          </Button>
        ))}
        <RangePicker
          size="small"
          value={chip === 'custom' ? range : null}
          onChange={onRangeChange}
          allowClear
        />
        <Select
          size="small"
          options={TYPE_OPTIONS}
          value={type}
          onChange={onTypeChange}
          style={{ width: 120 }}
        />
        <Input.Search
          size="small"
          placeholder="查詢其他帳號"
          allowClear
          enterButton={<SearchOutlined />}
          style={{ width: 200 }}
          onSearch={onUserSearch}
        />
      </Space>

      {/* summary */}
      {summary && (
        <div style={{ display: 'flex', gap: 24, marginBottom: 16, padding: '10px 16px', background: '#1e1e2e', borderRadius: 6, border: '1px solid #2a2a3a' }}>
          <span>共 <strong style={{ color: '#e0e0e0' }}>{total}</strong> 筆</span>
          <span>帶出 <strong style={{ color: '#52c41a' }}>+{Number(summary.total_wins || 0).toLocaleString()}</strong></span>
          <span>帶入 <strong style={{ color: '#ff4d4f' }}>-{Number(summary.total_losses || 0).toLocaleString()}</strong></span>
          <span>淨額 <strong style={{ color: Number(summary.net || 0) >= 0 ? '#52c41a' : '#ff4d4f' }}>
            {Number(summary.net || 0) >= 0 ? '+' : ''}{Number(summary.net || 0).toLocaleString()}
          </strong></span>
        </div>
      )}

      <Table
        rowKey="id"
        columns={columns}
        dataSource={rows}
        loading={loading}
        size="small"
        pagination={{
          total,
          pageSize: PAGE_SIZE,
          current: page,
          onChange: p => load(p),
          showTotal: t => `共 ${t} 筆`,
        }}
      />
    </>
  )
}
