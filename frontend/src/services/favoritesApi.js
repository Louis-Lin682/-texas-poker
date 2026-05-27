import { apiRequest } from './apiClient'

function withAuth(token) {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }
}

export function getFavorites(token) {
  return apiRequest('/favorites', withAuth(token))
}

export function addFavorite(token, gameId) {
  return apiRequest(`/favorites/${gameId}`, {
    method: 'POST',
    ...withAuth(token),
  })
}

export function removeFavorite(token, gameId) {
  return apiRequest(`/favorites/${gameId}`, {
    method: 'DELETE',
    ...withAuth(token),
  })
}
