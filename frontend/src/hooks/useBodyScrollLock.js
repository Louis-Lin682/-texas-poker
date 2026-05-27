import { useEffect } from 'react'

let lockCount = 0
let savedBodyOverflow = ''
let savedBodyTouchAction = ''
let savedHtmlOverflow = ''

export function useBodyScrollLock(isLocked) {
  useEffect(() => {
    if (!isLocked) return

    if (lockCount === 0) {
      savedBodyOverflow = document.body.style.overflow
      savedBodyTouchAction = document.body.style.touchAction
      savedHtmlOverflow = document.documentElement.style.overflow
      document.body.style.overflow = 'hidden'
      document.body.style.touchAction = 'none'
      document.documentElement.style.overflow = 'hidden'
    }
    lockCount++

    return () => {
      lockCount--
      if (lockCount === 0) {
        document.body.style.overflow = savedBodyOverflow
        document.body.style.touchAction = savedBodyTouchAction
        document.documentElement.style.overflow = savedHtmlOverflow
      }
    }
  }, [isLocked])
}
