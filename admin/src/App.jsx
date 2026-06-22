import { App as AntApp, ConfigProvider, theme } from 'antd'
import zhTW from 'antd/locale/zh_TW'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminAuthProvider, useAdminAuth } from './context/AdminAuthContext'
import AdminLayout from './layouts/AdminLayout'
import LoginPage from './pages/LoginPage'
import MemberDetailPage from './pages/MemberDetailPage'
import MemberLedgerPage from './pages/MemberLedgerPage'
import MembersPage from './pages/MembersPage'
import AdminNewsPage from './pages/AdminNewsPage'
import AdminAnnouncementsPage from './pages/AdminAnnouncementsPage'
import EventsPage from './pages/EventsPage'
import AdminSupportPage from './pages/AdminSupportPage'
import PlaceholderPage from './pages/PlaceholderPage'
import QuestsPage from './pages/QuestsPage'
import ReportsPage from './pages/ReportsPage'
import GamesPage from './pages/GamesPage'
import RoomsPage from './pages/RoomsPage'
import DragonTigerConfigPage from './pages/DragonTigerConfigPage'
import ThunderJokerConfigPage from './pages/ThunderJokerConfigPage'

function RequireAuth({ children }) {
  const { admin, loading } = useAdminAuth()
  if (loading) return null
  return admin ? children : <Navigate to="/login" replace />
}

function AppRoutes() {
  const { admin } = useAdminAuth()
  return (
    <Routes>
      <Route path="/login" element={admin ? <Navigate to="/members" replace /> : <LoginPage />} />
      <Route element={<RequireAuth><AdminLayout /></RequireAuth>}>
        <Route index element={<Navigate to="/members" replace />} />
        <Route path="/members"     element={<MembersPage />} />
        <Route path="/members/:id" element={<MemberDetailPage />} />
        <Route path="/members/:id/ledger" element={<MemberLedgerPage />} />
        <Route path="/reports"     element={<ReportsPage />} />
        <Route path="/games"       element={<GamesPage />} />
        <Route path="/games/dragon-tiger/config" element={<DragonTigerConfigPage />} />
        <Route path="/games/thunder-joker/config" element={<ThunderJokerConfigPage />} />
        <Route path="/rooms"       element={<RoomsPage />} />
        <Route path="/events"      element={<EventsPage />} />
        <Route path="/news"          element={<AdminNewsPage />} />
        <Route path="/announcements" element={<AdminAnnouncementsPage />} />
        <Route path="/quests"      element={<QuestsPage />} />
        <Route path="/support"     element={<AdminSupportPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/members" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <ConfigProvider
      locale={zhTW}
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#c49010',
          colorBgBase: '#16161f',
          colorBgContainer: '#16161f',
          colorBgElevated: '#1e1e2e',
          colorBorder: '#2a2a3a',
          colorText: '#e0e0e0',
          borderRadius: 6,
          fontFamily: '"Noto Sans TC", sans-serif',
        },
      }}
    >
      <AntApp>
        <AdminAuthProvider>
          <AppRoutes />
        </AdminAuthProvider>
      </AntApp>
    </ConfigProvider>
  )
}
