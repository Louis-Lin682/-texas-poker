function MusicOnIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 18V7.2l8-1.7v10.1" />
      <circle cx="8" cy="18" r="2.2" />
      <circle cx="18" cy="16" r="2.2" />
    </svg>
  )
}

function MusicOffIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 18V7.2l8-1.7v7.1" />
      <circle cx="8" cy="18" r="2.2" />
      <circle cx="18" cy="14.6" r="2.2" />
      <path d="M4.8 5.2l14.4 14.4" />
    </svg>
  )
}

function NoticeTicker({ text, isMuted, onToggleMute }) {
  return (
    <div className="notice-wrap">
      <div className="top-notice">
        <img className="notice-skull" src="/notice-skull.png" alt="Announcement mascot" />

        <div className="notice-marquee">
          <div className="notice-track">
            <span>{text}</span>
            <span aria-hidden="true">{text}</span>
          </div>
        </div>
      </div>

      <button
        type="button"
        className="notice-settings"
        aria-label={isMuted ? 'unmute background music' : 'mute background music'}
        aria-pressed={!isMuted}
        onClick={onToggleMute}
      >
        {isMuted ? <MusicOffIcon /> : <MusicOnIcon />}
      </button>
    </div>
  )
}

export default NoticeTicker
