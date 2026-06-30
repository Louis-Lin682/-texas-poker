import {
  AlertOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  CustomerServiceOutlined,
  ControlOutlined,
  EyeOutlined,
  LogoutOutlined,
  TeamOutlined,
  TrophyOutlined,
  NotificationOutlined,
  SoundOutlined,
} from '@ant-design/icons'
import { Alert, Badge, Layout, Menu, Tag, Typography, theme } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAdminAuth } from '../context/AdminAuthContext'
import { adminApi } from '../services/adminApi'

const { Sider, Content, Header } = Layout
const { Text } = Typography

export default function AdminLayout() {
  const { admin, logout } = useAdminAuth()
  const navigate  = useNavigate()
  const location  = useLocation()
  const { token } = theme.useToken()
  const [supportUnread, setSupportUnread] = useState(0)

  useEffect(() => {
    function fetchUnread() {
      adminApi.getSupportUnread().then(d => setSupportUnread(d.count)).catch(() => {})
    }
    fetchUnread()
    const id = setInterval(fetchUnread, 30000)
    return () => clearInterval(id)
  }, [])

  // Clear badge when on support page
  useEffect(() => {
    if (location.pathname.startsWith('/support')) setSupportUnread(0)
  }, [location.pathname])

  const NAV_ITEMS = useMemo(() => [
    { key: '/members',  icon: <TeamOutlined />,            label: <Link to="/members">會員管理</Link> },
    { key: '/games',    icon: <ControlOutlined />,          label: <Link to="/games">遊戲管理</Link>,
      children: [
        { key: '/games/list',                  label: <Link to="/games">遊戲開關</Link> },
        { key: '/games/dragon-tiger/config',  label: <Link to="/games/dragon-tiger/config">龍虎賠率</Link> },
        { key: '/games/thunder-joker/config', label: <Link to="/games/thunder-joker/config">老虎機設定</Link> },
      ],
    },
    { key: '/rooms',    icon: <AppstoreOutlined />,         label: <Link to="/rooms">房間管理</Link> },
    { key: '/reports',  icon: <BarChartOutlined />,         label: <Link to="/reports">遊戲報表</Link> },
    { key: '/events',   icon: <AlertOutlined />,            label: <Link to="/events">限時活動</Link> },
    { key: '/news',          icon: <NotificationOutlined />, label: <Link to="/news">最新消息</Link> },
    { key: '/announcements', icon: <SoundOutlined />,        label: <Link to="/announcements">跑馬燈公告</Link> },
    { key: '/quests',   icon: <TrophyOutlined />,           label: <Link to="/quests">任務管理</Link> },
    {
      key: '/support',
      icon: <CustomerServiceOutlined />,
      label: (
        <Link to="/support">
          <Badge count={supportUnread} size="small" offset={[6, 0]} style={{ fontSize: 10 }}>
            客服中心
          </Badge>
        </Link>
      ),
    },
  ], [supportUnread])

  const selected = useMemo(() => {
    for (const item of NAV_ITEMS) {
      if (item.children) {
        const sorted = [...item.children].sort((a, b) => b.key.length - a.key.length)
        const child = sorted.find(c => location.pathname === c.key || location.pathname.startsWith(c.key + '/'))
        if (child) return [child.key]
      }
      if (!item.children && location.pathname.startsWith(item.key)) return [item.key]
    }
    return []
  }, [location.pathname, NAV_ITEMS])

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      <Sider
        width={200}
        style={{
          background: '#111118',
          borderRight: '1px solid #1e1e2e',
          height: '100vh',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{
          height: 56, flexShrink: 0,
          display: 'flex', alignItems: 'center',
          justifyContent: 'center', borderBottom: '1px solid #1e1e2e',
        }}>
          <Text strong style={{ color: '#f0d080', fontSize: 15, letterSpacing: 1 }}>
            ♠ 後台管理
          </Text>
        </div>
        <Menu
          mode="inline"
          selectedKeys={selected}
          defaultOpenKeys={['/games']}
          items={NAV_ITEMS}
          style={{ background: '#111118', border: 0, marginTop: 8 }}
          theme="dark"
        />
      </Sider>

      <Layout style={{ height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Header style={{
          background: '#16161f', padding: '0 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          borderBottom: '1px solid #1e1e2e', height: 56, flexShrink: 0,
        }}>
          <Text style={{ color: '#aaa', marginRight: 8, fontSize: 13 }}>
            {admin?.username}
          </Text>
          {admin?.role === 'demo' && (
            <Tag icon={<EyeOutlined />} color="orange" style={{ marginRight: 16 }}>示範帳號</Tag>
          )}
          <LogoutOutlined
            style={{ color: '#888', cursor: 'pointer', fontSize: 16 }}
            onClick={handleLogout}
            title="登出"
          />
        </Header>

        <Content style={{
          padding: 24,
          background: '#0d0d14',
          flex: 1,
          overflow: 'auto',
          minHeight: 0,
        }}>
          {admin?.role === 'demo' && (
            <Alert
              type="warning"
              showIcon
              message="示範帳號（唯讀）— 此帳號僅供查看，所有編輯、刪除、新增操作均已停用。"
              style={{ marginBottom: 16 }}
              banner
            />
          )}
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
