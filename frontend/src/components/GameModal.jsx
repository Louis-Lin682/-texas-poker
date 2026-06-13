import HeartIcon from './HeartIcon'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { MaintenanceSpriteImage } from './MaintenanceSpriteOverlay'

function GameModal({ game, onClose, isFavorite, onToggleFavorite, onPlay }) {
  useBodyScrollLock(Boolean(game))

  if (!game) return null

  const isPlayable = game.status === 'playable'
  const isMaintenance = game.status === 'maintenance'

  return (
    <div
      className="game-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="game-modal"
        role="dialog"
        aria-modal="true"
        aria-label={game.name}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="game-modal-dismiss"
          aria-label="關閉"
          onClick={onClose}
        >
          <img src="/closeBtn.png" alt="關閉" />
        </button>

        <div className="game-modal-canvas">
          <img
            className="game-modal-image"
            src={game.imageUrl}
            alt={game.name}
            onLoad={e => e.currentTarget.classList.add('img-loaded')}
          />
          <div className="game-modal-image-overlay" />

          {isMaintenance && (
            <div className="game-modal-maint-layer">
              <MaintenanceSpriteImage />
            </div>
          )}

          {!isPlayable && !isMaintenance && (
            <div className="game-modal-soon-layer">
              <div className="preview-glow" />
              <div className="preview-badge">
                <span className="preview-badge-sub">COMING SOON</span>
                <span className="preview-badge-main">即將登場</span>
                <div className="preview-badge-rule" />
              </div>
            </div>
          )}

          <div className="game-modal-body">
            <div className="game-modal-topline">
              <span className={`game-modal-category game-modal-category-${game.category}`}>
                {game.category === 'poker' ? '撲克' : '電子'}
              </span>

              <button
                type="button"
                className={`game-modal-fav ${isFavorite ? 'is-active' : ''}`}
                aria-label={isFavorite ? `取消收藏 ${game.name}` : `收藏 ${game.name}`}
                onClick={() => onToggleFavorite?.(game.id)}
              >
                <HeartIcon filled={isFavorite} />
              </button>
            </div>

            <h2 className="game-modal-title">{game.name}</h2>

            <p className="game-modal-desc">
              {isPlayable
                ? (game.desc ?? '立即進入遊戲，享受精彩體驗。')
                : isMaintenance
                  ? '此遊戲目前正在進行系統維護，維護期間暫停開放，敬請耐心等候。'
                  : '這款遊戲即將上線，精彩內容正在準備中，敬請期待。'}
            </p>

            {isPlayable ? (
              <button type="button" className="game-modal-play-button" onClick={onPlay}>
                <img src="/entry-game.png" alt="立即進入" />
              </button>
            ) : (
              <button type="button" className="game-modal-close-button" onClick={onClose}>
                <img src="/close.png" alt="關閉" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default GameModal
