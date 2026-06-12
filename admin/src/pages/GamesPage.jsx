import {
  Badge, Button, Drawer, Form, Image, Input, Select, Space, Switch,
  Table, Tag, Typography, message,
} from 'antd'
import { EditOutlined, FireOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useRef, useState } from 'react'
import { adminApi } from '../services/adminApi'

const { Text } = Typography

const GAME_META = {
  'texas-holdem':  { label: '德州撲克',            color: 'blue' },
  'big-two':       { label: '大老二',              color: 'green' },
  'blackjack':     { label: '21點',               color: 'gold' },
  'dragon-tiger':  { label: '龍虎鬥',             color: 'red' },
  'thunder-joker': { label: 'Thunder Joker 老虎機', color: 'purple' },
}

const STATUS_OPTIONS = [
  { value: 'open',        label: '開放',   color: 'success' },
  { value: 'maintenance', label: '維護中', color: 'error' },
  { value: 'updating',    label: '更新中', color: 'warning' },
]

function statusBadge(s) {
  const opt = STATUS_OPTIONS.find(o => o.value === s) ?? STATUS_OPTIONS[0]
  return <Badge status={opt.color} text={opt.label} />
}

const FRONTEND_URL = (import.meta.env.VITE_FRONTEND_URL ?? 'http://localhost:5173').replace(/\/$/, '')

function resolveImageUrl(url) {
  if (!url) return ''
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (url.startsWith('/')) return `${FRONTEND_URL}${url}`
  return url
}

const CATEGORY_OPTIONS = [
  { value: 'poker',      label: '撲克牌桌' },
  { value: 'electronic', label: '電子遊戲' },
  { value: 'chess',      label: '棋牌遊戲' },
  { value: 'other',      label: '其他' },
]

const EMPTY_FORM = { status: 'open', notice: '', display_name: '', image_url: '', badge: '', category: '', is_hot: false }

