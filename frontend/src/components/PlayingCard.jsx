const SUIT = { h: '♥', d: '♦', c: '♣', s: '♠' }
const RED   = { h: true, d: true, c: false, s: false }
const RANK_DISPLAY = { T: '10' }

function PlayingCard({ card, faceDown = false, size = 'md' }) {
  if (faceDown) {
    return <div className={`pcard pcard-back pcard-${size}`} />
  }

  const suitCode = card.slice(-1)
  const rank     = card.slice(0, -1)
  const display  = RANK_DISPLAY[rank] ?? rank
  const symbol   = SUIT[suitCode] ?? suitCode
  const isRed    = RED[suitCode] ?? false

  return (
    <div className={`pcard pcard-${size} ${isRed ? 'pcard-red' : 'pcard-black'}`}>
      <span className="pcard-corner pcard-tl">
        <span className="pcard-rank">{display}</span>
        <span className="pcard-suit">{symbol}</span>
      </span>
      <span className="pcard-center">{symbol}</span>
      <span className="pcard-corner pcard-br" aria-hidden="true">
        <span className="pcard-rank">{display}</span>
        <span className="pcard-suit">{symbol}</span>
      </span>
    </div>
  )
}

export default PlayingCard
