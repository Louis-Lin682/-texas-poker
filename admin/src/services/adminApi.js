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
}