export default function GamesPage() {
  const [games,   setGames]   = useState([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState({})   // slug → { status, notice }
  const [saving,  setSaving]  = useState({})   // slug → bool

  // Drawer state
  const [drawerOpen,   setDrawerOpen]   = useState(false)
  const [drawerSlug,   setDrawerSlug]   = useState(null)
  const [drawerForm,   setDrawerForm]   = useState(EMPTY_FORM)
  const [drawerSaving, setDrawerSaving] = useState(false)

  const intervalRef = useRef(null)

  const fetchGames = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const data = await adminApi.getGames()
      setGames(data.games)
      if (!silent) {
        const init = {}
        data.games.forEach(g => { init[g.slug] = { status: g.status, notice: g.notice } })
        setEditing(init)
      }
    } catch {
      if (!silent) message.error('載入失敗')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    fetchGames().finally(() => setLoading(false))
    intervalRef.current = setInterval(() => fetchGames(true), 5000)
    return () => clearInterval(intervalRef.current)
  }, [fetchGames])

  async function handleSave(slug) {
    setSaving(s => ({ ...s, [slug]: true }))
    try {
      const updated = await adminApi.updateGame(slug, editing[slug])
      setGames(gs => gs.map(g => g.slug === slug ? { ...g, ...updated } : g))
      message.success('已儲存')
    } catch {
      message.error('儲存失敗')
    } finally {
      setSaving(s => ({ ...s, [slug]: false }))
    }
  }

  function patch(slug, key, val) {
    setEditing(e => ({ ...e, [slug]: { ...e[slug], [key]: val } }))
  }

  function openDrawer(game) {
    setDrawerSlug(game.slug)
    setDrawerForm({
      status:       game.status       ?? 'open',
      notice:       game.notice       ?? '',
      display_name: game.display_name ?? '',
      image_url:    game.image_url    ?? '',
      badge:        game.badge        ?? '',
      category:     game.category     ?? '',
      is_hot:       game.is_hot       ?? false,
    })
    setDrawerOpen(true)
  }

  async function handleDrawerSave() {
    setDrawerSaving(true)
    try {
      const updated = await adminApi.updateGame(drawerSlug, {
        status:       drawerForm.status,
        notice:       drawerForm.notice,
        display_name: drawerForm.display_name,
        image_url:    drawerForm.image_url,
        badge:        drawerForm.badge,
        category:     drawerForm.category,
        is_hot:       drawerForm.is_hot,
      })
      setGames(gs => gs.map(g => g.slug === drawerSlug ? { ...g, ...updated } : g))
      setEditing(e => ({ ...e, [drawerSlug]: { status: updated.status, notice: updated.notice } }))
      message.success('已儲存')
      setDrawerOpen(false)
    } catch {
      message.error('儲存失敗')
    } finally {
      setDrawerSaving(false)
    }
  }

  function dfPatch(key, val) {
    setDrawerForm(f => ({ ...f, [key]: val }))
  }

  const columns = [
    {
      title: '遊戲',
      dataIndex: 'slug',
      width: 200,
      render: slug => {
        const m = GAME_META[slug] ?? { label: slug, color: 'default' }
        return <Tag color={m.color} style={{ fontSize: 13 }}>{m.label}</Tag>
      },
    },
    {
      title: '目前狀態',
      dataIndex: 'status',
      width: 100,
      render: statusBadge,
    },
    {
      title: '修改狀態',
      width: 140,
      render: g => (
        <Select
          value={editing[g.slug]?.status ?? g.status}
          onChange={v => patch(g.slug, 'status', v)}
          style={{ width: 120 }}
          options={STATUS_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
        />
      ),
    },
    {
      title: '公告文字（維護/更新時顯示給玩家）',
      render: g => (
        <Input
          value={editing[g.slug]?.notice ?? g.notice}
          onChange={e => patch(g.slug, 'notice', e.target.value)}
          placeholder="例：預計 23:00 恢復，感謝耐心等候"
          maxLength={120}
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: '',
      width: 140,
      render: g => (
        <Space>
          <Button
            type="primary"
            size="small"
            loading={saving[g.slug]}
            onClick={() => handleSave(g.slug)}
          >
            儲存
          </Button>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => openDrawer(g)}
          >
            素材
          </Button>
        </Space>
      ),
    },
  ]

  const currentGame = games.find(g => g.slug === drawerSlug)
  const drawerMeta  = GAME_META[drawerSlug] ?? { label: drawerSlug, color: 'default' }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>遊戲管理</Typography.Title>
        <Space>
          <Text type="secondary" style={{ fontSize: 12 }}>設定各遊戲開放狀態與維護公告</Text>
          <Button size="small" onClick={fetchGames}>重新整理</Button>
        </Space>
      </div>

      <Table
        columns={columns}
        dataSource={games}
        rowKey="slug"
        loading={loading}
        pagination={false}
        size="middle"
        locale={{ emptyText: '無資料' }}
      />

      <Drawer
        title={
          <Space>
            <Tag color={drawerMeta.color}>{drawerMeta.label}</Tag>
            <span>素材設定</span>
          </Space>
        }
        width={480}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        extra={
          <Button type="primary" loading={drawerSaving} onClick={handleDrawerSave}>
            儲存
          </Button>
        }
      >
        <Form layout="vertical" size="middle">
          <Form.Item label="遊戲顯示名稱">
            <Input
              value={drawerForm.display_name}
              onChange={e => dfPatch('display_name', e.target.value)}
              placeholder={currentGame ? (GAME_META[currentGame.slug]?.label ?? currentGame.slug) : '使用預設名稱'}
              maxLength={40}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>留空則使用系統預設名稱</Text>
          </Form.Item>

          <Form.Item label="徽章標籤（如：HOT、NEW、LIVE）">
            <Input
              value={drawerForm.badge}
              onChange={e => dfPatch('badge', e.target.value)}
              placeholder="HOT"
              maxLength={10}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>留空則使用 games.json 預設值</Text>
          </Form.Item>

          <Form.Item label="封面圖片 URL">
            <Input
              value={drawerForm.image_url}
              onChange={e => dfPatch('image_url', e.target.value)}
              placeholder="/games/texas-holdem/cover.png 或 https://cdn.example.com/img.png"
            />
            <Text type="secondary" style={{ fontSize: 11 }}>留空則使用 games.json 預設圖片</Text>
          </Form.Item>

          {drawerForm.image_url && (
            <Form.Item label="圖片預覽">
              <Image
                src={resolveImageUrl(drawerForm.image_url)}
                alt="封面預覽"
                style={{ maxWidth: '100%', maxHeight: 200, objectFit: 'contain', borderRadius: 8, border: '1px solid #333' }}
                fallback="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='120'%3E%3Crect fill='%23333' width='200' height='120'/%3E%3Ctext fill='%23888' font-size='14' x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle'%3E圖片載入失敗%3C/text%3E%3C/svg%3E"
              />
            </Form.Item>
          )}

          <Form.Item label="遊戲分類">
            <Select
              value={drawerForm.category || undefined}
              onChange={v => dfPatch('category', v ?? '')}
              allowClear
              placeholder="使用 games.json 預設值"
              style={{ width: '100%' }}
              options={CATEGORY_OPTIONS}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>留空則使用 games.json 預設分類</Text>
          </Form.Item>

          <Form.Item label={<Space><FireOutlined style={{ color: '#ff4d4f' }} />熱門推薦</Space>}>
            <Space align="center">
              <Switch
                checked={drawerForm.is_hot}
                onChange={v => dfPatch('is_hot', v)}
                checkedChildren="熱門"
                unCheckedChildren="一般"
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {drawerForm.is_hot === true  ? '顯示 HOT 標記，列入熱門推薦' :
                 drawerForm.is_hot === false && drawerForm.is_hot !== null ? '不顯示熱門標記' :
                 '未設定（使用 games.json 預設值）'}
              </Text>
            </Space>
          </Form.Item>

          <Form.Item label="遊戲狀態" style={{ marginTop: 8 }}>
            <Select
              value={drawerForm.status}
              onChange={v => dfPatch('status', v)}
              style={{ width: '100%' }}
              options={STATUS_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
            />
          </Form.Item>

          <Form.Item label="維護 / 更新公告">
            <Input.TextArea
              value={drawerForm.notice}
              onChange={e => dfPatch('notice', e.target.value)}
              placeholder="例：預計 23:00 恢復，感謝耐心等候"
              maxLength={240}
              rows={3}
              showCount
            />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  )
}
