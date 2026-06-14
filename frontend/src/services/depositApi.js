import { apiRequest } from './apiClient'

const TOKEN_KEY = 'texas_holdem_auth_token'

function authOpts() {
  const token = localStorage.getItem(TOKEN_KEY)
  return token ? { headers: { Authorization: `Bearer ${token}` } } : {}
}

export function postDeposit(amount) {
  return apiRequest('/deposit', {
    method: 'POST',
    ...authOpts(),
    body: JSON.stringify({ amount }),
  })
}
