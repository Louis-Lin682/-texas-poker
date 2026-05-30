import { useEffect, useRef, useState, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import PageShell from '../components/PageShell'
import VipPageHeader from '../components/VipPageHeader'
import { createTicket, deleteTicket, getMessages, getTickets, sendMessage } from '../services/supportApi'
import { usePageReady } from '../hooks/usePageReady'

const TOKEN_KEY = 'texas_holdem_auth_token'

const CATEGORIES = ['帳號問題', '儲值問題', '遊戲問題', '其他問題']

const CAT_COLOR = {
  '帳號問題': '#7baee8',
  '儲值問題': '#f3c15d',
  '遊戲問題': '#6dd47e',
  '其他問題': '#b0a0cc',
}

function fmt(dateStr) {
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function ticketNo(n) {
  return n ? `#${String(n).padStart(5, '0')}` : ''
}

function CategoryBadge({ cat }) {
  return (
    <span className="cs-cat-badge" style={{ '--cat-color': CAT_COLOR[cat] ?? '#aaa' }}>
      {cat}
    </span>
  )
}


function DeleteConfirmModal({ isOpen, onConfirm, onCancel }) {
  if (!isOpen) return null
  return (
    <div className="cs-modal-overlay" onClick={onCancel}>
      <div className="cs-modal" onClick={e => e.stopPropagation()}>
        <p className="cs-modal-text">確定要刪除此問題紀錄嗎？</p>
        <div className="cs-modal-actions">
          <button type="button" className="cs-modal-cancel" onClick={onCancel}>取消</button>
          <button type="button" className="cs-modal-confirm" onClick={onConfirm}>確認刪除</button>
        </div>
      </div>
    </div>
  )
}

const SWIPE_OPEN = -76

function SwipeRow({ onDelete, onClick, closeSignal, children }) {
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startX = useRef(0)
  const startOffset = useRef(0)

  useEffect(() => {
    if (closeSignal > 0) setOffset(0)
  }, [closeSignal])

  const onTouchStart = useCallback((e) => {
    startX.current = e.touches[0].clientX
    startOffset.current = offset
    setDragging(true)
  }, [offset])

  const onTouchMove = useCallback((e) => {
    const dx = e.touches[0].clientX - startX.current
    setOffset(Math.min(0, Math.max(SWIPE_OPEN, startOffset.current + dx)))
  }, [])

  const onTouchEnd = useCallback(() => {
    setDragging(false)
    setOffset(prev => prev < SWIPE_OPEN / 2 ? SWIPE_OPEN : 0)
  }, [])

  function handleClick() {
    if (offset < -10) { setOffset(0); return }
    onClick()
  }

  return (
    <div className="cs-swipe-wrapper">
      <div
        className={`cs-swipe-track${dragging ? ' is-dragging' : ''}`}
        style={{ transform: `translateX(${offset}px)` }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className="cs-swipe-card" onClick={handleClick}>
          {children}
        </div>
        <button type="button" className="cs-swipe-delete" onClick={e => { e.stopPropagation(); onDelete() }}>
          刪除
        </button>
      </div>
    </div>
  )
}

function NewTicketForm({ onSubmit, onBack, loading }) {
  const [category, setCategory] = useState(CATEGORIES[0])
  const [content, setContent] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    if (!content.trim()) return
    onSubmit({ category, subject: category, content })
  }

  return (
    <div className="cs-new-form">
      <button type="button" className="cs-back-btn" onClick={onBack}>← 返回</button>
      <h3 className="cs-form-title">新增問題</h3>

      <div className="cs-form-field">
        <label className="cs-field-label">問題類別</label>
        <div className="cs-cat-pills">
          {CATEGORIES.map(c => (
            <button
              key={c}
              type="button"
              className={`cs-cat-pill ${category === c ? 'is-active' : ''}`}
              style={{ '--cat-color': CAT_COLOR[c] }}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="cs-form-field">
        <label className="cs-field-label">問題描述</label>
        <textarea
          className="cs-textarea"
          placeholder="請描述您的問題…"
          value={content}
          onChange={e => setContent(e.target.value)}
          rows={5}
        />
      </div>

      <button
        type="button"
        className="cs-submit-btn"
        disabled={!content.trim() || loading}
        onClick={handleSubmit}
      >
        {loading ? '送出中…' : '送出問題'}
      </button>
    </div>
  )
}

function ChatView({ ticket, onBack, onNewMessage }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [closed, setClosed] = useState(ticket.status === 'closed')
  const bottomRef = useRef(null)

  useEffect(() => {
    getMessages(ticket.id)
      .then(d => { setMessages(d.messages); setClosed(d.ticket.status === 'closed') })
      .catch(() => {})
  }, [ticket.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const id = setInterval(() => {
      getMessages(ticket.id)
        .then(d => setMessages(d.messages))
        .catch(() => {})
    }, 5000)
    return () => clearInterval(id)
  }, [ticket.id])

  async function handleSend() {
    if (!input.trim() || sending) return
    setSending(true)
    try {
      const { message } = await sendMessage(ticket.id, input.trim())
      setMessages(m => [...m, message])
      setInput('')
      onNewMessage?.()
    } catch {}
    finally { setSending(false) }
  }

  return (
    <div className="cs-chat">
      <div className="cs-chat-header">
        <button type="button" className="cs-back-btn" onClick={onBack}>← 返回</button>
        <div className="cs-chat-title">
          {ticket.ticket_number && (
            <span className="cs-ticket-number">{ticketNo(ticket.ticket_number)}</span>
          )}
          <CategoryBadge cat={ticket.category} />
          <span className={`cs-ticket-status ${closed ? 'is-closed' : 'is-open'}`}>
            {closed ? '已結案' : '處理中'}
          </span>
        </div>
      </div>

      <div className="cs-messages">
        <div className="cs-msg-hint">客服通常在 24 小時內回覆</div>
        {messages.map(m => (
          <div key={m.id} className={`cs-msg ${m.sender_type === 'user' ? 'is-user' : 'is-admin'}`}>
            {m.sender_type === 'admin' && (
              <span className="cs-msg-label">客服</span>
            )}
            <div className="cs-msg-bubble">{m.content}</div>
            <span className="cs-msg-time">{fmt(m.created_at)}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {!closed && (
        <div className="cs-input-row">
          <input
            className="cs-input"
            placeholder="輸入訊息…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          />
          <button
            type="button"
            className="cs-send-btn"
            disabled={!input.trim() || sending}
            onClick={handleSend}
          >
            送出
          </button>
        </div>
      )}
      {closed && <p className="cs-closed-note">此問題已結案，如需協助請新增問題。</p>}
    </div>
  )
}

export default function SupportPage({ onUnreadChange }) {
  const isAuth = Boolean(localStorage.getItem(TOKEN_KEY))
  const [view, setView] = useState('list')
  const [tickets, setTickets] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [activeTicket, setActiveTicket] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState(null)
  const [swipeCloseSignal, setSwipeCloseSignal] = useState(0)
  usePageReady(loaded || !isAuth)
  const location = useLocation()

  async function confirmDelete() {
    const id = pendingDeleteId
    setPendingDeleteId(null)
    try {
      await deleteTicket(id)
      setTickets(prev => prev.filter(t => t.id !== id))
    } catch {}
  }

  function cancelDelete() {
    setPendingDeleteId(null)
    setSwipeCloseSignal(s => s + 1)
  }

  useEffect(() => {
    if (!isAuth) return
    getTickets().then(d => setTickets(d.tickets)).catch(() => {}).finally(() => setLoaded(true))
  }, [isAuth])

  useEffect(() => {
    if (location.state?.ticketId && tickets.length > 0) {
      const t = tickets.find(x => x.id === location.state.ticketId)
      if (t) { setActiveTicket(t); setView('chat') }
    }
  }, [location.state, tickets])

  async function handleNewTicket(data) {
    setSubmitting(true)
    try {
      const { ticket } = await createTicket(data)
      const fresh = await getTickets()
      setTickets(fresh.tickets)
      const fullTicket = fresh.tickets.find(t => t.id === ticket.id) ?? ticket
      setActiveTicket(fullTicket)
      setView('chat')
    } catch {}
    finally { setSubmitting(false) }
  }

  function handleBackFromChat() {
    getTickets().then(d => setTickets(d.tickets)).catch(() => {})
    onUnreadChange?.()
    setView('list')
    setActiveTicket(null)
  }

  return (
    <PageShell title="" accent="#D9A441" bodyClassName="cs-body-fixed">
      <VipPageHeader title="客服中心" eyebrow="SUPPORT" />

      {!isAuth && (
        <p className="quest-empty">請先登入以使用客服功能</p>
      )}

      {isAuth && view === 'list' && (
        <div className="cs-list-shell">
          <div className="cs-list-actions">
            <button type="button" className="cs-new-btn" onClick={() => setView('new')}>
              + 新增問題
            </button>
          </div>
          <div className="cs-list-scroll">
            {tickets.length === 0 && <p className="cs-empty">尚無問題紀錄</p>}
            {tickets.map(t => (
              <SwipeRow
                key={t.id}
                closeSignal={swipeCloseSignal}
                onDelete={() => setPendingDeleteId(t.id)}
                onClick={() => { setActiveTicket(t); setView('chat') }}
              >
                <div className="cs-ticket-row">
                  <div className="cs-ticket-row-top">
                    {t.ticket_number && (
                      <span className="cs-ticket-number">{ticketNo(t.ticket_number)}</span>
                    )}
                    <CategoryBadge cat={t.category} />
                    <span className={`cs-ticket-status ${t.status === 'closed' ? 'is-closed' : 'is-open'}`}>
                      {t.status === 'closed' ? '已結案' : '處理中'}
                    </span>
                  </div>
                  <div className="cs-ticket-subject">{t.subject}</div>
                  {t.last_message && <div className="cs-ticket-preview">{t.last_message}</div>}
                  <div className="cs-ticket-row-bottom">
                    <span className="cs-ticket-time">{fmt(t.updated_at)}</span>
                    {parseInt(t.unread_count) > 0 && (
                      <span className="cs-unread-dot">{t.unread_count}</span>
                    )}
                  </div>
                </div>
              </SwipeRow>
            ))}
          </div>
        </div>
      )}

      {isAuth && view === 'new' && (
        <div className="cs-list-scroll">
          <NewTicketForm
            onBack={() => setView('list')}
            onSubmit={handleNewTicket}
            loading={submitting}
          />
        </div>
      )}

      {isAuth && view === 'chat' && activeTicket && (
        <ChatView
          ticket={activeTicket}
          onBack={handleBackFromChat}
          onNewMessage={onUnreadChange}
        />
      )}
      <DeleteConfirmModal
        isOpen={pendingDeleteId !== null}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
    </PageShell>
  )
}
