import { apiRequest } from './apiClient'

export function getMe(token) {
  return apiRequest('/me', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
}

export function login(payload) {
  return apiRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function register(payload) {
  return apiRequest('/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
