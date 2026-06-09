import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
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

const CATEGORY_OPTIONS = [
  { value: '活動', label: '活動' },
  { value: '系統', label: '系統' },
  { value: '公告', label: '公告' },
  { value: '更新', label: '更新' },
]

const CATEGORY_COLOR = {
  活動: 'green',
  系統: 'cyan',
  公告: 'gold',
  更新: 'orange',
}

export default function AdminNewsPage() {
  const { message } = App.useApp()
  const [news,      setNews]      = useState([])
  const [loading,   setLoading]   = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing,   setEditing]   = useState(null)
  const [form] = Form.useForm()

  async function load() {
    setLoading(true)
    try {
      const res = await adminApi.getNews()
      setNews(res.news ?? [])
    } catch { message.error('載入失敗') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  function openCreate() {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ is_active: true, category: '公告', sort_order: 0, published_at: dayjs() })
    setModalOpen(true)
  }

  function openEdit(n) {
    setEditing(n)
    form.setFieldsValue({
      title:        n.title,
      content:      n.content,
      category:     n.category,
      sort_order:   n.sort_order,
      is_active:    n.is_active,
      published_at: n.published_at ? dayjs(n.published_at) : dayjs(),
      start_at:     n.start_at ? dayjs(n.start_at) : null,
      end_at:       n.end_at   ? dayjs(n.end_at)   : null,
    })
    setModalOpen(true)
  }

  async function handleSave() {
    let values
    try { values = await form.validateFields() } catch { return }

    const payload = {
      title:        values.title,
      content:      values.content || null,
      category:     values.category,
      published_at: values.published_at ? values.published_at.toISOString() : new Date().toISOString(),
      start_at:     values.start_at ? values.start_at.toISOString() : null,
      end_at:       values.end_at   ? values.end_at.toISOString()   : null,
      sort_order:   values.sort_order ?? 0,
      is_active:    Boolean(values.is_active),
    }

    try {
      if (editing) {
        await adminApi.updateNews(editing.id, payload)
        message.success('已更新')
      } else {
        await adminApi.createNews(payload)
        message.success('已新增')
      }
      setModalOpen(false)
      load()
    } catch (e) { message.error(e.message) }
  }

  async function handleToggle(n) {
    try {
      const res = await adminApi.toggleNews(n.id)
      setNews(prev => prev.map(item => item.id === n.id ? res.news : item))
    } catch (e) { message.error(e.message) }
  }

  async function handleDelete(id) {
    try {
      await adminApi.deleteNews(id)
      setNews(prev => prev.filter(n => n.id !== id))
      message.success('已刪除')
    } catch (e) { message.error(e.message) }
  }

  const columns = [
    {
      title: '分類',
      dataIndex: 'category',
      width: 70,
      render: cat => <Tag color={CATEGORY_COLOR[cat] ?? 'default'}>{cat}</Tag>,
    },
    {
      title: '標題',
      dataIndex: 'title',
    },
    {
      title: '發佈時間',
      dataIndex: 'published_at',
      width: 140,
      render: v => v ? dayjs(v).format('MM-DD HH:mm') : '—',
    },
    {
      title: '開始',
      dataIndex: 'start_at',
      width: 120,
      render: v => v ? dayjs(v).format('MM-DD HH:mm') : <span style={{ color: '#555' }}>即時</span>,
    },
    {
      title: '結束',
      dataIndex: 'end_at',
      width: 120,
      render: v => v ? dayjs(v).format('MM-DD HH:mm') : <span style={{ color: '#555' }}>永久</span>,
    },
    {
      title: '上架',
      width: 60,
      render: (_, record) => (
        <Switch checked={record.is_active} size="small" onChange={() => handleToggle(record)} />
      ),
    },
    {
      title: '操作',
      width: 80,
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
        <Title level={4} style={{ margin: 0 }}>最新消息管理</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增消息</Button>
      </div>

      <Table
        rowKey="id"
        dataSource={news}
        columns={columns}
        loading={loading}
        pagination={{ pageSize: 20 }}
      />

      <Modal
        title={editing ? '編輯消息' : '新增消息'}
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
            <Input placeholder="消息標題" maxLength={100} />
          </Form.Item>
          <Form.Item name="content" label="內容">
            <TextArea rows={5} placeholder="消息內容" maxLength={2000} showCount />
          </Form.Item>
          <Space style={{ width: '100%' }} size={12}>
            <Form.Item name="category" label="分類" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Select options={CATEGORY_OPTIONS} />
            </Form.Item>
            <Form.Item name="published_at" label="發佈時間" style={{ flex: 1 }}>
              <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }} size={12}>
            <Form.Item name="start_at" label="顯示開始（留空=即時）" style={{ flex: 1 }}>
              <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="end_at" label="顯示結束（留空=永久）" style={{ flex: 1 }}>
              <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Space size={24}>
            <Form.Item name="sort_order" label="排序">
              <InputNumber min={0} style={{ width: 100 }} />
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
