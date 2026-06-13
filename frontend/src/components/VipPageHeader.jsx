function VipPageHeader({ title, eyebrow }) {
  return (
    <div className="event-page-vip-banner">
      <div className="event-header-content">
        <span className="event-header-eyebrow">{eyebrow}</span>
        <div className="event-header-title-row">
          <span className="event-header-title-line" aria-hidden="true" />
          <h1 className="event-header-title">{title}</h1>
          <span className="event-header-title-line" aria-hidden="true" />
        </div>
      </div>
    </div>
  )
}

export default VipPageHeader
