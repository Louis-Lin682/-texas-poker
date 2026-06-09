import { SearchOutlined } from '@ant-design/icons'
import { Button, DatePicker, Input, Select, Space, Table, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { adminApi } from '../services/adminApi'
import { DATE_CHIPS, getPresetRange } from '../utils/dateRange'

const { Title } = Typography
const { RangePicker } = DatePicker

const GAME_OPTIONS = [
  { value: '', label: '全部遊戲' },
  { value: 'texas-holdem',  label: '德州撲克' },
  { value: 'big-two',       label: '大老二' },
  { value: 'dragon-tiger',  label: '龍虎鬥' },
  { value: 'blackjack',     label: '21點' },
  { value: 'thunder-joker', label: 'Thunder Joker' },
]

const TYPE_LABEL = {
  buy_in: '進場', cash_out: '出場', hand_win: '贏牌', hand_loss: '輸牌',
  win: '贏分', loss: '扣分', checkin: '簽到', quest_reward: '任務獎勵',
}

export default function ReportsPage() {
  const [rows,      setRows]      = useState([])
  const [summary,   setSummary]   = useState([])
  const [loading,   setLoading]   = useState(false)
  const [chip,      setChip]      = useState('all')
  const [range,     setRange]     = useState(null)
  const [game,      setGame]      = useState('')
  const [userId,    setUserId]    = useState('')
  async function load(currentChip = chip, currentRange = range, currentGame = game, uid = userId) {
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

      const params = { game: currentGame }
      if (dateFrom) params.dateFrom = dateFrom
      if (dateTo)   params.dateTo   = dateTo
      if (uid)      params.userSearch = uid

      const res = await adminApi.getReports(params)
      setRows(res.rows)
      setSummary(res.summary)
    } catch { } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  function onChipClick(val) {
    setChip(val)
    setRange(null)
    load(val, null, game, userId)
  }

  function onRangeChange(val) {
    setRange(val)
    setChip('custom')
    load('custom', val, game, userId)
  }

  function onGameChange(val) {
    setGame(val)
    load(chip, range, val, userId)
  }

  function onUserSearch(val) {
    const trimmed = val.trim()
    setUserId(trimmed)
    load(chip, range, game, trimmed)
  }

  const detailColumns = [
    { title: '遊戲', dataIndex: 'game', key: 'game', render: v => v || '—' },
    { title: '類型', dataIndex: 'type', key: 'type', render: v => TYPE_LABEL[v] || v },
    { title: '筆數', dataIndex: 'count', key: 'count', align: 'right' },
    {
      title: '正向金額', dataIndex: 'total_positive', key: 'total_positive', align: 'right',
      render: v => <span style={{ color: '#52c41a' }}>+{Number(v).toLocaleString()}</span>,
    },
    {
      title: '負向金額', dataIndex: 'total_negative', key: 'total_negative', align: 'right',
      render: v => <span style={{ color: '#ff4d4f' }}>{Number(v).toLocaleString()}</span>,
    },
    {
      title: '淨額', dataIndex: 'total_amount', key: 'total_amount', align: 'right',
      render: v => {
        const n = Number(v)
        return <span style={{ color: n >= 0 ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>
          {n >= 0 ? '+' : ''}{n.toLocaleString()}
        </span>
      },
    },
  ]

  const summaryColumns = [
    { title: '遊戲', dataIndex: 'game', key: 'game', render: v => v || '—' },
    { title: '活躍玩家', dataIndex: 'unique_players', key: 'unique_players', align: 'right' },
    { title: '總交易', dataIndex: 'total_tx', key: 'total_tx', align: 'right' },
    {
      title: '淨額', dataIndex: 'net', key: 'net', align: 'right',
      render: v => {
        const n = Number(v)
        return <span style={{ color: n >= 0 ? '#52c41a' : '#ff4d4f', fontWeight: 700 }}>
          {n >= 0 ? '+' : ''}{n.toLocaleString()}
        </span>
      },
    },
  ]

  return (
    <>
      <Title level={4} style={{ color: '#e8e8e8', marginBottom: 12 }}>遊戲報表</Title>

      {/* date chips */}
      <Space wrap style={{ marginBottom: 10 }}>
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
      </Space>

      {/* filters row */}
      <Space wrap style={{ marginBottom: 16 }}>
        <RangePicker
          size="small"
          value={chip === 'custom' ? range : null}
          onChange={onRangeChange}
          allowClear
        />
        <Select
          size="small"
          options={GAME_OPTIONS}
          value={game}
          onChange={onGameChange}
          style={{ width: 150 }}
        />
        <Input.Search
          size="small"
          placeholder="查詢個別會員"
          allowClear
          enterButton={<SearchOutlined />}
          style={{ width: 200 }}
          onSearch={onUserSearch}
        />
      </Space>

      {summary.length > 0 && (
        <>
          <Title level={5} style={{ color: '#aaa', marginBottom: 8 }}>遊戲總覽</Title>
          <Table
            rowKey="game"
            columns={summaryColumns}
            dataSource={summary}
            pagination={false}
            size="small"
            style={{ marginBottom: 24 }}
          />
        </>
      )}

      <Title level={5} style={{ color: '#aaa', marginBottom: 8 }}>明細</Title>
      <Table
        rowKey={r => `${r.game}-${r.type}`}
        columns={detailColumns}
        dataSource={rows}
        loading={loading}
        pagination={false}
        size="small"
      />
    </>
  )
}
