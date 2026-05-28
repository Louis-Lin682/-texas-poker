import { useCallback, useEffect, useRef, useState } from 'react'
import { audioMap } from '../data/audio'

function applyAudioSettings(audio, config, overrides = {}, muted = false) {
  const nextVolume = overrides.volume ?? config.volume ?? 1

  audio.src = overrides.src ?? config.src
  audio.loop = overrides.loop ?? config.loop ?? false
  audio.volume = muted ? 0 : nextVolume
  audio.muted = muted
  audio.currentTime = overrides.currentTime ?? 0
}

const MUTED_KEY = 'audio_muted'
// module-level: survives component remount; sessionStorage backs it across refresh
let _globalMuted = sessionStorage.getItem(MUTED_KEY) === '1'

export function useAudio(initialMuted = false) {
  const audioRegistryRef = useRef(new Map())
  const [isMuted, setIsMuted] = useState(() => _globalMuted || initialMuted)
  const isMutedRef = useRef(isMuted)
  isMutedRef.current = isMuted

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
    const audio = getAudio(key)
    if (!config || !audio) return false

    const hasOverrides = Object.keys(overrides).length > 0
    const shouldMute = config.bgm ? isMutedRef.current : false

    try {
      if (config.bgm) {
        if (!audio.paused && !hasOverrides) return true
        audio.pause()
        if (hasOverrides) {
          applyAudioSettings(audio, config, overrides, shouldMute)
        } else {
          audio.loop   = config.loop ?? false
          audio.volume = shouldMute ? 0 : config.volume ?? 1
          audio.muted  = shouldMute
          audio.currentTime = 0
        }
        await audio.play()
      } else {
        // UI sounds: cloneNode avoids iOS seek delay from currentTime reset
        const clone = audio.cloneNode()
        clone.volume = shouldMute ? 0 : (overrides.volume ?? config.volume ?? 1)
        clone.muted  = shouldMute
        await clone.play()
      }
      return true
    } catch {
      return false
    }
  }, [getAudio])

  const pause = useCallback((key) => {
    const audio = audioRegistryRef.current.get(key)
    if (!audio) return
    audio.pause()
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
      const audio = getAudio(key)
      if (!config || !audio) return
      audio.preload = 'auto'
      audio.load()
    })
  }, [getAudio])

  const toggleMute = useCallback(() => {
    setIsMuted((current) => {
      const next = !current
      _globalMuted = next
      sessionStorage.setItem(MUTED_KEY, next ? '1' : '0')
      return next
    })
  }, [])

  useEffect(() => {
    audioRegistryRef.current.forEach((audio, key) => {
      const config = audioMap[key]
      if (!config || !config.bgm) return
      audio.muted = isMuted
      audio.volume = isMuted ? 0 : config.volume ?? 1
    })
  }, [isMuted])

  useEffect(() => {
    const registry = audioRegistryRef.current

    return () => {
      registry.forEach((audio) => {
        audio.pause()
        audio.src = ''
      })
      registry.clear()
    }
  }, [])

  return {
    isMuted,
    pause,
    play,
    preload,
    setIsMuted,
    stop,
    stopAll,
    toggleMute,
  }
}
