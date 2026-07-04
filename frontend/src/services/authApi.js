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

export function guestLogin() {
  return apiRequest('/auth/guest', { method: 'POST' })
}

export function patchAvatar(token, avatar) {
  return apiRequest('/me/avatar', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ avatar }),
  })
}
