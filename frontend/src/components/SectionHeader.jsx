function SectionHeader({ title, actionLabel }) {
  return (
    <div className="section-bar">
      <div className="section-title-wrap">
        <span className="section-title-mark" aria-hidden="true" />
        <h2>{title}</h2>
      </div>
      {actionLabel ? <button type="button">{actionLabel}</button> : null}
    </div>
  )
}

export default SectionHeader
