import { useState } from 'react'
import DragonTigerPage from './pages/DragonTigerPage.jsx'
import LoginPage from './pages/LoginPage.jsx'

const TOKEN_KEY = 'dt_auth_token'

export default function App() {
  const [authed, setAuthed] = useState(Boolean(localStorage.getItem(TOKEN_KEY)))

  if (!authed) {
    return <LoginPage onLogin={() => setAuthed(true)} />
  }
  return <DragonTigerPage onLogout={() => { localStorage.removeItem(TOKEN_KEY); setAuthed(false) }} />
}
