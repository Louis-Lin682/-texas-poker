let _bgmMuted = false

export function getAudioSettings() {
  return { bgmMuted: _bgmMuted, sfxMuted: false, bgmVolume: 1, sfxVolume: 1 }
}

export function setGlobalBgmMuted(v) {
  _bgmMuted = v
}
