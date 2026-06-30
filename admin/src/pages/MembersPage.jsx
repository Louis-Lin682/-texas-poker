import { SearchOutlined } from '@ant-design/icons'
import { App, Button, Input, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminApi } from '../services/adminApi'

const { Title } = Typography

export default function MembersPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [data,    setData]    = useState([])
  const [total,   setTotal]   = useState(0)
  const [page,    setPage]    = useState(1)
  const [search,  setSearch]  = useState('')
  const [status,  setStatus]  = useState('')
  const [loading, setLoading] = useState(false)

  async function load(p = page, s = search, st = status) {
    setLoading(true)
    try {
      const res = await adminApi.getMembers({ page: p, limit: 20, search: s, status: st })
      setData(res.members)
      setTotal(res.total)
    } catch { } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(1, '', '') }, [])

  function onSearch(val) {
    setSearch(val)
    setPage(1)
    load(1, val, status)
  }

  function onStatusChange(val) {
    setStatus(val)
    setPage(1)
    load(1, search, val)
  }

  async function toggleSuspend(record) {
    try {
      const res = record.suspended_at
        ? await adminApi.unsuspendMember(record.id)
        : await adminApi.suspendMember(record.id)
      setData(prev => prev.map(m => m.id === record.id ? res.member : m))
      message.success(record.suspended_at ? '已解除停權' : '已停權')
    } catch (e) {
      message.error(e.message)
    }
  }

  const columns = [
    {
      title: '用戶名', dataIndex: 'username', key: 'username',
      render: (v, r) => (
        <Button type="link" style={{ padding: 0 }} onClick={() => navigate(`/members/${r.id}`)}>
          {v}
        </Button>
      ),
    },
    {
      title: '狀態', key: 'status', width: 120,
      render: (_, r) => (
        <Space size={4}>
          {r.is_guest && <Tag color="gold">訪客</Tag>}
          {r.suspended_at ? <Tag color="red">停權</Tag> : <Tag color="green">正常</Tag>}
        </Space>
      ),
    },
    {
      title: '籌碼餘額', dataIndex: 'balance', key: 'balance',
      render: v => <span style={{ color: '#f0d080' }}>{v.toLocaleString()}</span>,
      align: 'right',
    },
    {
      title: '註冊時間', dataIndex: 'created_at', key: 'created_at',
      render: v => new Date(v).toLocaleString('zh-TW', { hour12: false }),
    },
    {
      title: '操作', key: 'action',
      render: (_, r) => (
        <Space>
          <Button size="small" onClick={() => navigate(`/members/${r.id}`)}>詳情</Button>
          <Popconfirm
            title={r.suspended_at ? '確定解除停權？' : '確定停權此會員？'}
            onConfirm={() => toggleSuspend(r)}
            okText="確定"
            cancelText="取消"
          >
            <Button
              size="small"
              danger={!r.suspended_at}
              type={r.suspended_at ? 'default' : 'primary'}
            >
              {r.suspended_at ? '解除停權' : '停權'}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ color: '#e8e8e8', margin: 0 }}>會員管理</Title>
        <Space>
          <Select
            value={status}
            onChange={onStatusChange}
            style={{ width: 120 }}
            options={[
              { value: '',         label: '全部' },
              { value: 'member',   label: '正式會員' },
              { value: 'guest',    label: '訪客' },
              { value: 'active',   label: '正常' },
              { value: 'suspended',label: '停權' },
            ]}
          />
          <Input.Search
            placeholder="搜尋用戶名"
            allowClear
            enterButton={<SearchOutlined />}
            style={{ width: 240 }}
            onSearch={onSearch}
          />
        </Space>
      </div>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={data}
        loading={loading}
        pagination={{
          total, pageSize: 20, current: page,
          onChange: p => { setPage(p); load(p, search) },
          showTotal: t => `共 ${t} 位會員`,
        }}
        style={{ background: '#16161f' }}
      />
    </>
  )
}
