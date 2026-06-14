import { useEffect, useRef, useState } from 'react'
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import AuthEntryPage from './pages/AuthEntryPage'
import BigTwoTablePage from './pages/BigTwoTablePage'
import BlackjackTablePage from './pages/BlackjackTablePage'
import DragonTigerPage from './pages/DragonTigerPage'
import EventPage from './pages/EventPage'
import GameTablePage from './pages/GameTablePage'
import DepositPage from './pages/DepositPage'
import LedgerPage from './pages/LedgerPage'
import LobbyPage from './pages/LobbyPage'
import NewsPage from './pages/NewsPage'
import QuestPage from './pages/QuestPage'
import RankPage from './pages/RankPage'
import SettingsPage from './pages/SettingsPage'
import ThunderJokerPage from './pages/ThunderJokerPage'
import SupportPage from './pages/SupportPage'
import { useAuth } from './hooks/useAuth'
import { useAudio } from './hooks/useAudio'
import { useGlobalButtonFeedback } from './hooks/useGlobalButtonFeedback'
import { useIdleTimeout } from './hooks/useIdleTimeout'
import { useSupportWs } from './hooks/useSupportWs'
import FloatingButtons from './components/FloatingButtons'
import LoadingOverlay from './components/LoadingOverlay'
import { LoadingProvider, useLoading } from './context/LoadingContext'

const GAME_ROUTES    = ['/table', '/big-two', '/blackjack', '/thunder-joker', '/dragon-tiger']
const NON_LOBBY_PATHS = [
  '/auth', '/table', '/big-two', '/blackjack', '/thunder-joker', '/dragon-tiger',
  '/ledger', '/rank', '/event', '/quest', '/news', '/settings', '/support', '/deposit',
]

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    document.querySelector('.phone-frame')?.scrollTo(0, 0)
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

function RouteChangeWatcher() {
  const location  = useLocation()
  const { show }  = useLoading()
  const prevPath  = useRef(null)

  useEffect(() => {
    const path = location.pathname
    // Navigating TO lobby is instant (keep-alive), no loading needed
    if (path !== '/' && prevPath.current !== path) {
      show()
    }
    prevPath.current = path
  }, [location.pathname, show])

  return null
}

function App() {
  useGlobalButtonFeedback()
  const auth = useAuth()
  useIdleTimeout(12 * 60 * 60 * 1000, auth.logout, 'idle_frontend')
  const navigate = useNavigate()
  const location = useLocation()
  const [hasEnteredLobby, setHasEnteredLobby] = useState(false)

  const { play, pause, bgmMuted, isMuted, toggleMute, preload, setBgmMuted } = useAudio()
  const { unreadCount: supportUnread, resetUnread: resetSupportUnread } = useSupportWs({ token: auth.token })
  const skipBgmEffect = useRef(false)

  const isLobby = !NON_LOBBY_PATHS.some(p => location.pathname === p || location.pathname.startsWith(p + '/'))

  useEffect(() => {
    preload(['uiClick', 'uiWhoosh', 'lobbyBgm'])
  }, [preload])

  useEffect(() => {
    if (!hasEnteredLobby) return
    // Skip when triggered by the Enter button click — that handler already called play()
    if (skipBgmEffect.current) { skipBgmEffect.current = false; return }
    if (GAME_ROUTES.includes(location.pathname) || bgmMuted) {
      pause('lobbyBgm')
    } else {
      play('lobbyBgm')
    }
  }, [location.pathname, hasEnteredLobby, bgmMuted, pause, play])

  useEffect(() => {
    if (hasEnteredLobby) return
    if (location.pathname === '/' || location.pathname === '/auth') return
    setHasEnteredLobby(true)
  }, [location.pathname, hasEnteredLobby])

  const openAuthPage  = () => navigate('/auth')
  const openLobbyPage = () => navigate('/')

  const enterMain = () => {
    if (auth.isAuthenticated) { openLobbyPage(); return }
    openAuthPage()
  }

  const handleAuthSuccess = (token) => {
    auth.setToken(token)
    openLobbyPage()
  }

  return (
    <LoadingProvider>
      <ScrollToTop />
      <RouteChangeWatcher />
      <FloatingButtons hidden={!hasEnteredLobby} />

      {/* Always-mounted lobby — hidden via display:none when on other routes */}
      <div style={{ display: isLobby ? 'block' : 'none', height: '100%' }}>
        <LobbyPage
          auth={auth}
          onGoLogin={enterMain}
          onCenterLogoClick={enterMain}
          hasEnteredLobby={hasEnteredLobby}
          onEnterLobby={() => {
            skipBgmEffect.current = true  // prevent BGM effect from firing pause()
            setBgmMuted(false)            // always start with sound on entry
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
      </div>

      {/* All other routes — unmount when leaving */}
      {!isLobby && (
        <Routes>
          <Route path="/auth"          element={<AuthEntryPage onBack={openLobbyPage} onAuthSuccess={handleAuthSuccess} />} />
          <Route path="/table"         element={<GameTablePage auth={auth} />} />
          <Route path="/big-two"       element={<BigTwoTablePage auth={auth} />} />
          <Route path="/blackjack"     element={<BlackjackTablePage auth={auth} />} />
          <Route path="/dragon-tiger"  element={<DragonTigerPage auth={auth} />} />
          <Route path="/thunder-joker" element={<ThunderJokerPage auth={auth} />} />
          <Route path="/deposit"        element={<DepositPage auth={auth} />} />
          <Route path="/ledger"        element={<LedgerPage />} />
          <Route path="/rank"          element={<RankPage />} />
          <Route path="/event"         element={<EventPage />} />
          <Route path="/quest"         element={<QuestPage />} />
          <Route path="/news"          element={<NewsPage />} />
          <Route path="/settings"      element={<SettingsPage />} />
          <Route path="/support"       element={<SupportPage onUnreadChange={resetSupportUnread} />} />
        </Routes>
      )}

      <LoadingOverlay />
    </LoadingProvider>
  )
}

export default App
