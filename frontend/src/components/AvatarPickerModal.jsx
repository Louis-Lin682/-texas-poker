import { useEffect, useState } from 'react'

function AvatarPickerModal({ isOpen, currentAvatar, onSelect, onClose }) {
  const [avatars,  setAvatars]  = useState([])
  const [visible,  setVisible]  = useState(false)
  const [closing,  setClosing]  = useState(false)

  useEffect(() => {
    if (isOpen) { setVisible(true); setClosing(false) }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen && visible) {
      setClosing(true)
      const t = setTimeout(() => { setVisible(false); setClosing(false) }, 180)
      return () => clearTimeout(t)
    }
  }, [isOpen, visible])

  useEffect(() => {
    if (!isOpen) return
    fetch('/api/avatars')
      .then(r => r.json())
      .then(data => setAvatars(data.avatars ?? []))
      .catch(() => {})
  }, [isOpen])

  if (!visible) return null

  const active = currentAvatar ?? '/notice-angel.png'

  return (
    <div className="avatar-picker-overlay" onClick={onClose}>
      <div className={`avatar-picker-modal${closing ? ' is-closing' : ''}`} onClick={e => e.stopPropagation()}>
        <h3 className="avatar-picker-title">選擇頭像</h3>
        <div className="avatar-picker-grid">
          {avatars.map(src => (
            <button
              key={src}
              type="button"
              className={`avatar-picker-item${src === active ? ' is-selected' : ''}`}
              onClick={() => onSelect(src)}
            >
              <img src={src} alt="" />
              {src === active && <span className="avatar-check">✓</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default AvatarPickerModal
