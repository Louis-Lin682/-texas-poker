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
import {
  App,
  Button,
  DatePicker,
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
import dayjs from 'dayjs'
import { useEffect, useState } from 'react'
import { adminApi } from '../services/adminApi'

const { Title } = Typography
const { TextArea } = Input

const TAG_PRESETS = [
  { label: '限時', color: '#57d46f' },
  { label: '首儲', color: '#f0c96b' },
  { label: '新手', color: '#4fd0ff' },
  { label: '回饋', color: '#ff8c69' },
  { label: '節慶', color: '#d084ff' },
]

const TAG_COLOR_MAP = Object.fromEntries(TAG_PRESETS.map(t => [t.label, t.color]))

function getStatus(ev) {
  const now = new Date()
  if (!ev.is_active) return { label: '下架', color: 'default' }
  if (ev.start_at && new Date(ev.start_at) > now) return { label: '未開始', color: 'blue' }
  if (ev.end_at   && new Date(ev.end_at)   < now) return { label: '已過期', color: 'red'  }
  return { label: '進行中', color: 'green' }
}

function DraggableRow(props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props['data-row-key'] })
  const style = {
    ...props.style,
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { background: '#1e1e2e', opacity: 0.85, zIndex: 9999 } : {}),
  }
  return (
    <tr {...props} ref={setNodeRef} style={style}>
      {props.children}
    </tr>
  )
}

