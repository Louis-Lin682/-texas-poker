import { useEffect, useState } from 'react'
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import AuthEntryPage from './pages/AuthEntryPage'
import BigTwoTablePage from './pages/BigTwoTablePage'
import EventPage from './pages/EventPage'
import GameTablePage from './pages/GameTablePage'
import LedgerPage from './pages/LedgerPage'
import LobbyPage from './pages/LobbyPage'
import NewsPage from './pages/NewsPage'
import QuestPage from './pages/QuestPage'
import RankPage from './pages/RankPage'
import SettingsPage from './pages/SettingsPage'
import ThunderJokerPage from './pages/ThunderJokerPage'
import { useAuth } from './hooks/useAuth'
import { useAudio } from './hooks/useAudio'
import { useGlobalButtonFeedback } from './hooks/useGlobalButtonFeedback'
import { useIdleTimeout } from './hooks/useIdleTimeout'
import { useSupportWs } from './hooks/useSupportWs'
import FloatingButtons from './components/FloatingButtons'
import SupportPage from './pages/SupportPage'

const GAME_ROUTES = ['/table', '/big-two', '/thunder-joker']

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    document.querySelector('.phone-frame')?.scrollTo(0, 0)
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

function App() {
  useGlobalButtonFeedback()
  const auth = useAuth()
  useIdleTimeout(12 * 60 * 60 * 1000, auth.logout, 'idle_frontend')
  const navigate = useNavigate()
  const location = useLocation()
  const [hasEnteredLobby, setHasEnteredLobby] = useState(false)

  const { play, pause, bgmMuted, isMuted, toggleMute, preload } = useAudio()
  const { unreadCount: supportUnread, resetUnread: resetSupportUnread } = useSupportWs({ token: auth.token })

  useEffect(() => {
    preload(['uiClick', 'uiWhoosh', 'lobbyBgm'])
  }, [preload])

  // Play lobby BGM on all non-game pages once the user has entered
  useEffect(() => {
    if (!hasEnteredLobby) return
    if (GAME_ROUTES.includes(location.pathname) || bgmMuted) {
      pause('lobbyBgm')
    } else {
      play('lobbyBgm')
    }
  }, [location.pathname, hasEnteredLobby, bgmMuted, pause, play])

  // Any route other than / or /auth means the user navigated past the intro
  useEffect(() => {
    if (hasEnteredLobby) return
    if (location.pathname === '/' || location.pathname === '/auth') return
    setHasEnteredLobby(true)
  }, [location.pathname, hasEnteredLobby])

  const openAuthPage = () => navigate('/auth')
  const openLobbyPage = () => navigate('/')

  const enterMain = () => {
    if (auth.isAuthenticated) {
      openLobbyPage()
      return
    }
    openAuthPage()
  }

  const handleAuthSuccess = (token) => {
    auth.setToken(token)
    openLobbyPage()
  }

  return (
    <>
    <ScrollToTop />
    <FloatingButtons hidden={!hasEnteredLobby} />
    <Routes>
      <Route
        path="/auth"
        element={<AuthEntryPage onBack={openLobbyPage} onAuthSuccess={handleAuthSuccess} />}
      />
      <Route path="/table" element={<GameTablePage auth={auth} />} />
      <Route path="/big-two" element={<BigTwoTablePage auth={auth} />} />
      <Route path="/thunder-joker" element={<ThunderJokerPage auth={auth} />} />
      <Route path="/ledger" element={<LedgerPage />} />
      <Route path="/rank" element={<RankPage />} />
      <Route path="/event" element={<EventPage />} />
      <Route path="/quest" element={<QuestPage />} />
      <Route path="/news"     element={<NewsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/support"  element={<SupportPage onUnreadChange={resetSupportUnread} />} />
      <Route
        path="/*"
        element={
          <LobbyPage
            auth={auth}
            onGoLogin={enterMain}
            onCenterLogoClick={enterMain}
            hasEnteredLobby={hasEnteredLobby}
            onEnterLobby={() => {
              setHasEnteredLobby(true)
              play('lobbyBgm')
            }}
            play={play}
            pause={pause}
            isMuted={isMuted}
            toggleMute={toggleMute}
            supportUnread={supportUnread}
            onSupportRead={resetSupportUnread}
          />
        }
      />
    </Routes>
    </>
  )
}

export default App
