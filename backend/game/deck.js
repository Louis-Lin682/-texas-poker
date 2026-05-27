export const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A']
export const SUITS = ['h','d','c','s']

export function createDeck() {
  const cards = []
  for (const suit of SUITS)
    for (const rank of RANKS)
      cards.push(rank + suit)
  return cards
}

export function shuffle(deck) {
  const d = [...deck]
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[d[i], d[j]] = [d[j], d[i]]
  }
  return d
}

// 0 = '2', 12 = 'A'
export function rankIndex(card) {
  return RANKS.indexOf(card.slice(0, -1))
}
