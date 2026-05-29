import { apiRequest } from './apiClient'

const TOKEN_KEY = 'texas_holdem_auth_token'

function authOpts() {
  const token = localStorage.getItem(TOKEN_KEY)
  return token ? { headers: { Authorization: `Bearer ${token}` } } : {}
}

export function getQuests() {
  return apiRequest('/quests', authOpts())
}

export function claimQuest(id) {
  return apiRequest(`/quests/${id}/claim`, { method: 'POST', ...authOpts() })
}
