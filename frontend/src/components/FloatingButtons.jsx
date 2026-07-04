import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

const HIDE_ROUTES = ['/table', '/big-two', '/thunder-joker', '/auth']

export default function FloatingButtons({ hidden = false }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [serviceOpen, setServiceOpen] = useState(false)
  const serviceRef = useRef(null)
  const autoCloseRef = useRef(null)

  const close = () => {
    setServiceOpen(false)
    clearTimeout(autoCloseRef.current)
  }

  const resetTimer = () => {
    clearTimeout(autoCloseRef.current)
    autoCloseRef.current = setTimeout(close, 3000)
  }

  useEffect(() => {
    if (!serviceOpen) return
    resetTimer()
    const handler = (e) => {
      if (!serviceRef.current?.contains(e.target)) close()
    }
    document.addEventListener('pointerdown', handler)
    return () => {
      document.removeEventListener('pointerdown', handler)
      clearTimeout(autoCloseRef.current)
    }
  }, [serviceOpen])

  if (pathname !== '/' || hidden) return null

  const handleServiceClick = () => {
    if (!serviceOpen) { setServiceOpen(true); return }
    navigate('/support')
  }

  return (
    <>
      <button
        ref={serviceRef}
        type="button"
        className={`float-btn float-service ${serviceOpen ? 'is-open' : ''}`}
        onClick={handleServiceClick}
        aria-label="客服"
      >
        <img src="/service.webp" alt="" />
      </button>
    </>
  )
}
