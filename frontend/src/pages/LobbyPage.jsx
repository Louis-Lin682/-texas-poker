import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AllGamesSection from '../components/AllGamesSection'
import AuthPromptModal from '../components/AuthPromptModal'
import EnterGameModal from '../components/EnterGameModal'
import CheckInModal from '../components/CheckInModal'
import GuestBanner from '../components/GuestBanner'
import BottomNav from '../components/BottomNav'
import EventDrawer from '../components/EventDrawer'
import FavoritesDrawer from '../components/FavoritesDrawer'
import GameModal from '../components/GameModal'
import GameSection from '../components/GameSection'
import BannerCarousel from '../components/BannerCarousel'
import LobbyIntroModal from '../components/LobbyIntroModal'
import LogoutConfirmModal from '../components/LogoutConfirmModal'
import SpaceBackground from '../components/SpaceBackground'
import MyDrawer from '../components/MyDrawer'
import NoticeTicker from '../components/NoticeTicker'
import ProfileCard from '../components/ProfileCard'
import QuickActions from '../components/QuickActions'
import {
  bottomNavItems,
  quickActions,
} from '../data/lobbyData'
import { useFavorites } from '../hooks/useFavorites'
import { useGames } from '../hooks/useGames'
import { getConfig } from '../services/gamesApi'
import { API_BASE_URL } from '../services/apiClient'

