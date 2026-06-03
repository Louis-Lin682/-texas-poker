export const audioMap = {
  uiClick: {
    src: '/audio/ui/click.mp3',
    volume: 0.55,
  },
  uiHover: {
    src: '/audio/ui/hover.mp3',
    volume: 0.35,
  },
  uiWhoosh: {
    src: '/audio/ui/whoosh.mp3',
    volume: 0.42,
  },
  lobbyBgm: {
    src: '/audio/bgm/BgSound.mp3',
    volume: 0.28,
    loop: true,
    bgm: true,
  },
  chipDrop: {
    src: '/audio/game/chip-drop.mp3',
    volume: 0.6,
  },
  cardFlip: {
    src: '/audio/game/card-flip.mp3',
    volume: 0.5,
  },
  cardDeal: {
    src: '/audio/game/fly_card.mp3',
    volume: 0.55,
  },
  bigTwoBgm: {
    src: '/audio/big-two/bigTwoGameBg.mp3',
    volume: 0.28,
    loop: true,
    bgm: true,
  },
}

export const audioKeys = Object.keys(audioMap)
