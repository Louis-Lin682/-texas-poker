const BASE = import.meta.env.VITE_API_URL ?? ''

async function request(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
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
  login:    (username, password)  => request('POST', '/auth/login',    { username, password }),
  register: (username, password)  => request('POST', '/auth/register', { username, password }),
  me:       (token)               => request('GET',  '/auth/me', null, token),
}
