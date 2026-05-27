import { apiRequest } from './apiClient'

export function getGames() {
  return apiRequest('/games')
}

export function getConfig() {
  return apiRequest('/config')
}

export function getRank(period, token) {
  return apiRequest(`/rank?period=${period}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {})
}
