export default function LeaveConfirmModal({ onConfirm, onCancel, body }) {
  return (
    <div className="lcm-overlay" onClick={onCancel}>
      <div className="lcm-box" onClick={e => e.stopPropagation()}>
        <img src="/confirmLeaveBg.png" alt="" className="lcm-bg" draggable={false} />
        <div className="lcm-content">
          <p className="lcm-title">確定離開遊戲？</p>
          {body && <p className="lcm-body">{body}</p>}
          <div className="lcm-btns">
            <button type="button" className="lcm-btn" onClick={onCancel}>
              <img src="/continue-game.png" alt="" draggable={false} />
              <span className="lcm-btn-label lcm-btn-cancel">繼續遊戲</span>
            </button>
            <button type="button" className="lcm-btn" onClick={onConfirm}>
              <img src="/confirmLeave.png" alt="" draggable={false} />
              <span className="lcm-btn-label lcm-btn-confirm">確定離開</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
