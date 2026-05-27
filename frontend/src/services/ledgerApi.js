import { apiRequest } from './apiClient'

export function getLedger(token, { limit = 100, offset = 0, game, dateFrom, dateTo } = {}) {
  const params = new URLSearchParams({ limit, offset })
  if (game)     params.set('game', game)
  if (dateFrom) params.set('date_from', dateFrom)
  if (dateTo)   params.set('date_to', dateTo)
  return apiRequest(`/ledger?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}
