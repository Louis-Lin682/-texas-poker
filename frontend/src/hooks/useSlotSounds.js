import { useCallback, useEffect, useRef } from 'react'
import { Howl, Howler } from 'howler'
import { getAudioSettings } from './useAudio'

const G = '/audio/thunder-joker/'

const DEFS = {
  'spin-click':         { src: [G+'spin-click.mp3'],         volume: 0.8 },
  'reel-spin':          { src: [G+'reel-spin.mp3'],          volume: 0.35, loop: true },
  'reel-stop':          { src: [G+'reel-stop.mp3'],          volume: 0.7 },
  'win-small':          { src: [G+'win-small.mp3'],          volume: 0.9 },
  'shot':               { src: [G+'shot.mp3'],               volume: 0.8, loop: true },
  'payline-draw':       { src: [G+'payline-draw.mp3'],       volume: 0.5 },
  'big-win':            { src: [G+'big-win.mp3'],            volume: 1.0 },
  'mega-win':           { src: [G+'mega-win.mp3'],           volume: 1.0 },
  'epic-win':           { src: [G+'epic-win.mp3'],           volume: 1.0 },
  'super-win':          { src: [G+'super-win.mp3'],          volume: 1.0 },
  'coin-burst':         { src: [G+'coin-burst.mp3'],         volume: 0.8 },
  'anticipate':         { src: [G+'anticipate.mp3'],         volume: 0.5, loop: true },
  'lightning-appear':   { src: [G+'lightning-appear.mp3'],   volume: 0.8 },
  'lightning-fly':      { src: [G+'lightning-fly.mp3'],      volume: 0.8 },
  'free-spins-trigger': { src: [G+'free-spins-trigger.mp3'], volume: 1.0 },
  'joker-flash':        { src: [G+'joker-flash.mp3'],        volume: 0.8 },
  'scene-transition':   { src: [G+'scene-transition.mp3'],   volume: 0.9 },
  'bgm-base':           { src: [G+'bgm-base.mp3'],           volume: 0.25, loop: true },
  'bgm-bonus':          { src: [G+'bgm-bonus.mp3'],          volume: 0.25, loop: true },
}

export function useSlotSounds(isMuted) {
  const howls   = useRef({})
  const loopIds = useRef({})

  // No ready-guard: let React StrictMode double-run recreate Howls correctly
  useEffect(() => {
    const h = {}
    Object.entries(DEFS).forEach(([name, opts]) => {
      h[name] = new Howl(opts)
    })
    howls.current = h
    loopIds.current = {}

    return () => {
      Object.values(h).forEach(howl => howl.unload())
      howls.current = {}
      loopIds.current = {}
    }
  }, [])

  useEffect(() => {
    const { sfxVolume } = getAudioSettings()
    Howler.volume(sfxVolume)
  }, [])

  useEffect(() => { Howler.mute(isMuted) }, [isMuted])

  const play = useCallback((name) => {
    howls.current[name]?.play()
  }, [])

  const stop = useCallback((name) => {
    howls.current[name]?.stop()
  }, [])

  const startLoop = useCallback((name) => {
    if (loopIds.current[name] != null) return
    const h = howls.current[name]
    if (!h) return
    loopIds.current[name] = h.play()
  }, [])

  const stopLoop = useCallback((name) => {
    const id = loopIds.current[name]
    if (id == null) return
    howls.current[name]?.stop(id)
    delete loopIds.current[name]
  }, [])

  const fadeOutLoop = useCallback((name, dur = 600) => {
    const id = loopIds.current[name]
    if (id == null) return
    const h = howls.current[name]
    if (!h) return
    const vol = DEFS[name]?.volume ?? 0.5
    h.fade(vol, 0, dur, id)
    setTimeout(() => {
      h.stop(id)
      delete loopIds.current[name]
    }, dur + 50)
  }, [])

  // Synthesize near-miss: high → low descending tone (no audio file needed)
  const playNearMiss = useCallback(() => {
    if (Howler._muted) return
    try {
      const ctx  = new (window.AudioContext || window.webkitAudioContext)()
      const osc  = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      const now = ctx.currentTime
      osc.type = 'sine'
      osc.frequency.setValueAtTime(900, now)
      osc.frequency.setValueAtTime(900, now + 0.08)
      osc.frequency.exponentialRampToValueAtTime(200, now + 0.5)
      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(0.22, now + 0.05)
      gain.gain.setValueAtTime(0.22, now + 0.35)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6)
      osc.start(now)
      osc.stop(now + 0.62)
      setTimeout(() => ctx.close(), 750)
    } catch (_) {}
  }, [])

  return { play, stop, startLoop, stopLoop, fadeOutLoop, playNearMiss }
}
