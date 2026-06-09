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

// ── Web Audio API ─────────────────────────────────────────────────────────────

let _audioCtx = null
let _bgmGain  = null
let _sfxGain  = null
const _wiredSet = new WeakSet()

function _initCtx() {
  if (_audioCtx) return
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) return
  _audioCtx = new Ctx()
  _bgmGain = _audioCtx.createGain()
  _sfxGain = _audioCtx.createGain()
  _bgmGain.gain.value = _bgmMuted ? 0 : _bgmVolume
  _sfxGain.gain.value = _sfxMuted ? 0 : _sfxVolume
  _bgmGain.connect(_audioCtx.destination)
  _sfxGain.connect(_audioCtx.destination)
}

function _wire(audio, isBgm) {
  if (_wiredSet.has(audio) || !_audioCtx) return
  try {
    const src = _audioCtx.createMediaElementSource(audio)
    src.connect(isBgm ? _bgmGain : _sfxGain)
    _wiredSet.add(audio)
  } catch {}
}

// ── Public setters ────────────────────────────────────────────────────────────

export function setGlobalBgmMuted(v) {
  _rawSetBgmMuted(v)
  if (_bgmGain) _bgmGain.gain.value = v ? 0 : _bgmVolume
  window.dispatchEvent(new Event(SETTINGS_EVENT))
}
export function setGlobalSfxMuted(v) {
  _rawSetSfxMuted(v)
  if (_sfxGain) _sfxGain.gain.value = v ? 0 : _sfxVolume
  window.dispatchEvent(new Event(SETTINGS_EVENT))
}
export function setGlobalBgmVolume(v) {
  _rawSetBgmVolume(v)
  if (_bgmGain) _bgmGain.gain.value = _bgmMuted ? 0 : v
  window.dispatchEvent(new Event(SETTINGS_EVENT))
}
export function setGlobalSfxVolume(v) {
  _rawSetSfxVolume(v)
  if (_sfxGain) _sfxGain.gain.value = _sfxMuted ? 0 : v
  window.dispatchEvent(new Event(SETTINGS_EVENT))
}

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
  audio.src  = overrides.src  ?? config.src
  audio.loop = overrides.loop ?? config.loop ?? false
  if (_audioCtx) {
    // GainNode controls volume; element must not be muted
    audio.muted  = false
    audio.volume = 1
  } else {
    const isMuted = _bgmMuted
    audio.volume  = isMuted ? 0 : (overrides.volume ?? config.volume ?? 1) * _bgmVolume
    audio.muted   = isMuted
  }
  audio.currentTime = overrides.currentTime ?? 0
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useAudio() {
  const audioRegistryRef = useRef(new Map())

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
      // Init Web Audio on first user-triggered play; wire element through GainNode
      _initCtx()
      _wire(audio, Boolean(config.bgm))
      if (_audioCtx?.state === 'suspended') await _audioCtx.resume()

      if (config.bgm) {
        const hasOverrides = Object.keys(overrides).length > 0
        if (!audio.paused && !hasOverrides) return true
        if (!audio.paused) audio.pause()
        applyBgmSettings(audio, config, hasOverrides ? overrides : {})
        if (!hasOverrides && audio.currentTime > 0.05) audio.currentTime = 0
        await audio.play()
      } else {
        audio.currentTime = 0
        if (_audioCtx) {
          audio.muted  = false
          audio.volume = 1
        } else {
          audio.volume = effectiveVolume(config)
          audio.muted  = _sfxMuted
        }
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
    })
  }, [getAudio])

  // Live-update gain when BGM settings change
  useEffect(() => {
    if (_bgmGain) {
      _bgmGain.gain.value = bgmMuted ? 0 : bgmVolume
      return
    }
    // Fallback for browsers without Web Audio
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

  const setBgmMuted = useCallback((v) => {
    _rawSetBgmMuted(v)
    if (_bgmGain) _bgmGain.gain.value = v ? 0 : _bgmVolume
    setBgmMutedState(v)
  }, [])

  const setSfxMuted = useCallback((v) => {
    _rawSetSfxMuted(v)
    if (_sfxGain) _sfxGain.gain.value = v ? 0 : _sfxVolume
    setSfxMutedState(v)
  }, [])

  const setBgmVolume = useCallback((v) => {
    _rawSetBgmVolume(v)
    if (_bgmGain) _bgmGain.gain.value = _bgmMuted ? 0 : v
    setBgmVolumeState(v)
  }, [])

  const setSfxVolume = useCallback((v) => {
    _rawSetSfxVolume(v)
    if (_sfxGain) _sfxGain.gain.value = _sfxMuted ? 0 : v
    setSfxVolumeState(v)
  }, [])

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
