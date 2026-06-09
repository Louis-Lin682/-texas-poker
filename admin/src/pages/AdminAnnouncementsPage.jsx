import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Typography,
} from 'antd'
import { useEffect, useState } from 'react'
import { adminApi } from '../services/adminApi'

const { Title } = Typography
const { TextArea } = Input

export default function AdminAnnouncementsPage() {
  const { message } = App.useApp()
  const [list,      setList]      = useState([])
  const [loading,   setLoading]   = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing,   setEditing]   = useState(null)
  const [form] = Form.useForm()

  async function load() {
    setLoading(true)
    try {
      const res = await adminApi.getAnnouncements()
      setList(res.announcements ?? [])
    } catch { message.error('載入失敗') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  function openCreate() {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ is_active: true, sort_order: 0 })
    setModalOpen(true)
  }

  function openEdit(r) {
    setEditing(r)
    form.setFieldsValue({ content: r.content, sort_order: r.sort_order, is_active: r.is_active })
    setModalOpen(true)
  }

  async function handleSave() {
    let values
    try { values = await form.validateFields() } catch { return }
    const payload = {
      content:    values.content,
      sort_order: values.sort_order ?? 0,
      is_active:  Boolean(values.is_active),
    }
    try {
      if (editing) {
        await adminApi.updateAnnouncement(editing.id, payload)
        message.success('已更新')
      } else {
        await adminApi.createAnnouncement(payload)
        message.success('已新增')
      }
      setModalOpen(false)
      load()
    } catch (e) { message.error(e.message) }
  }

  async function handleToggle(r) {
    try {
      const res = await adminApi.toggleAnnouncement(r.id)
      setList(prev => prev.map(item => item.id === r.id ? res.announcement : item))
    } catch (e) { message.error(e.message) }
  }

  async function handleDelete(id) {
    try {
      await adminApi.deleteAnnouncement(id)
      setList(prev => prev.filter(r => r.id !== id))
      message.success('已刪除')
    } catch (e) { message.error(e.message) }
  }

  const columns = [
    {
      title: '排序',
      dataIndex: 'sort_order',
      width: 60,
    },
    {
      title: '公告內容',
      dataIndex: 'content',
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
        <Title level={4} style={{ margin: 0 }}>跑馬燈公告</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增公告</Button>
      </div>

      <Table
        rowKey="id"
        dataSource={list}
        columns={columns}
        loading={loading}
        pagination={{ pageSize: 20 }}
      />

      <Modal
        title={editing ? '編輯公告' : '新增公告'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        okText={editing ? '儲存' : '新增'}
        cancelText="取消"
        width={500}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="content" label="公告內容" rules={[{ required: true, message: '請輸入內容' }]}>
            <TextArea rows={3} placeholder="顯示在大廳跑馬燈的文字" maxLength={200} showCount />
          </Form.Item>
          <Space size={24}>
            <Form.Item name="sort_order" label="排序（小的優先）">
              <InputNumber min={0} style={{ width: 120 }} />
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