export default function EventsPage() {
  const { message } = App.useApp()
  const [events, setEvents]     = useState([])
  const [loading, setLoading]   = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing]   = useState(null)
  const [form] = Form.useForm()

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  async function load() {
    setLoading(true)
    try {
      const res = await adminApi.getEvents()
      setEvents(res.events ?? [])
    } catch { message.error('載入失敗') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  function openCreate() {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ is_active: true, is_hot: false, sort_order: 0, tag: '限時' })
    setModalOpen(true)
  }

  function openEdit(ev) {
    setEditing(ev)
    form.setFieldsValue({
      title:       ev.title,
      description: ev.description,
      image_url:   ev.image_url,
      tag:         ev.tag,
      is_hot:      ev.is_hot,
      is_active:   ev.is_active,
      sort_order:  ev.sort_order,
      start_at:    ev.start_at ? dayjs(ev.start_at) : null,
      end_at:      ev.end_at   ? dayjs(ev.end_at)   : null,
    })
    setModalOpen(true)
  }

  async function handleSave() {
    let values
    try { values = await form.validateFields() } catch { return }

    const payload = {
      title:       values.title,
      description: values.description || null,
      image_url:   values.image_url   || null,
      tag:         values.tag,
      tag_color:   TAG_COLOR_MAP[values.tag] ?? '#57d46f',
      is_hot:      Boolean(values.is_hot),
      is_active:   Boolean(values.is_active),
      sort_order:  values.sort_order ?? 0,
      start_at:    values.start_at ? values.start_at.toISOString() : null,
      end_at:      values.end_at   ? values.end_at.toISOString()   : null,
    }

    try {
      if (editing) {
        await adminApi.updateEvent(editing.id, payload)
        message.success('已更新')
      } else {
        await adminApi.createEvent(payload)
        message.success('已新增')
      }
      setModalOpen(false)
      load()
    } catch (e) { message.error(e.message) }
  }

  async function handleToggle(ev) {
    try {
      const res = await adminApi.toggleEvent(ev.id)
      setEvents(prev => prev.map(e => e.id === ev.id ? res.event : e))
    } catch (e) { message.error(e.message) }
  }

  async function handleDelete(id) {
    try {
      await adminApi.deleteEvent(id)
      setEvents(prev => prev.filter(e => e.id !== id))
      message.success('已刪除')
    } catch (e) { message.error(e.message) }
  }

  async function handleSortOrderChange(id, newOrder) {
    const updated = events.map(e => e.id === id ? { ...e, sort_order: newOrder } : e)
    setEvents(updated)
    try {
      await adminApi.reorderEvents([{ id, sort_order: newOrder }])
    } catch { message.error('排序更新失敗') }
  }

  async function handleDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = events.findIndex(e => e.id === active.id)
    const newIndex = events.findIndex(e => e.id === over.id)
    const reordered = arrayMove(events, oldIndex, newIndex)
    const orders = reordered.map((e, i) => ({ id: e.id, sort_order: i }))
    setEvents(reordered.map((e, i) => ({ ...e, sort_order: i })))
    try {
      await adminApi.reorderEvents(orders)
    } catch { message.error('排序更新失敗'); load() }
  }

  const columns = [
    {
      key: 'drag',
      width: 40,
      render: (_, record) => (
        <HolderOutlined style={{ color: '#666', cursor: 'grab', touchAction: 'none' }} />
      ),
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
      title: '標籤',
      dataIndex: 'tag',
      width: 80,
      render: (tag, record) => (
        <Tag color={record.tag_color} style={{ color: '#000', fontWeight: 600 }}>{tag}</Tag>
      ),
    },
    {
      title: '標題',
      dataIndex: 'title',
      render: (title, record) => (
        <span>
          {title}
          {record.is_hot && <Tag color="volcano" style={{ marginLeft: 6 }}>HOT</Tag>}
        </span>
      ),
    },
    {
      title: '狀態',
      width: 90,
      render: (_, record) => {
        const s = getStatus(record)
        return <Tag color={s.color}>{s.label}</Tag>
      },
    },
    {
      title: '時間範圍',
      width: 200,
      render: (_, record) => {
        const fmt = iso => iso ? dayjs(iso).format('MM/DD HH:mm') : '—'
        return <span style={{ fontSize: 12, color: '#888' }}>{fmt(record.start_at)} → {fmt(record.end_at)}</span>
      },
    },
    {
      title: '上架',
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
        <Title level={4} style={{ margin: 0 }}>限時活動管理</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增活動</Button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={events.map(e => e.id)} strategy={verticalListSortingStrategy}>
          <Table
            rowKey="id"
            dataSource={events}
            columns={columns}
            loading={loading}
            pagination={false}
            components={{ body: { row: DraggableRow } }}
            onRow={record => ({ 'data-row-key': record.id })}
          />
        </SortableContext>
      </DndContext>

      <Modal
        title={editing ? '編輯活動' : '新增活動'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        okText={editing ? '儲存' : '新增'}
        cancelText="取消"
        width={560}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="title" label="標題" rules={[{ required: true, message: '請輸入標題' }]}>
            <Input placeholder="活動標題" maxLength={100} />
          </Form.Item>
          <Form.Item name="description" label="內容說明">
            <TextArea rows={3} placeholder="活動說明文字" maxLength={500} showCount />
          </Form.Item>
          <Form.Item name="image_url" label="活動圖片路徑（選填）">
            <Input placeholder="例：/images/events/banner.jpg" />
          </Form.Item>
          <Space style={{ width: '100%' }} size={12}>
            <Form.Item name="tag" label="分類" style={{ flex: 1, minWidth: 120 }}>
              <Select
                options={TAG_PRESETS.map(t => ({
                  value: t.label,
                  label: (
                    <span>
                      <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: t.color, marginRight: 6 }} />
                      {t.label}
                    </span>
                  ),
                }))}
              />
            </Form.Item>
            <Form.Item name="sort_order" label="排序數字" style={{ width: 100 }}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }} size={12}>
            <Form.Item name="start_at" label="開始時間（選填）">
              <DatePicker showTime format="YYYY-MM-DD HH:mm" placeholder="留空 = 即時生效" style={{ width: 220 }} />
            </Form.Item>
            <Form.Item name="end_at" label="結束時間（選填）">
              <DatePicker showTime format="YYYY-MM-DD HH:mm" placeholder="留空 = 永久有效" style={{ width: 220 }} />
            </Form.Item>
          </Space>
          <Space size={24}>
            <Form.Item name="is_hot" label="HOT 標籤" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="is_active" label="立即上架" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  )
}
