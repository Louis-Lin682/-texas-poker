import { apiRequest } from './apiClient'

export function getEvents() {
  return apiRequest('/events')
}
