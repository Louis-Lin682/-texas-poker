import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AllGamesSection from '../components/AllGamesSection'
import GameSection from '../components/GameSection'
import AuthPromptModal from '../components/AuthPromptModal'
import CheckInModal from '../components/CheckInModal'
import GuestBanner from '../components/GuestBanner'
import BottomNav from '../components/BottomNav'
import EventDrawer from '../components/EventDrawer'
import FavoritesDrawer from '../components/FavoritesDrawer'
import GameModal from '../components/GameModal'
import BannerCarousel from '../components/BannerCarousel'
import PcTopBar from '../components/PcTopBar'
import AvatarPickerModal from '../components/AvatarPickerModal'
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
import { API_BASE_URL } from '../services/apiClient'
import { guestLogin } from '../services/authApi'

function LobbyPage({ auth, isActive = true, onGoLogin, onCenterLogoClick, hasEnteredLobby, onEnterLobby, play, pause, supportUnread, onSupportRead }) {
  const navigate = useNavigate()
  const [selectedGame, setSelectedGame] = useState(null)
  const [isCheckInOpen, setIsCheckInOpen] = useState(false)
  const [isAuthPromptOpen, setIsAuthPromptOpen] = useState(false)
  const [authPromptContext, setAuthPromptContext] = useState('default')
  const [isFavoritesOpen, setIsFavoritesOpen] = useState(false)
  const [isMyDrawerOpen, setIsMyDrawerOpen] = useState(false)
  const [isEventDrawerOpen, setIsEventDrawerOpen] = useState(false)
  const [isAvatarPickerOpen, setIsAvatarPickerOpen] = useState(false)
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false)
  const [isGuestBrokeOpen,   setIsGuestBrokeOpen]   = useState(false)
  const { games, featuredGames, isLoadingGames } = useGames()
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
  const afterGuestRef = useRef(null)

  const openAuthPrompt = (context = 'default', afterGuest = null) => {
    afterGuestRef.current = afterGuest
    setAuthPromptContext(context)
    setIsAuthPromptOpen(true)
  }

  const handleGuestLogin = useCallback(async () => {
    try {
      const { token } = await guestLogin()
      auth.setToken(token)
      setIsAuthPromptOpen(false)
      afterGuestRef.current?.()
      afterGuestRef.current = null
    } catch (err) {
      console.error('[guest login]', err)
    }
  }, [auth])

  const { favoriteIds, toggleFavorite } = useFavorites({
    isAuthenticated: auth.isAuthenticated,
    token: auth.token,
    onRequireLogin: () => openAuthPrompt('favorite'),
  })

  const [balanceReady, setBalanceReady] = useState(false)
  const [settlingMsg, setSettlingMsg] = useState(false)
  const settlingTimerRef = useRef(null)

  useEffect(() => {
    if (!auth.isAuthenticated || !isActive) {
      if (!isActive) setBalanceReady(false)
      return
    }

    setBalanceReady(false)

    auth.refreshUser().then(user => {
      if (user && user.balance > 0) {
        setBalanceReady(true)
      } else {
        // 0 returned — may be a race with game cashout DB update; retry once
        setTimeout(() => auth.refreshUser({ silent: true }).then(() => setBalanceReady(true)), 800)
      }
    })

    const id = setInterval(() => auth.refreshUser({ silent: true }), 10_000)
    const onVisible = () => { if (document.visibilityState === 'visible') auth.refreshUser({ silent: true }) }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [auth.isAuthenticated, isActive]) // eslint-disable-line react-hooks/exhaustive-deps

  const handlePlayGame = (game) => {
    if (!game?.route) return
    setSelectedGame(null)
    if (game.directRoute) {
      pause('lobbyBgm')
      navigate(game.route, { state: { gameSlug: game.slug } })
      return
    }
    if (!auth.isAuthenticated) {
      openAuthPrompt('game')
      return
    }
    if (auth.isAuthenticated && !balanceReady) {
      clearTimeout(settlingTimerRef.current)
      setSettlingMsg(true)
      settlingTimerRef.current = setTimeout(() => setSettlingMsg(false), 3000)
      return
    }
    if (auth.user?.is_guest && (auth.user?.balance ?? 0) === 0) {
      setIsGuestBrokeOpen(true)
      return
    }
    pause('lobbyBgm')
    navigate(game.route, { state: { buyIn: auth.user?.balance ?? 0, gameSlug: game.slug } })
  }

  const profile = {
    id: auth.user?.id ?? '',
    account: auth.user?.username ?? '',
    balance: new Intl.NumberFormat('en-US').format(auth.user?.balance ?? 0),
    vip: auth.isAuthenticated ? 'VIP 1' : 'GUEST',
    avatar: auth.user?.avatar ?? null,
  }

  const navItems = bottomNavItems.map((item) =>
    item.type === 'image'
      ? {
          ...item,
          label: (auth.isAuthenticated && !auth.user?.is_guest) ? '遊戲大廳' : '登入 / 註冊',
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

      <PcTopBar
        profile={profile}
        isAuthenticated={auth.isAuthenticated}
        isRefreshingBalance={!balanceReady || auth.isRefreshingBalance}
        supportUnread={supportUnread}
        onSupportRead={onSupportRead}
        onAccountAction={() => setIsLogoutConfirmOpen(true)}
        onGoLogin={onGoLogin}
        onAvatarClick={() => setIsAvatarPickerOpen(true)}
      />

      <div className="pc-angel-float" aria-hidden="true">
        <div className="angel-fly" style={{ '--af-size': '250px', margin: 0 }} />
      </div>

      {/* {showFloatTop && (
        <button
          type="button"
          className="float-btn float-top"
          onClick={handleTopClick}
          aria-label="回頂部"
        >
          <img src="/top.webp" alt="" />
        </button>
      )} */}
      <div className="phone-frame phone-frame-lobby">
        <NoticeTicker text={marqueeText} />
        {auth.isAuthenticated ? (
          <ProfileCard
            profile={profile}
            isAuthenticated={auth.isAuthenticated}
            isRefreshingBalance={!balanceReady || auth.isRefreshingBalance}
            supportUnread={supportUnread}
            onSupportRead={onSupportRead}
            onAccountAction={() => setIsLogoutConfirmOpen(true)}
            onAvatarClick={() => setIsAvatarPickerOpen(true)}
          />
        ) : (
          <GuestBanner onGoLogin={onGoLogin} />
        )}
        <div className="pc-hero-row">
          <div className="pc-banner-col">
            <BannerCarousel onCheckin={() => {
                if (!auth.isAuthenticated) { openAuthPrompt('default'); return }
                setIsCheckInOpen(true)
              }} />
            <div className="pc-notice-slot">
              <NoticeTicker text={marqueeText} />
            </div>
          </div>
          <GameSection
            items={featuredGames}
            isLoading={isLoadingGames}
            favoriteIds={favoriteIds}
            onToggleFavorite={toggleFavorite}
            onGameClick={setSelectedGame}
          />
        </div>
        <QuickActions
          items={quickActions}
          onAction={(action) => {
            if (action === 'checkin') {
              if (!auth.isAuthenticated) { openAuthPrompt('default'); return }
              setIsCheckInOpen(true)
            }
          }}
        />
        <AllGamesSection
          items={games}
          isLoading={isLoadingGames}
          favoriteIds={favoriteIds}
          onToggleFavorite={toggleFavorite}
          play={play}
          onGameClick={setSelectedGame}
        />
      </div>

      <BottomNav
        items={navItems}
        onLeftClick={() => {
            setIsMyDrawerOpen(false)
            setIsEventDrawerOpen((current) => !current)
          }}
        onCenterClick={onCenterLogoClick}
        onRightClick={() => {
          setIsFavoritesOpen(false)
          setIsEventDrawerOpen(false)
          setIsMyDrawerOpen((current) => !current)
        }}
      />

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
        isAuthenticated={auth.isAuthenticated}
        isGuest={auth.user?.is_guest ?? false}
        onGuestLogin={handleGuestLogin}
        onGoLogin={() => { setIsMyDrawerOpen(false); onGoLogin?.() }}
        onLogout={() => {
          setIsMyDrawerOpen(false)
          setIsLogoutConfirmOpen(true)
        }}
        onAvatarClick={() => setIsAvatarPickerOpen(true)}
      />

      <AvatarPickerModal
        isOpen={isAvatarPickerOpen}
        currentAvatar={profile.avatar}
        onSelect={async (avatar) => { await auth.updateAvatar(avatar); setIsAvatarPickerOpen(false) }}
        onClose={() => setIsAvatarPickerOpen(false)}
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
        onGuestLogin={handleGuestLogin}
      />

      {isGuestBrokeOpen && (
        <div className="auth-modal-backdrop" role="presentation" onClick={() => setIsGuestBrokeOpen(false)}>
          <div className="auth-modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            <img className="auth-modal-angel" src="/notice-angel.webp" alt="" aria-hidden="true" />
            <div className="auth-modal-content">
              <h3>訪客籌碼已用盡</h3>
              <p>升級為正式帳號後即可儲值繼續遊戲</p>
            </div>
            <div className="auth-modal-actions">
              <button type="button" className="auth-modal-btn-dismiss" onClick={() => setIsGuestBrokeOpen(false)}>繼續瀏覽</button>
              <button type="button" className="auth-modal-btn-login" onClick={() => { setIsGuestBrokeOpen(false); navigate('/auth', { state: { mode: 'register' } }) }}>升級帳號</button>
            </div>
          </div>
        </div>
      )}

      {settlingMsg && (
        <div className="settling-toast">籌碼結算中，請稍候再進入遊戲</div>
      )}

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
