const BASE = import.meta.env.VITE_API_URL ?? ''
const TOKEN_KEY = 'th_admin_token'

function token() { return localStorage.getItem(TOKEN_KEY) ?? '' }

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || res.statusText)
  return data
}

export const api = {
  login:      (username, password) => fetch(`${BASE}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  }).then(r => r.json().then(d => { if (!r.ok) throw new Error(d.message); return d })),

  getMembers:  (params = {})       => request('GET',  `/admin/members?${new URLSearchParams(params)}`),
  putMember:   (id, body)          => request('PUT',  `/admin/members/${id}`, body),
  getLedger:   (params = {})       => request('GET',  `/admin/ledger?${new URLSearchParams(params)}`),
  getAccounts: ()                  => request('GET',  '/admin/accounts'),
  postAccount: (body)              => request('POST', '/admin/accounts', body),
}
