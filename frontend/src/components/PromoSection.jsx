function PromoSection({ onPromoClick }) {
  return (
    <section className="promos">
      <div className="promo-stack">
        <div className="promo-card-wrap">
          <article className="promo-card" onClick={onPromoClick}>
            <div className="promo-body">
              <h3>每日簽到</h3>
              <p>連續登入即可領取豐富獎勵，<br />助你贏在起點，回饋無極限！</p>
            </div>
          </article>
          <div className="promo-side" onClick={onPromoClick}>
              <button type="button" className="promo-cta"></button>
            </div>
        </div>
      </div>
      <div className="promo-dots">
        <span className="promo-dot promo-dot--active" />
      </div>
    </section>
  )
}

export default PromoSection
