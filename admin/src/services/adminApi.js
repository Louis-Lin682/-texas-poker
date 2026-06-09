export const BASE = (import.meta.env.VITE_API_URL ?? '') + '/admin'
const TOKEN_KEY = 'admin_token'

export function getToken() { return localStorage.getItem(TOKEN_KEY) }
export function setToken(t) { localStorage.setItem(TOKEN_KEY, t) }
export function clearToken() { localStorage.removeItem(TOKEN_KEY) }

async function req(path, options = {}) {
  const token = getToken()
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const data = await res.json()
  if (!res.ok) throw Object.assign(new Error(data.message || 'Error'), { status: res.status })
  return data
}

export const adminApi = {
  login:  (username, password) => req('/auth/login',  { method: 'POST', body: { username, password } }),
  logout: ()                   => req('/auth/logout', { method: 'POST' }),

  getMembers:      (params = {}) => req('/members?' + new URLSearchParams(params)),
  getMember:       (id)          => req(`/members/${id}`),
  updateMember:    (id, body)    => req(`/members/${id}`, { method: 'PATCH', body }),
  suspendMember:   (id)          => req(`/members/${id}/suspend`,   { method: 'POST' }),
  unsuspendMember: (id)          => req(`/members/${id}/unsuspend`, { method: 'POST' }),

  getMemberLedger: (id, params = {}) => {
    const p = Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
    return req(`/members/${id}/ledger?` + new URLSearchParams(p))
  },

  getReports: (params = {}) => {
    const p = Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
    return req('/reports?' + new URLSearchParams(p))
  },

  getEvents:     ()           => req('/events'),
  createEvent:   (body)       => req('/events',              { method: 'POST',   body }),
  updateEvent:   (id, body)   => req(`/events/${id}`,        { method: 'PUT',    body }),
  deleteEvent:   (id)         => req(`/events/${id}`,        { method: 'DELETE' }),
  toggleEvent:   (id)         => req(`/events/${id}/toggle`, { method: 'PATCH'  }),
  reorderEvents: (orders)     => req('/events/reorder',      { method: 'PATCH',  body: { orders } }),

  getQuests:     ()           => req('/quests'),
  createQuest:   (body)       => req('/quests',              { method: 'POST',   body }),
  updateQuest:   (id, body)   => req(`/quests/${id}`,        { method: 'PUT',    body }),
  deleteQuest:   (id)         => req(`/quests/${id}`,        { method: 'DELETE' }),
  toggleQuest:   (id)         => req(`/quests/${id}/toggle`, { method: 'PATCH'  }),
  reorderQuests: (orders)     => req('/quests/reorder',      { method: 'PATCH',  body: { orders } }),

  getNews:     ()           => req('/news'),
  createNews:  (body)       => req('/news',              { method: 'POST',   body }),
  updateNews:  (id, body)   => req(`/news/${id}`,        { method: 'PUT',    body }),
  deleteNews:  (id)         => req(`/news/${id}`,        { method: 'DELETE' }),
  toggleNews:  (id)         => req(`/news/${id}/toggle`, { method: 'PATCH'  }),

  getAnnouncements:      ()           => req('/announcements'),
  createAnnouncement:    (body)       => req('/announcements',              { method: 'POST',   body }),
  updateAnnouncement:    (id, body)   => req(`/announcements/${id}`,        { method: 'PUT',    body }),
  deleteAnnouncement:    (id)         => req(`/announcements/${id}`,        { method: 'DELETE' }),
  toggleAnnouncement:    (id)         => req(`/announcements/${id}/toggle`, { method: 'PATCH'  }),

  getSupportUnread:   ()            => req('/support/unread'),
  getSupportConfig:   ()            => req('/support/config'),
  updateSupportConfig:(body)        => req('/support/config', { method: 'PATCH', body }),
  getSupportTickets: (params = {}) => req('/support/tickets?' + new URLSearchParams(params)),
  getSupportMessages:(id)          => req(`/support/tickets/${id}/messages`),
  replySupportTicket:(id, content) => req(`/support/tickets/${id}/messages`, { method: 'POST', body: { content } }),
  setSupportStatus:  (id, status)  => req(`/support/tickets/${id}/status`,   { method: 'PATCH', body: { status } }),
}
