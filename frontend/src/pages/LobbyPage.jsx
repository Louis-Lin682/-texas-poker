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
import HeroBanner from '../components/HeroBanner'
import LobbyIntroModal from '../components/LobbyIntroModal'
import LogoutConfirmModal from '../components/LogoutConfirmModal'
import MyDrawer from '../components/MyDrawer'
import NoticeTicker from '../components/NoticeTicker'
import ProfileCard from '../components/ProfileCard'
import PromoSection from '../components/PromoSection'
import QuickActions from '../components/QuickActions'
import {
  bottomNavItems,
  noticeText,
  promoCards,
  quickActions,
} from '../data/lobbyData'
import { useAudio } from '../hooks/useAudio'
import { useFavorites } from '../hooks/useFavorites'
import { useGames } from '../hooks/useGames'
import { getConfig } from '../services/gamesApi'

function LobbyPage({ auth, onGoLogin, onCenterLogoClick, hasEnteredLobby, onEnterLobby }) {
  const { isMuted, pause, play, preload, toggleMute } = useAudio(false)
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
  const { games, featuredGames } = useGames()
  const [minBuyIn, setMinBuyIn] = useState(2000)

  useEffect(() => {
    getConfig().then(cfg => { if (cfg.minBuyIn) setMinBuyIn(cfg.minBuyIn) }).catch(() => {})
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
    preload(['uiClick', 'uiWhoosh', 'lobbyBgm'])
  }, [preload])

  useEffect(() => {
    if (auth.isAuthenticated) auth.refreshUser()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!hasEnteredLobby) {
      pause('lobbyBgm')
      return
    }

    if (isMuted) {
      pause('lobbyBgm')
      return
    }

    play('lobbyBgm')
  }, [hasEnteredLobby, isMuted, pause, play])

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

  return (
    <div
      className={`app-shell ${isFavoritesOpen || isMyDrawerOpen || isEventDrawerOpen ? 'has-favorites-open' : ''}`}
    >
      <div className="phone-frame">
        <NoticeTicker text={noticeText} isMuted={isMuted} onToggleMute={toggleMute} />
        {auth.isAuthenticated ? (
          <ProfileCard
            profile={profile}
            isAuthenticated={auth.isAuthenticated}
            isRefreshingBalance={auth.isRefreshingBalance}
            onAccountAction={() => {
              setIsLogoutConfirmOpen(true)
            }}
          />
        ) : (
          <GuestBanner onGoLogin={onGoLogin} />
        )}
        <HeroBanner />
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
          favoriteIds={favoriteIds}
          onToggleFavorite={toggleFavorite}
          onGameClick={setSelectedGame}
        />
        <AllGamesSection
          items={games}
          favoriteIds={favoriteIds}
          onToggleFavorite={toggleFavorite}
          play={play}
          onGameClick={setSelectedGame}
        />
        <PromoSection items={promoCards} />
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
        onEnter={() => {
          onEnterLobby()
          play('lobbyBgm')
        }}
      />
    </div>
  )
}

export default LobbyPage
