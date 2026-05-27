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
import ThunderJokerPage from './pages/ThunderJokerPage'
import { useAuth } from './hooks/useAuth'
import { useGlobalButtonFeedback } from './hooks/useGlobalButtonFeedback'
import FloatingButtons from './components/FloatingButtons'

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
  const navigate = useNavigate()
  const location = useLocation()
  const [hasEnteredLobby, setHasEnteredLobby] = useState(
    () => sessionStorage.getItem('lobby_entered') === '1'
  )

  // Any route other than / or /auth means the user has already passed the intro
  useEffect(() => {
    if (hasEnteredLobby) return
    if (location.pathname === '/' || location.pathname === '/auth') return
    sessionStorage.setItem('lobby_entered', '1')
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
    <FloatingButtons />
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
      <Route path="/news" element={<NewsPage />} />
      <Route
        path="/*"
        element={
          <LobbyPage
            auth={auth}
            onGoLogin={enterMain}
            onCenterLogoClick={enterMain}
            hasEnteredLobby={hasEnteredLobby}
            onEnterLobby={() => {
              sessionStorage.setItem('lobby_entered', '1')
              setHasEnteredLobby(true)
            }}
          />
        }
      />
    </Routes>
    </>
  )
}

export default App
