import { useCallback, useEffect, useRef, useState } from 'react'
import { audioMap } from '../data/audio'

// ── Module-level globals (shared across all hook instances) ──────────────────

const K = {
  bgmMuted:  'audio_bgm_muted',
  sfxMuted:  'audio_sfx_muted',
  bgmVol:    'audio_bgm_vol',
  sfxVol:    'audio_sfx_vol',
}

function readFloat(key, def) {
  const v = parseFloat(localStorage.getItem(key))
  return isNaN(v) ? def : Math.max(0, Math.min(1, v))
}

let _bgmMuted  = localStorage.getItem(K.bgmMuted) === '1'
let _sfxMuted  = localStorage.getItem(K.sfxMuted) === '1'
let _bgmVolume = readFloat(K.bgmVol, 1)
let _sfxVolume = readFloat(K.sfxVol, 1)

const SETTINGS_EVENT = 'audio:settings'

function _rawSetBgmMuted(v)  { _bgmMuted  = v; localStorage.setItem(K.bgmMuted, v ? '1' : '0') }
function _rawSetSfxMuted(v)  { _sfxMuted  = v; localStorage.setItem(K.sfxMuted, v ? '1' : '0') }
function _rawSetBgmVolume(v) { _bgmVolume = v; localStorage.setItem(K.bgmVol, String(v)) }
function _rawSetSfxVolume(v) { _sfxVolume = v; localStorage.setItem(K.sfxVol, String(v)) }

export function setGlobalBgmMuted(v)  { _rawSetBgmMuted(v);  window.dispatchEvent(new Event(SETTINGS_EVENT)) }
export function setGlobalSfxMuted(v)  { _rawSetSfxMuted(v);  window.dispatchEvent(new Event(SETTINGS_EVENT)) }
export function setGlobalBgmVolume(v) { _rawSetBgmVolume(v); window.dispatchEvent(new Event(SETTINGS_EVENT)) }
export function setGlobalSfxVolume(v) { _rawSetSfxVolume(v); window.dispatchEvent(new Event(SETTINGS_EVENT)) }

export function getAudioSettings() {
  return {
    bgmMuted:  _bgmMuted,
    sfxMuted:  _sfxMuted,
    bgmVolume: _bgmVolume,
    sfxVolume: _sfxVolume,
  }
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function effectiveVolume(config) {
  const isBgm   = Boolean(config.bgm)
  const muted   = isBgm ? _bgmMuted : _sfxMuted
  const globalV = isBgm ? _bgmVolume : _sfxVolume
  return muted ? 0 : (config.volume ?? 1) * globalV
}

function applyBgmSettings(audio, config, overrides = {}) {
  const isMuted  = _bgmMuted
  const globalV  = _bgmVolume
  audio.src      = overrides.src  ?? config.src
  audio.loop     = overrides.loop ?? config.loop ?? false
  audio.volume   = isMuted ? 0 : (overrides.volume ?? config.volume ?? 1) * globalV
  audio.muted    = isMuted
  audio.currentTime = overrides.currentTime ?? 0
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useAudio() {
  const audioRegistryRef = useRef(new Map())

  // React state mirrors — used so components can re-render on change
  const [bgmMuted,  setBgmMutedState]  = useState(_bgmMuted)
  const [sfxMuted,  setSfxMutedState]  = useState(_sfxMuted)
  const [bgmVolume, setBgmVolumeState] = useState(_bgmVolume)
  const [sfxVolume, setSfxVolumeState] = useState(_sfxVolume)

  const getAudio = useCallback((key) => {
    const config = audioMap[key]
    if (!config) return null
    if (!audioRegistryRef.current.has(key)) {
      audioRegistryRef.current.set(key, new Audio(config.src))
    }
    return audioRegistryRef.current.get(key)
  }, [])

  const play = useCallback(async (key, overrides = {}) => {
    const config = audioMap[key]
    const audio  = getAudio(key)
    if (!config || !audio) return false

    try {
      if (config.bgm) {
        const hasOverrides = Object.keys(overrides).length > 0
        if (!audio.paused && !hasOverrides) return true
        if (!audio.paused) audio.pause()
        applyBgmSettings(audio, config, hasOverrides ? overrides : {})
        if (!hasOverrides && audio.currentTime > 0.05) audio.currentTime = 0
        await audio.play()
      } else {
        audio.currentTime = 0
        audio.volume = effectiveVolume(config)
        audio.muted  = _sfxMuted
        await audio.play()
      }
      return true
    } catch {
      return false
    }
  }, [getAudio])

  const pause = useCallback((key) => {
    audioRegistryRef.current.get(key)?.pause()
  }, [])

  const stop = useCallback((key) => {
    const audio = audioRegistryRef.current.get(key)
    if (!audio) return
    audio.pause()
    audio.currentTime = 0
  }, [])

  const stopAll = useCallback(() => {
    audioRegistryRef.current.forEach((audio) => {
      audio.pause()
      audio.currentTime = 0
    })
  }, [])

  const preload = useCallback((keys = Object.keys(audioMap)) => {
    keys.forEach((key) => {
      const config = audioMap[key]
      const audio  = getAudio(key)
      if (!config || !audio) return
      audio.preload = 'auto'
      audio.load()
    })
  }, [getAudio])

  // Live-update any currently-playing BGM when settings change
  useEffect(() => {
    audioRegistryRef.current.forEach((audio, key) => {
      const config = audioMap[key]
      if (!config?.bgm) return
      audio.muted  = bgmMuted
      audio.volume = bgmMuted ? 0 : (config.volume ?? 1) * bgmVolume
    })
  }, [bgmMuted, bgmVolume])

  // Sync React state when settings are changed externally (e.g. SettingsPage)
  useEffect(() => {
    function sync() {
      setBgmMutedState(_bgmMuted)
      setSfxMutedState(_sfxMuted)
      setBgmVolumeState(_bgmVolume)
      setSfxVolumeState(_sfxVolume)
    }
    window.addEventListener(SETTINGS_EVENT, sync)
    return () => window.removeEventListener(SETTINGS_EVENT, sync)
  }, [])

  // Expose setters that update both module globals and React state
  const setBgmMuted = useCallback((v) => {
    _rawSetBgmMuted(v)
    setBgmMutedState(v)
  }, [])

  const setSfxMuted = useCallback((v) => {
    _rawSetSfxMuted(v)
    setSfxMutedState(v)
  }, [])

  const setBgmVolume = useCallback((v) => {
    _rawSetBgmVolume(v)
    setBgmVolumeState(v)
  }, [])

  const setSfxVolume = useCallback((v) => {
    _rawSetSfxVolume(v)
    setSfxVolumeState(v)
  }, [])

  // Backward-compat alias (old code that calls toggleMute treats BGM as "the" mute)
  const isMuted    = bgmMuted
  const toggleMute = useCallback(() => setBgmMuted(!_bgmMuted), [setBgmMuted])

  useEffect(() => {
    const registry = audioRegistryRef.current
    return () => {
      registry.forEach((audio) => { audio.pause(); audio.src = '' })
      registry.clear()
    }
  }, [])

  return {
    bgmMuted, sfxMuted, bgmVolume, sfxVolume,
    setBgmMuted, setSfxMuted, setBgmVolume, setSfxVolume,
    isMuted, toggleMute,
    play, pause, stop, stopAll, preload,
  }
}
