import { apiRequest } from './apiClient'

const TOKEN_KEY = 'texas_holdem_auth_token'

function authOpts() {
  const token = localStorage.getItem(TOKEN_KEY)
  return token ? { headers: { Authorization: `Bearer ${token}` } } : {}
}

export const getLotteryGames  = ()      => apiRequest('/lottery/games')
export const getCurrentDraw   = (slug)  => apiRequest(`/lottery/current?slug=${slug}`)
export const getResults       = (slug, limit = 10) => apiRequest(`/lottery/results?slug=${slug}&limit=${limit}`)
export const getMyBets        = ()      => apiRequest('/lottery/bets', authOpts())
export const placeBet         = (body)  => apiRequest('/lottery/bet', {
  method: 'POST', ...authOpts(), body: JSON.stringify(body),
})
