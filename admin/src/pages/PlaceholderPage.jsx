import { Typography } from 'antd'
export default function PlaceholderPage({ title }) {
  return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <Typography.Title level={4} style={{ color: '#666' }}>
        {title} — 即將推出
      </Typography.Title>
    </div>
  )
}
