import { useEffect, useRef, useState } from 'react'
import { Badge, Button, Input, InputNumber, Select, Spin, Tag, Typography } from 'antd'
import { adminApi } from '../services/adminApi'

const { Text } = Typography
const { TextArea } = Input

const CAT_COLOR = {
  '帳號問題': 'blue',
  '儲值問題': 'gold',
  '遊戲問題': 'green',
  '其他問題': 'purple',
}

function fmt(d) {
  const dt = new Date(d)
  return `${dt.getMonth()+1}/${dt.getDate()} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`
}

function ticketNo(n) {
  return n ? `#${String(n).padStart(5, '0')}` : '—'
}

export default function AdminSupportPage() {
  const [tickets, setTickets]         = useState([])
  const [filter, setFilter]           = useState('')
  const [searchNum, setSearchNum]     = useState('')
  const [loading, setLoading]         = useState(true)
  const [active, setActive]           = useState(null)
  const [messages, setMessages]       = useState([])
  const [reply, setReply]             = useState('')
  const [sending, setSending]         = useState(false)
  const [autoCloseDays, setAutoCloseDays] = useState(7)
  const [savingConfig, setSavingConfig]   = useState(false)
  const bottomRef = useRef(null)

  async function fetchTickets() {
    setLoading(true)
    try {
      const params = {}
      if (filter)    params.status        = filter
      if (searchNum) params.ticket_number = searchNum.replace(/^#/, '')
      const d = await adminApi.getSupportTickets(params)
      setTickets(d.tickets)
    } finally { setLoading(false) }
  }

  useEffect(() => { fetchTickets() }, [filter, searchNum])

  useEffect(() => {
    adminApi.getSupportConfig().then(d => setAutoCloseDays(d.auto_close_days)).catch(() => {})
  }, [])

  async function saveConfig() {
    setSavingConfig(true)
    try {
      await adminApi.updateSupportConfig({ auto_close_days: autoCloseDays })
    } finally { setSavingConfig(false) }
  }

  async function openTicket(t) {
    setActive(t)
    const d = await adminApi.getSupportMessages(t.id)
    setMessages(d.messages)
    setActive(d.ticket)
    fetchTickets()
  }

  useEffect(() => {
    if (!active) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!active) return
    const id = setInterval(async () => {
      const d = await adminApi.getSupportMessages(active.id).catch(() => null)
      if (d) setMessages(d.messages)
    }, 5000)
    return () => clearInterval(id)
  }, [active?.id])

  async function handleReply() {
    if (!reply.trim() || sending) return
    setSending(true)
    try {
      const d = await adminApi.replySupportTicket(active.id, reply.trim())
      setMessages(m => [...m, d.message])
      setReply('')
      fetchTickets()
    } finally { setSending(false) }
  }

  async function handleToggleStatus() {
    const next = active.status === 'open' ? 'closed' : 'open'
    const d = await adminApi.setSupportStatus(active.id, next)
    setActive(d.ticket)
    fetchTickets()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)', gap: 12 }}>

      {/* Auto-close config bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', borderRadius: 8,
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
      }}>
        <Text style={{ fontSize: 13, color: '#aaa' }}>自動結案設定：超過</Text>
        <InputNumber
          min={0} max={365} value={autoCloseDays}
          onChange={v => setAutoCloseDays(v ?? 0)}
          style={{ width: 70 }}
          size="small"
        />
        <Text style={{ fontSize: 13, color: '#aaa' }}>天無回應自動結案（0 = 關閉）</Text>
        <Button size="small" type="primary" loading={savingConfig} onClick={saveConfig}>
          儲存
        </Button>
      </div>

      {/* Main panel */}
      <div style={{ flex: 1, display: 'flex', gap: 16, overflow: 'hidden' }}>

        {/* Ticket list */}
        <div style={{ width: 320, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Text strong style={{ fontSize: 14 }}>客服工單</Text>
            <Select
              size="small" value={filter} onChange={v => { setSearchNum(''); setFilter(v) }} style={{ width: 90 }}
              options={[
                { value: '', label: '全部' },
                { value: 'open', label: '處理中' },
                { value: 'closed', label: '已結案' },
              ]}
            />
            <Input
              size="small"
              placeholder="工單編號"
              value={searchNum}
              onChange={e => { setFilter(''); setSearchNum(e.target.value.replace(/[^0-9#]/g, '')) }}
              allowClear
              style={{ width: 100 }}
            />
            <Button size="small" onClick={fetchTickets}>刷新</Button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {loading && <Spin style={{ margin: '20px auto' }} />}
            {tickets.map(t => (
              <div
                key={t.id}
                onClick={() => openTicket(t)}
                style={{
                  padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                  background: active?.id === t.id ? 'rgba(196,144,16,0.15)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${active?.id === t.id ? 'rgba(196,144,16,0.4)' : 'rgba(255,255,255,0.07)'}`,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <Text style={{ fontSize: 11, color: '#c49010', fontWeight: 600 }}>
                      {ticketNo(t.ticket_number)}
                    </Text>
                    <Tag color={CAT_COLOR[t.category] ?? 'default'} style={{ margin: 0, fontSize: 11 }}>
                      {t.category}
                    </Tag>
                    <Tag color={t.status === 'open' ? 'processing' : 'default'} style={{ margin: 0, fontSize: 11 }}>
                      {t.status === 'open' ? '處理中' : '已結案'}
                    </Tag>
                  </div>
                  {parseInt(t.unread_count) > 0 && <Badge count={t.unread_count} size="small" />}
                </div>
                <Text style={{ fontSize: 13, display: 'block', marginBottom: 2 }}>{t.username}</Text>
                {t.last_message && (
                  <Text type="secondary" style={{ fontSize: 11, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.last_message}
                  </Text>
                )}
                <Text type="secondary" style={{ fontSize: 10 }}>{fmt(t.updated_at)}</Text>
              </div>
            ))}
          </div>
        </div>

        {/* Chat panel */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.07)', overflow: 'hidden' }}>
          {!active ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Text type="secondary">選擇左側工單以查看對話</Text>
            </div>
          ) : (
            <>
              {/* Header */}
              <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Text style={{ fontSize: 12, color: '#c49010', fontWeight: 700 }}>
                    {ticketNo(active.ticket_number)}
                  </Text>
                  <Tag color={CAT_COLOR[active.category] ?? 'default'}>{active.category}</Tag>
                  <Text strong>{active.username}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>{fmt(active.created_at)}</Text>
                </div>
                <Button
                  size="small"
                  type={active.status === 'open' ? 'default' : 'primary'}
                  onClick={handleToggleStatus}
                >
                  {active.status === 'open' ? '標記結案' : '重新開啟'}
                </Button>
              </div>

              {/* Messages */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {messages.map(m => (
                  <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: m.sender_type === 'admin' ? 'flex-end' : 'flex-start' }}>
                    <Text type="secondary" style={{ fontSize: 11, marginBottom: 2 }}>
                      {m.sender_type === 'admin' ? '客服' : active.username} · {fmt(m.created_at)}
                    </Text>
                    <div style={{
                      maxWidth: '75%', padding: '8px 12px', fontSize: 13, lineHeight: 1.5,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      borderRadius: m.sender_type === 'admin' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                      background: m.sender_type === 'admin' ? 'rgba(196,144,16,0.25)' : 'rgba(255,255,255,0.08)',
                      border: `1px solid ${m.sender_type === 'admin' ? 'rgba(196,144,16,0.3)' : 'rgba(255,255,255,0.1)'}`,
                    }}>
                      {m.content}
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              {/* Reply */}
              {active.status === 'open' && (
                <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', gap: 8 }}>
                  <TextArea
                    value={reply} onChange={e => setReply(e.target.value)}
                    placeholder="輸入回覆…" autoSize={{ minRows: 1, maxRows: 4 }}
                    onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); handleReply() } }}
                    style={{ flex: 1 }}
                  />
                  <Button type="primary" onClick={handleReply} loading={sending} disabled={!reply.trim()}>
                    回覆
                  </Button>
                </div>
              )}
              {active.status === 'closed' && (
                <div style={{ padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,0.07)', textAlign: 'center' }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>此工單已結案</Text>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
