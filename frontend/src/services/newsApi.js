import { apiRequest } from './apiClient'

export function getNews() {
  return apiRequest('/news')
}
