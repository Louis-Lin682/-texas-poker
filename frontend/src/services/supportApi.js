import { apiRequest } from './apiClient'

const TOKEN_KEY = 'texas_holdem_auth_token'
const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY)}` } })

export const getUnreadCount    = ()        => apiRequest('/support/unread', auth())
export const getTickets        = ()        => apiRequest('/support/tickets', auth())
export const createTicket      = (body)    => apiRequest('/support/tickets', { method: 'POST', body: JSON.stringify(body), ...auth() })
export const getMessages       = (id)      => apiRequest(`/support/tickets/${id}/messages`, auth())
export const sendMessage       = (id, content) =>
  apiRequest(`/support/tickets/${id}/messages`, { method: 'POST', body: JSON.stringify({ content }), ...auth() })
export const deleteTicket      = (id) =>
  apiRequest(`/support/tickets/${id}`, { method: 'DELETE', ...auth() })
