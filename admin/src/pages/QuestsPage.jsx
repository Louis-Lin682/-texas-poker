import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  DeleteOutlined,
  EditOutlined,
  HolderOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import { createContext, useContext, useMemo } from 'react'
import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd'
import { useEffect, useState } from 'react'
import { adminApi } from '../services/adminApi'

const { Title } = Typography
const { TextArea } = Input

const CATEGORY_OPTIONS = [
  { value: 'daily',       label: '每日' },
  { value: 'weekly',      label: '週常' },
  { value: 'achievement', label: '成就' },
]

const ACTION_OPTIONS = [
  { value: 'games_played',    label: '遊戲局數' },
  { value: 'chips_won',       label: '贏得籌碼' },
  { value: 'checkin_streak',  label: '連續簽到' },
  { value: 'slots_played',    label: '老虎機次數' },
  { value: 'big2_played',     label: '大老二局數' },
  { value: 'deposit',         label: '儲值金額' },
]

const CATEGORY_COLOR = { daily: 'blue', weekly: 'purple', achievement: 'gold' }
const CATEGORY_LABEL = { daily: '每日', weekly: '週常', achievement: '成就' }
const ACTION_LABEL   = Object.fromEntries(ACTION_OPTIONS.map(o => [o.value, o.label]))

const RowContext = createContext({})

function DragHandle() {
  const { setActivatorNodeRef, listeners } = useContext(RowContext)
  return (
    <HolderOutlined
      ref={setActivatorNodeRef}
      style={{ color: '#666', cursor: 'grab', touchAction: 'none' }}
      {...listeners}
    />
  )
}

function DraggableRow(props) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: props['data-row-key'] })
  const style = {
    ...props.style,
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { background: '#1e1e2e', opacity: 0.85, zIndex: 9999 } : {}),
  }
  const ctx = useMemo(() => ({ setActivatorNodeRef, listeners }), [setActivatorNodeRef, listeners])
  return (
    <RowContext.Provider value={ctx}>
      <tr {...props} ref={setNodeRef} style={style} {...attributes}>
        {props.children}
      </tr>
    </RowContext.Provider>
  )
}

