import { Howl } from 'howler'
import { useCallback, useEffect, useState } from 'react'
import { audioMap } from '../data/audio'

// ── Settings persistence ──────────────────────────────────────────────────────
const K = { bgmMuted: 'audio_bgm_muted', bgmVol: 'audio_bgm_vol', sfxVol: 'audio_sfx_vol' }

function readFloat(key, def) {
  const v = parseFloat(localStorage.getItem(key))
  return isNaN(v) ? def : Math.max(0, Math.min(1, v))
}

let _bgmMuted  = localStorage.getItem(K.bgmMuted) === '1'
let _bgmVolume = readFloat(K.bgmVol, 1)
let _sfxVolume = readFloat(K.sfxVol, 1)

// ── Howl instance cache ───────────────────────────────────────────────────────
const _howls  = {}   // key → Howl
const _bgmIds = {}   // key → active BGM sound ID (for pause/resume tracking)

function _vol(key) {
  const c = audioMap[key]
  if (!c) return 0
  return c.bgm
    ? (_bgmMuted ? 0 : (c.volume ?? 1) * _bgmVolume)
    : (c.volume ?? 1) * _sfxVolume
}

function _getHowl(key) {
  if (_howls[key]) return _howls[key]
  const c = audioMap[key]
  if (!c) return null
  const h = new Howl({
    src:     [c.src],
    volume:  _vol(key),
    loop:    c.loop ?? false,
    html5:   Boolean(c.bgm),   // BGM: streaming; SFX: decoded AudioBuffer
    preload: true,
  })
  if (c.bgm) {
    // iOS/Safari blocks autoplay for html5 audio not triggered by user gesture.
    // When playerror fires, register a one-time gesture listener to retry.
    h.on('playerror', (id) => {
      const unlock = () => {
        document.removeEventListener('click', unlock)
        document.removeEventListener('touchstart', unlock)
        // Only retry if this ID is still the active playback (not stopped/replaced)
        if (_bgmIds[key] === id) h.play(id)
      }
      document.addEventListener('click', unlock)
      document.addEventListener('touchstart', unlock)
    })
  }
  _howls[key] = h
  return h
}

// ── Module-level helpers for sub-components that can't call the hook ──────────
export function playSfx(key) { _getHowl(key)?.play() }
export function stopSfx(key) { _howls[key]?.stop() }

// Mute/unmute a specific Howl without pausing (preserves playback position)
export function muteHowl(key, muted) {
  const id = _bgmIds[key]
  id !== undefined ? _howls[key]?.mute(muted, id) : _howls[key]?.mute(muted)
}

// ── Public settings API ───────────────────────────────────────────────────────
const SETTINGS_EVENT = 'audio:settings'

export function setGlobalBgmMuted(v) {
  _bgmMuted = v
  localStorage.setItem(K.bgmMuted, v ? '1' : '0')
  Object.keys(audioMap).filter(k => audioMap[k].bgm).forEach(k => _howls[k]?.volume(_vol(k)))
  window.dispatchEvent(new Event(SETTINGS_EVENT))
}

export function setGlobalSfxMuted() {}  // kept for API compat; SFX is always on

export function setGlobalBgmVolume(v) {
  _bgmVolume = v
  localStorage.setItem(K.bgmVol, String(v))
  Object.keys(audioMap).filter(k => audioMap[k].bgm).forEach(k => _howls[k]?.volume(_vol(k)))
  window.dispatchEvent(new Event(SETTINGS_EVENT))
}

export function setGlobalSfxVolume(v) {
  _sfxVolume = v
  localStorage.setItem(K.sfxVol, String(v))
  Object.keys(audioMap).filter(k => !audioMap[k].bgm).forEach(k => _howls[k]?.volume(_vol(k)))
  window.dispatchEvent(new Event(SETTINGS_EVENT))
}

export function getAudioSettings() {
  return { bgmMuted: _bgmMuted, sfxMuted: false, bgmVolume: _bgmVolume, sfxVolume: _sfxVolume }
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useAudio() {
  const [bgmMuted,  setBgmMutedState]  = useState(_bgmMuted)
  const [sfxMuted,  setSfxMutedState]  = useState(false)
  const [bgmVolume, setBgmVolumeState] = useState(_bgmVolume)
  const [sfxVolume, setSfxVolumeState] = useState(_sfxVolume)

  const play = useCallback(async (key, overrides = {}) => {
    const c = audioMap[key]
    if (!c) return false
    const howl = _getHowl(key)
    if (!howl) return false

    if (c.bgm) {
      if (_bgmIds[key] !== undefined) {
        if (overrides.volume !== undefined) howl.volume(_bgmMuted ? 0 : overrides.volume * _bgmVolume)
        if (overrides.loop   !== undefined) howl.loop(overrides.loop)
        // Already playing → no-op; paused → resume from current position
        if (howl.playing(_bgmIds[key])) return true
        howl.play(_bgmIds[key])
        return true
      }
      howl.stop()
      delete _bgmIds[key]
      if (overrides.volume !== undefined) howl.volume(_bgmMuted ? 0 : overrides.volume)
      if (overrides.loop   !== undefined) howl.loop(overrides.loop)
      _bgmIds[key] = howl.play()
    } else {
      // SFX: Howler creates an independent AudioBufferSourceNode per call —
      // rapid plays overlap cleanly without interrupting each other.
      howl.play()
    }
    return true
  }, [])

  const pause = useCallback((key) => {
    const c = audioMap[key]
    if (c?.bgm && _bgmIds[key] !== undefined) {
      _howls[key]?.pause(_bgmIds[key])
    } else {
      _howls[key]?.pause()
    }
  }, [])

  const stop = useCallback((key) => {
    if (_bgmIds[key] !== undefined) {
      _howls[key]?.stop(_bgmIds[key])
      delete _bgmIds[key]
    } else {
      _howls[key]?.stop()
    }
  }, [])

  const stopAll = useCallback(() => {
    Object.values(_howls).forEach(h => h.stop())
    Object.keys(_bgmIds).forEach(k => delete _bgmIds[k])
  }, [])

  const preload = useCallback((keys = Object.keys(audioMap)) => {
    keys.forEach(_getHowl)   // creates + starts loading each Howl
  }, [])

  useEffect(() => {
    function sync() {
      setBgmMutedState(_bgmMuted)
      setBgmVolumeState(_bgmVolume)
      setSfxVolumeState(_sfxVolume)
    }
    window.addEventListener(SETTINGS_EVENT, sync)
    return () => window.removeEventListener(SETTINGS_EVENT, sync)
  }, [])

  const setBgmMuted  = useCallback((v) => { setGlobalBgmMuted(v);  setBgmMutedState(v)  }, [])
  const setSfxMuted  = useCallback(() => {}, [])
  const setBgmVolume = useCallback((v) => { setGlobalBgmVolume(v); setBgmVolumeState(v) }, [])
  const setSfxVolume = useCallback((v) => { setGlobalSfxVolume(v); setSfxVolumeState(v) }, [])

  const isMuted    = bgmMuted
  const toggleMute = useCallback(() => setGlobalBgmMuted(!_bgmMuted), [])

  return {
    bgmMuted, sfxMuted, bgmVolume, sfxVolume,
    setBgmMuted, setSfxMuted, setBgmVolume, setSfxVolume,
    isMuted, toggleMute,
    play, pause, stop, stopAll, preload,
  }
}
