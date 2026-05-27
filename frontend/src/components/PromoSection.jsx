import SectionHeader from './SectionHeader'

function PromoSection({ items }) {
  return (
    <section className="promos">
      <SectionHeader title="精彩活動" />

      <div className="promo-stack">
        {items.map((promo) => (
          <article
            key={promo.title}
            className="promo-card"
            style={{ '--promo-bg': `url(${promo.imageUrl})` }}
          >
            <div className="promo-copy">
              <h3>{promo.title}</h3>
              <p>{promo.text}</p>
            </div>
            <button type="button" className="promo-cta">
              {promo.action}
            </button>
          </article>
        ))}
      </div>
    </section>
  )
}

export default PromoSection
