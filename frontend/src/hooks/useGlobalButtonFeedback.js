import { useEffect, useRef } from 'react'

const PRESS_CLASS = 'is-pressing'
const UI_CLICK_SRC = '/audio/ui/click.mp3'

let sharedClickAudio = null

function getSharedClickAudio() {
  if (!sharedClickAudio) {
    sharedClickAudio = new Audio(UI_CLICK_SRC)
    sharedClickAudio.preload = 'auto'
    sharedClickAudio.load()
  }

  return sharedClickAudio
}

export function useGlobalButtonFeedback() {
  const releaseTimersRef = useRef(new WeakMap())

  useEffect(() => {
    const clickAudio = getSharedClickAudio()

    const playClick = () => {
      clickAudio.pause()
      clickAudio.currentTime = 0

      const playPromise = clickAudio.play()

      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {})
      }
    }

    const clearPress = (button) => {
      const timer = releaseTimersRef.current.get(button)

      if (timer) {
        window.clearTimeout(timer)
      }

      button.classList.remove(PRESS_CLASS)
    }

    const pressWithBounce = (button) => {
      clearPress(button)
      button.classList.add(PRESS_CLASS)

      const timer = window.setTimeout(() => {
        button.classList.remove(PRESS_CLASS)
        releaseTimersRef.current.delete(button)
      }, 120)

      releaseTimersRef.current.set(button, timer)
    }

    const handlePointerDown = (event) => {
      const button = event.target.closest('button')

      if (!button || button.disabled) {
        return
      }

      pressWithBounce(button)

      if (button.dataset.noGlobalClick === 'true') {
        return
      }

      playClick()
    }

    const handlePointerUp = (event) => {
      const button = event.target.closest('button')

      if (!button) {
        return
      }

      clearPress(button)
    }

    const handlePointerCancel = (event) => {
      const button = event.target.closest('button')

      if (!button) {
        return
      }

      clearPress(button)
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('pointerup', handlePointerUp, true)
    document.addEventListener('pointercancel', handlePointerCancel, true)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('pointerup', handlePointerUp, true)
      document.removeEventListener('pointercancel', handlePointerCancel, true)
    }
  }, [])
}
