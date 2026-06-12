import { useNavigate } from 'react-router-dom'

function QuickActions({ items, onAction }) {
  const navigate = useNavigate()

  return (
    <section className="quick-actions">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          className="quick-action"
          style={{
            '--quick-accent': item.accent,
            '--quick-accent-soft': item.accentSoft,
          }}
          onClick={() => {
            if (item.route) navigate(item.route)
            else if (item.action) onAction?.(item.action)
          }}
        >
          <span className="quick-icon">
            <img className="quick-icon-image" src={item.imageUrl} alt={item.label} loading="lazy" />
          </span>
        </button>
      ))}
    </section>
  )
}

export default QuickActions
