import { ArrowLeftOutlined, FileTextOutlined } from '@ant-design/icons'
import {
  App, Button, Card, Col, Descriptions, Form, InputNumber,
  Modal, Row, Tag, Typography,
} from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { adminApi } from '../services/adminApi'

const { Title, Text } = Typography

export default function MemberDetailPage() {
  const { message } = App.useApp()
  const { id } = useParams()
  const navigate = useNavigate()
  const [member,  setMember]  = useState(null)
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [form] = Form.useForm()

  async function load() {
    setLoading(true)
    try {
      const res = await adminApi.getMember(id)
      setMember(res.member)
    } catch { } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [id])

  async function onSave({ balance }) {
    setSaving(true)
    try {
      const res = await adminApi.updateMember(id, { balance })
      setMember(res.member)
      setEditOpen(false)
      message.success('已更新')
    } catch (e) { message.error(e.message) } finally { setSaving(false) }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/members')}>返回</Button>
        <Title level={4} style={{ color: '#e8e8e8', margin: 0 }}>
          會員詳情 {member && `— ${member.username}`}
        </Title>
      </div>

      {member && (
        <Row gutter={16}>
          <Col span={14}>
            <Card style={{ background: '#16161f', border: '1px solid #2a2a3a' }}>
              <Descriptions column={1} size="small">
                <Descriptions.Item label="用戶名">{member.username}</Descriptions.Item>
                <Descriptions.Item label="ID">
                  <Text copyable style={{ fontSize: 11, color: '#888' }}>{member.id}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="狀態">
                  {member.suspended_at
                    ? <Tag color="red">停權中 — {new Date(member.suspended_at).toLocaleString('zh-TW', { hour12: false })}</Tag>
                    : <Tag color="green">正常</Tag>
                  }
                </Descriptions.Item>
                <Descriptions.Item label="籌碼餘額">
                  <span style={{ color: '#f0d080', fontWeight: 700, fontSize: 16 }}>
                    {member.balance.toLocaleString()}
                  </span>
                </Descriptions.Item>
                <Descriptions.Item label="註冊時間">
                  {new Date(member.created_at).toLocaleString('zh-TW', { hour12: false })}
                </Descriptions.Item>
              </Descriptions>

              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <Button
                  type="primary"
                  size="small"
                  style={{ background: '#c49010', borderColor: '#c49010' }}
                  onClick={() => { form.setFieldsValue({ balance: member.balance }); setEditOpen(true) }}
                >
                  編輯餘額
                </Button>
                <Button
                  size="small"
                  icon={<FileTextOutlined />}
                  onClick={() => navigate(`/members/${id}/ledger`)}
                >
                  帳務記錄
                </Button>
              </div>
            </Card>
          </Col>
        </Row>
      )}

      <Modal
        title="編輯餘額"
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saving}
        okText="儲存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" onFinish={onSave}>
          <Form.Item name="balance" label="籌碼餘額" rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
