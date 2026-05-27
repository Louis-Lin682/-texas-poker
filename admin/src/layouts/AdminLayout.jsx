import {
  AlertOutlined,
  BarChartOutlined,
  CustomerServiceOutlined,
  LogoutOutlined,
  TeamOutlined,
  TrophyOutlined,
  NotificationOutlined,
} from '@ant-design/icons'
import { Layout, Menu, Typography, theme } from 'antd'
import { useMemo } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAdminAuth } from '../context/AdminAuthContext'

const { Sider, Content, Header } = Layout
const { Text } = Typography

const NAV_ITEMS = [
  { key: '/members',  icon: <TeamOutlined />,            label: <Link to="/members">會員管理</Link> },
  { key: '/reports',  icon: <BarChartOutlined />,         label: <Link to="/reports">遊戲報表</Link> },
  { key: '/events',   icon: <AlertOutlined />,            label: <Link to="/events">限時活動</Link> },
  { key: '/news',     icon: <NotificationOutlined />,     label: <Link to="/news">最新消息</Link> },
  { key: '/quests',   icon: <TrophyOutlined />,           label: <Link to="/quests">任務管理</Link> },
  { key: '/support',  icon: <CustomerServiceOutlined />,  label: <Link to="/support">客服中心</Link> },
]

export default function AdminLayout() {
  const { admin, logout } = useAdminAuth()
  const navigate  = useNavigate()
  const location  = useLocation()
  const { token } = theme.useToken()

  const selected = useMemo(() => {
    const match = NAV_ITEMS.find(i => location.pathname.startsWith(i.key))
    return match ? [match.key] : []
  }, [location.pathname])

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        width={200}
        style={{ background: '#111118', borderRight: '1px solid #1e1e2e' }}
      >
        <div style={{
          height: 56, display: 'flex', alignItems: 'center',
          justifyContent: 'center', borderBottom: '1px solid #1e1e2e',
        }}>
          <Text strong style={{ color: '#f0d080', fontSize: 15, letterSpacing: 1 }}>
            ♠ 後台管理
          </Text>
        </div>
        <Menu
          mode="inline"
          selectedKeys={selected}
          items={NAV_ITEMS}
          style={{ background: '#111118', border: 0, marginTop: 8 }}
          theme="dark"
        />
      </Sider>

      <Layout>
        <Header style={{
          background: '#16161f', padding: '0 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          borderBottom: '1px solid #1e1e2e', height: 56,
        }}>
          <Text style={{ color: '#aaa', marginRight: 16, fontSize: 13 }}>
            {admin?.username}
          </Text>
          <LogoutOutlined
            style={{ color: '#888', cursor: 'pointer', fontSize: 16 }}
            onClick={handleLogout}
            title="登出"
          />
        </Header>

        <Content style={{ padding: 24, background: '#0d0d14', minHeight: 'calc(100vh - 56px)' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
