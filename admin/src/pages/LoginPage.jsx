import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Form, Input, Typography } from 'antd'
import { useState } from 'react'
import { useAdminAuth } from '../context/AdminAuthContext'

const { Title } = Typography

export default function LoginPage() {
  const { login } = useAdminAuth()
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)

  async function onFinish({ username, password }) {
    setError('')
    setLoading(true)
    try {
      await login(username, password)
    } catch (e) {
      setError(e.message || '登入失敗')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#0d0d14',
    }}>
      <Card style={{ width: 360, background: '#16161f', border: '1px solid #2a2a3a' }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <Title level={3} style={{ color: '#f0d080', margin: 0 }}>後台管理系統</Title>
          <div style={{ color: '#666', fontSize: 13, marginTop: 4 }}>Texas Poker Admin</div>
        </div>

        {error && <Alert message={error} type="error" showIcon style={{ marginBottom: 16 }} />}

        <Form layout="vertical" onFinish={onFinish} autoComplete="off">
          <Form.Item name="username" rules={[{ required: true, message: '請輸入帳號' }]}>
            <Input prefix={<UserOutlined />} placeholder="帳號" size="large" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '請輸入密碼' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密碼" size="large" />
          </Form.Item>
          <Button
            type="primary" htmlType="submit" block size="large"
            loading={loading}
            style={{ background: '#c49010', borderColor: '#c49010', fontWeight: 700 }}
          >
            登入
          </Button>
        </Form>
      </Card>
    </div>
  )
}