function LobbyPage({ auth, onGoLogin, onCenterLogoClick, hasEnteredLobby, onEnterLobby, play, pause, isMuted, toggleMute, supportUnread, onSupportRead }) {
  const navigate = useNavigate()
  const [selectedGame, setSelectedGame] = useState(null)
  const [isCheckInOpen, setIsCheckInOpen] = useState(false)
  const [isAuthPromptOpen, setIsAuthPromptOpen] = useState(false)
  const [authPromptContext, setAuthPromptContext] = useState('default')
  const [isEnterGameOpen, setIsEnterGameOpen] = useState(false)
  const [pendingGame, setPendingGame] = useState(null)
  const [isFavoritesOpen, setIsFavoritesOpen] = useState(false)
  const [isMyDrawerOpen, setIsMyDrawerOpen] = useState(false)
  const [isEventDrawerOpen, setIsEventDrawerOpen] = useState(false)
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false)
  const { games, featuredGames, isLoadingGames } = useGames()
  const [minBuyIn, setMinBuyIn] = useState(() => {
    const cached = localStorage.getItem('cfg_min_buy_in')
    return cached ? parseInt(cached, 10) : 3000
  })
  const [showFloatTop, setShowFloatTop] = useState(false)
  const [marqueeText, setMarqueeText] = useState('')

  useEffect(() => {
    fetch(`${API_BASE_URL}/announcements`)
      .then(r => r.json())
      .then(d => {
        const items = d.announcements ?? []
        if (items.length > 0) setMarqueeText(items.map(a => a.content).join('　　◆　　'))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    getConfig().then(cfg => {
      if (cfg.minBuyIn) {
        setMinBuyIn(cfg.minBuyIn)
        localStorage.setItem('cfg_min_buy_in', String(cfg.minBuyIn))
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const frame = document.querySelector('.phone-frame-lobby')
    const check = () => {
      const top = (frame?.scrollTop ?? 0) + window.scrollY
      setShowFloatTop(top > 80)
    }
    frame?.addEventListener('scroll', check, { passive: true })
    window.addEventListener('scroll', check, { passive: true })
    return () => {
      frame?.removeEventListener('scroll', check)
      window.removeEventListener('scroll', check)
    }
  }, [])
  const openAuthPrompt = (context = 'default') => {
    setAuthPromptContext(context)
    setIsAuthPromptOpen(true)
  }

  const { favoriteIds, toggleFavorite } = useFavorites({
    isAuthenticated: auth.isAuthenticated,
    token: auth.token,
    onRequireLogin: () => openAuthPrompt('favorite'),
  })

  useEffect(() => {
    if (auth.isAuthenticated) auth.refreshUser()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handlePlayGame = (game) => {
    if (!game?.route) return
    setSelectedGame(null)
    if (game.directRoute) {
      pause('lobbyBgm')
      navigate(game.route, { state: { gameSlug: game.slug } })
      return
    }
    setPendingGame(game)
    setIsEnterGameOpen(true)
  }

  const profile = {
    id: auth.user?.id ?? '',
    account: auth.user?.username ?? '',
    balance: new Intl.NumberFormat('en-US').format(auth.user?.balance ?? 0),
    vip: auth.isAuthenticated ? 'VIP 1' : 'GUEST',
  }

  const navItems = bottomNavItems.map((item) =>
    item.type === 'image'
      ? {
          ...item,
          label: auth.isAuthenticated ? '遊戲大廳' : '登入 / 註冊',
        }
      : item,
  )
    const handleTopClick = () => {
    document.querySelector('.phone-frame')?.scrollTo({ top: 0, behavior: 'smooth' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div
      className={`app-shell ${isFavoritesOpen || isMyDrawerOpen || isEventDrawerOpen ? 'has-favorites-open' : ''}`}
    >
      <SpaceBackground />

      {/* {showFloatTop && (
        <button
          type="button"
          className="float-btn float-top"
          onClick={handleTopClick}
          aria-label="回頂部"
        >
          <img src="/top.png" alt="" />
        </button>
      )} */}
      <div className="phone-frame phone-frame-lobby">
        <NoticeTicker text={marqueeText} isMuted={isMuted} onToggleMute={toggleMute} />
        {auth.isAuthenticated ? (
          <ProfileCard
            profile={profile}
            isAuthenticated={auth.isAuthenticated}
            isRefreshingBalance={auth.isRefreshingBalance}
            supportUnread={supportUnread}
            onSupportRead={onSupportRead}
            onAccountAction={() => {
              setIsLogoutConfirmOpen(true)
            }}
          />
        ) : (
          <GuestBanner onGoLogin={onGoLogin} />
        )}
        <BannerCarousel onCheckin={() => {
            if (!auth.isAuthenticated) { openAuthPrompt('default'); return }
            setIsCheckInOpen(true)
          }} />
        <QuickActions
          items={quickActions}
          onAction={(action) => {
            if (action === 'checkin') {
              if (!auth.isAuthenticated) { openAuthPrompt('default'); return }
              setIsCheckInOpen(true)
            }
          }}
        />
        <GameSection
          items={featuredGames}
          isLoading={isLoadingGames}
          favoriteIds={favoriteIds}
          onToggleFavorite={toggleFavorite}
          onGameClick={setSelectedGame}
        />
        <AllGamesSection
          items={games}
          isLoading={isLoadingGames}
          favoriteIds={favoriteIds}
          onToggleFavorite={toggleFavorite}
          play={play}
          onGameClick={setSelectedGame}
        />
        <BottomNav
          items={navItems}
          onLeftClick={() => {
              setIsMyDrawerOpen(false)
              setIsEventDrawerOpen((current) => !current)
            }}
          onCenterClick={onCenterLogoClick}
          onRightClick={() => {
            if (!auth.isAuthenticated) {
              openAuthPrompt('member')
              return
            }

            setIsFavoritesOpen(false)
            setIsEventDrawerOpen(false)
            setIsMyDrawerOpen((current) => !current)
          }}
        />
      </div>

      <FavoritesDrawer
        isOpen={isFavoritesOpen}
        onClose={() => setIsFavoritesOpen(false)}
        games={games}
        favoriteIds={favoriteIds}
        onToggleFavorite={toggleFavorite}
      />

      <EventDrawer
        isOpen={isEventDrawerOpen}
        onClose={() => setIsEventDrawerOpen(false)}
      />

      <MyDrawer
        isOpen={isMyDrawerOpen}
        onClose={() => setIsMyDrawerOpen(false)}
        profile={profile}
        onLogout={() => {
          setIsMyDrawerOpen(false)
          setIsLogoutConfirmOpen(true)
        }}
      />

      <CheckInModal
        isOpen={isCheckInOpen}
        onClose={() => setIsCheckInOpen(false)}
        token={auth.token}
        isAuthenticated={auth.isAuthenticated}
        onBalanceUpdate={auth.refreshUser}
      />

      <GameModal
        game={selectedGame}
        onClose={() => setSelectedGame(null)}
        isFavorite={selectedGame ? favoriteIds.includes(selectedGame.id) : false}
        onToggleFavorite={toggleFavorite}
        onPlay={() => handlePlayGame(selectedGame)}
      />

      <AuthPromptModal
        isOpen={isAuthPromptOpen}
        context={authPromptContext}
        onClose={() => setIsAuthPromptOpen(false)}
        onGoLogin={() => {
          setIsAuthPromptOpen(false)
          onGoLogin?.()
        }}
      />

      <EnterGameModal
        game={pendingGame}
        auth={auth}
        minBuyIn={minBuyIn}
        isOpen={isEnterGameOpen}
        onClose={() => { setIsEnterGameOpen(false); setPendingGame(null) }}
        onGoLogin={() => {
          setIsEnterGameOpen(false)
          setPendingGame(null)
          onGoLogin?.()
        }}
        onConfirm={(buyIn) => {
          setIsEnterGameOpen(false)
          const game = pendingGame
          setPendingGame(null)
          if (!game?.route) return
          pause('lobbyBgm')
          navigate(game.route, { state: { buyIn, gameSlug: game.slug } })
        }}
      />

      <LogoutConfirmModal
        isOpen={isLogoutConfirmOpen}
        onClose={() => setIsLogoutConfirmOpen(false)}
        onConfirm={() => {
          setIsLogoutConfirmOpen(false)
          setIsFavoritesOpen(false)
          setIsMyDrawerOpen(false)
          auth.logout()
        }}
      />

      <LobbyIntroModal
        isOpen={!hasEnteredLobby}
        onEnter={onEnterLobby}
      />
    </div>
  )
}

export default LobbyPage