export default function QuestsPage() {
  const { message } = App.useApp()
  const [quests, setQuests]       = useState([])
  const [loading, setLoading]     = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing]     = useState(null)
  const [form] = Form.useForm()

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  async function load() {
    setLoading(true)
    try {
      const res = await adminApi.getQuests()
      setQuests(res.quests ?? [])
    } catch { message.error('載入失敗') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  function openCreate() {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ is_active: true, category: 'daily', tier: 1, sort_order: 0 })
    setModalOpen(true)
  }

  function openEdit(q) {
    setEditing(q)
    form.setFieldsValue({
      title:       q.title,
      description: q.description,
      category:    q.category,
      action_type: q.action_type,
      target:      q.target,
      reward:      q.reward,
      tier:        q.tier,
      sort_order:  q.sort_order,
      is_active:   q.is_active,
    })
    setModalOpen(true)
  }

  async function handleSave() {
    let values
    try { values = await form.validateFields() } catch { return }

    const payload = {
      title:       values.title,
      description: values.description || null,
      category:    values.category,
      action_type: values.action_type,
      target:      values.target,
      reward:      values.reward,
      tier:        values.tier ?? 1,
      sort_order:  values.sort_order ?? 0,
      is_active:   Boolean(values.is_active),
    }

    try {
      if (editing) {
        await adminApi.updateQuest(editing.id, payload)
        message.success('已更新')
      } else {
        await adminApi.createQuest(payload)
        message.success('已新增')
      }
      setModalOpen(false)
      load()
    } catch (e) { message.error(e.message) }
  }

  async function handleToggle(q) {
    try {
      const res = await adminApi.toggleQuest(q.id)
      setQuests(prev => prev.map(item => item.id === q.id ? res.quest : item))
    } catch (e) { message.error(e.message) }
  }

  async function handleDelete(id) {
    try {
      await adminApi.deleteQuest(id)
      setQuests(prev => prev.filter(q => q.id !== id))
      message.success('已刪除')
    } catch (e) { message.error(e.message) }
  }

  async function handleSortOrderChange(id, newOrder) {
    const updated = quests.map(q => q.id === id ? { ...q, sort_order: newOrder } : q)
    setQuests(updated)
    try {
      await adminApi.reorderQuests([{ id, sort_order: newOrder }])
    } catch { message.error('排序更新失敗') }
  }

  async function handleDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = quests.findIndex(q => q.id === active.id)
    const newIndex = quests.findIndex(q => q.id === over.id)
    const reordered = arrayMove(quests, oldIndex, newIndex)
    const orders = reordered.map((q, i) => ({ id: q.id, sort_order: i }))
    setQuests(reordered.map((q, i) => ({ ...q, sort_order: i })))
    try {
      await adminApi.reorderQuests(orders)
    } catch { message.error('排序更新失敗'); load() }
  }

  const columns = [
    {
      key: 'drag',
      width: 40,
      render: () => <DragHandle />,
    },
    {
      title: '順序',
      dataIndex: 'sort_order',
      width: 80,
      render: (val, record) => (
        <InputNumber
          size="small"
          value={val}
          min={0}
          style={{ width: 64 }}
          onBlur={e => {
            const n = parseInt(e.target.value)
            if (!Number.isNaN(n) && n !== val) handleSortOrderChange(record.id, n)
          }}
          onPressEnter={e => {
            const n = parseInt(e.target.value)
            if (!Number.isNaN(n) && n !== val) handleSortOrderChange(record.id, n)
            e.target.blur()
          }}
        />
      ),
    },
    {
      title: '類型',
      dataIndex: 'category',
      width: 80,
      render: cat => (
        <Tag color={CATEGORY_COLOR[cat] ?? 'default'}>{CATEGORY_LABEL[cat] ?? cat}</Tag>
      ),
    },
    {
      title: '標題',
      dataIndex: 'title',
      render: (title, record) => (
        <span>
          {title}
          {record.category === 'achievement' && (
            <Tag style={{ marginLeft: 6 }} color="default">T{record.tier}</Tag>
          )}
        </span>
      ),
    },
    {
      title: '條件類型',
      dataIndex: 'action_type',
      width: 110,
      render: v => <span style={{ fontSize: 12, color: '#aaa' }}>{ACTION_LABEL[v] ?? v}</span>,
    },
    {
      title: '目標',
      dataIndex: 'target',
      width: 80,
      render: v => v?.toLocaleString('en-US'),
    },
    {
      title: '獎勵籌碼',
      dataIndex: 'reward',
      width: 90,
      render: v => <span style={{ color: '#f0c96b' }}>+{v?.toLocaleString('en-US')}</span>,
    },
    {
      title: '啟用',
      width: 70,
      render: (_, record) => (
        <Switch checked={record.is_active} size="small" onChange={() => handleToggle(record)} />
      ),
    },
    {
      title: '操作',
      width: 90,
      render: (_, record) => (
        <Space>
          <Button icon={<EditOutlined />} size="small" type="text" onClick={() => openEdit(record)} />
          <Popconfirm title="確定刪除？" onConfirm={() => handleDelete(record.id)} okText="刪除" cancelText="取消">
            <Button icon={<DeleteOutlined />} size="small" type="text" danger />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>任務管理</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增任務</Button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={quests.map(q => q.id)} strategy={verticalListSortingStrategy}>
          <Table
            rowKey="id"
            dataSource={quests}
            columns={columns}
            loading={loading}
            pagination={false}
            components={{ body: { row: DraggableRow } }}
            onRow={record => ({ 'data-row-key': record.id })}
          />
        </SortableContext>
      </DndContext>

      <Modal
        title={editing ? '編輯任務' : '新增任務'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        okText={editing ? '儲存' : '新增'}
        cancelText="取消"
        width={520}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="title" label="標題" rules={[{ required: true, message: '請輸入標題' }]}>
            <Input placeholder="任務名稱" maxLength={100} />
          </Form.Item>
          <Form.Item name="description" label="說明">
            <TextArea rows={2} placeholder="任務說明（選填）" maxLength={300} showCount />
          </Form.Item>
          <Space style={{ width: '100%' }} size={12}>
            <Form.Item name="category" label="類型" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Select options={CATEGORY_OPTIONS} />
            </Form.Item>
            <Form.Item name="action_type" label="條件類型" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Select options={ACTION_OPTIONS} />
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }} size={12}>
            <Form.Item name="target" label="目標數量" rules={[{ required: true }]} style={{ flex: 1 }}>
              <InputNumber min={1} style={{ width: '100%' }} placeholder="如：10" />
            </Form.Item>
            <Form.Item name="reward" label="獎勵籌碼" rules={[{ required: true }]} style={{ flex: 1 }}>
              <InputNumber min={0} style={{ width: '100%' }} placeholder="如：500" />
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }} size={12}>
            <Form.Item name="tier" label="成就階層（成就用）" style={{ flex: 1 }}>
              <InputNumber min={1} max={5} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="sort_order" label="排序數字" style={{ flex: 1 }}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Form.Item name="is_active" label="啟用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
