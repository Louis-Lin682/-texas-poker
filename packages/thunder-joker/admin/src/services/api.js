const BASE = '/admin'

function token() { return localStorage.getItem('tj_admin_token') ?? '' }

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token()}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message ?? res.statusText)
  return data
}

export const api = {
  login:            (body)         => req('POST', '/login',            body),
  getConfig:        ()             => req('GET',  '/config'),
  putConfig:        (body)         => req('PUT',  '/config',           body),
  getConfigHistory: ()             => req('GET',  '/config/history'),
  getRtp:           ()             => req('GET',  '/rtp'),
  getMembers:       (params = {})  => req('GET',  '/members?' + new URLSearchParams(params)),
  putMember:        (id, body)     => req('PUT',  `/members/${id}`,    body),
  getLedger:        (params = {})  => req('GET',  '/ledger?'  + new URLSearchParams(params)),
  getAccounts:      ()             => req('GET',  '/accounts'),
  postAccount:      (body)         => req('POST', '/accounts',         body),
}
