import { CloseCircleOutlined, ReloadOutlined, UserDeleteOutlined } from '@ant-design/icons'
import { Badge, Button, Popconfirm, Space, Table, Tag, Tooltip, Typography } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import { adminApi } from '../services/adminApi'

const { Text } = Typography

const GAME_LABELS = {
  'texas-holdem': { label: '德州撲克', color: 'blue' },
  'big-two':      { label: '大老二',   color: 'green' },
  'blackjack':    { label: '21點',     color: 'gold' },
  'dragon-tiger': { label: '龍虎',     color: 'red' },
}

const PHASE_LABELS = {
  waiting:  '等待中',
  pre_flop: '翻牌前',
  flop:     '翻牌',
  turn:     '轉牌',
  river:    '河牌',
  showdown: '攤牌',
  playing:  '遊戲中',
  finished: '已結束',
  betting:  '下注中',
  dealer:   '莊家出牌',
  result:   '結算中',
  idle:     '待機中',
  dealing:  '發牌中',
}

function stakes(room) {
  if (room.bigBlind)  return `大盲 ${room.bigBlind}`
  if (room.betUnit)   return `底注 ${room.betUnit}`
  if (room.maxBet)    return `上限 ${room.maxBet}`
  return '—'
}

export default function RoomsPage() {
  const [rooms,   setRooms]   = useState([])
  const [loading, setLoading] = useState(false)
  const intervalRef = useRef(null)

  const fetchRooms = useCallback(async () => {
    try {
      const data = await adminApi.getRooms()
      setRooms(data.rooms)
    } catch {}
  }, [])

  useEffect(() => {
    setLoading(true)
    fetchRooms().finally(() => setLoading(false))
    intervalRef.current = setInterval(fetchRooms, 5000)
    return () => clearInterval(intervalRef.current)
  }, [fetchRooms])

  async function handleClose(roomId) {
    await adminApi.closeRoom(roomId)
    fetchRooms()
  }

  async function handleKick(roomId, playerId) {
    await adminApi.kickPlayer(roomId, playerId)
    fetchRooms()
  }

  const columns = [
    {
      title: '房間 ID',
      dataIndex: 'id',
      width: 110,
      render: id => <Text code style={{ fontSize: 13 }}>{id}</Text>,
    },
    {
      title: '遊戲',
      dataIndex: 'gameType',
      width: 100,
      render: t => {
        const g = GAME_LABELS[t] ?? { label: t, color: 'default' }
        return <Tag color={g.color}>{g.label}</Tag>
      },
    },
    {
      title: '狀態',
      dataIndex: 'phase',
      width: 90,
      render: p => <Badge status={p === 'waiting' ? 'default' : 'processing'} text={PHASE_LABELS[p] ?? p} />,
    },
    {
      title: '人數',
      width: 70,
      render: r => `${r.playerCount} / ${r.maxPlayers}`,
    },
    {
      title: '底注',
      width: 100,
      render: r => stakes(r),
    },
    {
      title: '',
      width: 90,
      render: r => (
        <Popconfirm
          title="確定強制關閉這個房間？"
          description="所有玩家將被移出並退回籌碼。"
          onConfirm={() => handleClose(r.id)}
          okText="關閉" cancelText="取消"
          okButtonProps={{ danger: true }}
        >
          <Button size="small" danger icon={<CloseCircleOutlined />}>關閉房間</Button>
        </Popconfirm>
      ),
    },
  ]

  const expandedRow = (room) => {
    const playerCols = [
      {
        title: '玩家',
        dataIndex: 'username',
        render: (name, p) => (
          <Space>
            {name}
            {p.isBot && <Tag color="purple" style={{ fontSize: 11, padding: '0 4px' }}>Bot</Tag>}
          </Space>
        ),
      },
      {
        title: '籌碼',
        dataIndex: 'balance',
        render: v => v.toLocaleString(),
      },
      {
        title: '狀態',
        dataIndex: 'status',
        render: s => s ?? '—',
      },
      {
        title: '',
        render: p => (
          <Tooltip title={p.isBot ? '不可踢出 Bot' : '踢出玩家'}>
            <Popconfirm
              title={`確定踢出 ${p.username}？`}
              description="玩家將被移出房間並退回籌碼。"
              onConfirm={() => handleKick(room.id, p.id)}
              okText="踢出" cancelText="取消"
              okButtonProps={{ danger: true }}
              disabled={p.isBot}
            >
              <Button
                size="small" danger icon={<UserDeleteOutlined />}
                disabled={p.isBot}
              >
                踢出
              </Button>
            </Popconfirm>
          </Tooltip>
        ),
      },
    ]

    return (
      <Table
        columns={playerCols}
        dataSource={room.players}
        rowKey="id"
        pagination={false}
        size="small"
        style={{ margin: '0 48px' }}
      />
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>房間管理</Typography.Title>
        <Space>
          <Text type="secondary" style={{ fontSize: 12 }}>每 5 秒自動更新</Text>
          <Button icon={<ReloadOutlined />} onClick={() => { setLoading(true); fetchRooms().finally(() => setLoading(false)) }}>
            重新整理
          </Button>
        </Space>
      </div>

      <Table
        columns={columns}
        dataSource={rooms}
        rowKey="id"
        loading={loading}
        expandable={{ expandedRowRender: expandedRow }}
        pagination={false}
        locale={{ emptyText: '目前沒有任何房間' }}
        size="middle"
      />
    </div>
  )
}
