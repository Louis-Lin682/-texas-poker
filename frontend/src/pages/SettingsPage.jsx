import { useState, useRef, useEffect } from 'react'
import PageShell from '../components/PageShell'
import VipPageHeader from '../components/VipPageHeader'
import { apiRequest } from '../services/apiClient'
import {
  getAudioSettings,
  setGlobalBgmMuted,
  setGlobalBgmVolume,
} from '../hooks/useAudio'

const SETTINGS_EVENT = 'audio:settings'

const TOKEN_KEY = 'texas_holdem_auth_token'

function SettingsSection({ title, children }) {
  return (
    <div className="settings-section">
      <div className="section-bar">
        <div className="section-title-wrap">
          <span className="section-title-mark" aria-hidden="true" />
          <h2>{title}</h2>
        </div>
      </div>
      <div className="settings-section-body">{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      className={`settings-toggle ${checked ? 'is-on' : ''}`}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
    >
      <span className="settings-toggle-knob" />
    </button>
  )
}

function SettingsRow({ label, children }) {
  return (
    <div className="settings-row">
      <span className="settings-row-label">{label}</span>
      <div>{children}</div>
    </div>
  )
}

function AudioBlock({ label, enabled, onToggle, volume, onVolume }) {
  const sliderRef  = useRef(null)
  const isDownRef  = useRef(false)
  const rectRef    = useRef(null)
  const rafRef     = useRef(null)
  const propsRef   = useRef({ onVolume, onToggle, enabled })
  propsRef.current = { onVolume, onToggle, enabled }

  useEffect(() => {
    const el = sliderRef.current
    if (el) el.style.setProperty('--pct', `${Math.round(volume * 100)}%`)
  }, [volume])

  useEffect(() => {
    const el = sliderRef.current
    if (!el) return

    function commit(v) {
      const { onVolume, onToggle, enabled } = propsRef.current
      onVolume(v)
      if (v === 0 && enabled)  onToggle(false)
      if (v > 0  && !enabled) onToggle(true)
    }

    function applyAt(clientX) {
      const rect = rectRef.current
      if (!rect) return
      const v = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      el.style.setProperty('--pct', `${Math.round(v * 100)}%`)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => { commit(v); rafRef.current = null })
    }

    function onDown(e) {
      e.preventDefault()
      isDownRef.current = true
      rectRef.current = el.getBoundingClientRect()
      el.setPointerCapture(e.pointerId)
      applyAt(e.clientX)
    }
    function onMove(e) { if (isDownRef.current) applyAt(e.clientX) }
    function onUp(e)   { if (isDownRef.current) { isDownRef.current = false; applyAt(e.clientX) } }
    function onCancel(){ isDownRef.current = false }

    el.addEventListener('pointerdown',   onDown)
    el.addEventListener('pointermove',   onMove)
    el.addEventListener('pointerup',     onUp)
    el.addEventListener('pointercancel', onCancel)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      el.removeEventListener('pointerdown',   onDown)
      el.removeEventListener('pointermove',   onMove)
      el.removeEventListener('pointerup',     onUp)
      el.removeEventListener('pointercancel', onCancel)
    }
  }, [])

  return (
    <div className="settings-audio-block">
      <div className="settings-row">
        <span className="settings-row-label">{label}</span>
        <Toggle checked={enabled} onChange={onToggle} />
      </div>
      <div className="settings-slider-row">
        <span className="settings-slider-icon">🔈</span>
        {/* div instead of input[type=range] — iOS hijacks native range touch events */}
        <div
          ref={sliderRef}
          className="settings-slider"
          role="slider"
          aria-valuenow={Math.round(volume * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          style={{ '--pct': `${Math.round(volume * 100)}%` }}
        />
        <span className="settings-slider-icon">🔊</span>
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const token  = localStorage.getItem(TOKEN_KEY)
  const isAuth = Boolean(token)

  const init = getAudioSettings()
  const [bgmOn,  setBgmOn]  = useState(!init.bgmMuted)
  const [bgmVol, setBgmVol] = useState(init.bgmVolume)

  useEffect(() => {
    function sync() {
      const s = getAudioSettings()
      setBgmOn(!s.bgmMuted)
      setBgmVol(s.bgmVolume)
    }
    window.addEventListener(SETTINGS_EVENT, sync)
    return () => window.removeEventListener(SETTINGS_EVENT, sync)
  }, [])

  const [pushOn,   setPushOn]   = useState(true)
  const [pwdOpen,  setPwdOpen]  = useState(false)
  const [curPwd,   setCurPwd]   = useState('')
  const [newPwd,   setNewPwd]   = useState('')
  const [confPwd,  setConfPwd]  = useState('')
  const [pwdState, setPwdState] = useState(null)

  function handleBgmToggle(on) {
    setBgmOn(on)
    setGlobalBgmMuted(!on)
  }

  function handleBgmVol(v) {
    setBgmVol(v)
    setGlobalBgmVolume(v)
  }

  async function handleChangePwd(e) {
    e.preventDefault()
    if (newPwd !== confPwd) { setPwdState('兩次新密碼不一致。'); return }
    if (newPwd.length < 6)  { setPwdState('新密碼至少需要 6 個字元。'); return }
    setPwdState('loading')
    try {
      await apiRequest('/auth/change-password', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ current_password: curPwd, new_password: newPwd }),
      })
      setPwdState('ok')
      setCurPwd(''); setNewPwd(''); setConfPwd('')
      setTimeout(() => setPwdOpen(false), 1200)
    } catch (err) {
      setPwdState(err.message ?? '發生錯誤，請稍後再試。')
    }
  }

  return (
    <PageShell title="" accent="#c084ff">
      <VipPageHeader title="設定" eyebrow="SETTINGS" />

      <SettingsSection title="音效設定">
        <AudioBlock
          label="背景音樂"
          enabled={bgmOn}
          onToggle={handleBgmToggle}
          volume={bgmVol}
          onVolume={handleBgmVol}
        />
      </SettingsSection>

      {isAuth && (
        <SettingsSection title="帳號安全">
          {/* 帳號綁定 */}
          <div className="settings-bind-row">
            <span className="settings-row-label">帳號綁定</span>
            <div className="settings-bind-icons">
              <button type="button" className="settings-bind-btn" disabled title="Apple（即將開放）">
                <img src="/social/apple.png" alt="Apple" className="settings-bind-icon" />
              </button>
              <button type="button" className="settings-bind-btn" disabled title="Facebook（即將開放）">
                <img src="/social/facebook.png" alt="Facebook" className="settings-bind-icon" />
              </button>
              <button type="button" className="settings-bind-btn" disabled title="LINE（即將開放）">
                <img src="/social/line.png" alt="LINE" className="settings-bind-icon" />
              </button>
            </div>
          </div>

          <div className="settings-divider" />

          {/* 推播通知 */}
          <SettingsRow label="接收遊戲推播通知">
            <Toggle checked={pushOn} onChange={setPushOn} />
          </SettingsRow>

          <div className="settings-divider" />

          {/* 修改密碼（展開式） */}
          <button
            type="button"
            className="settings-expand-row"
            onClick={() => { setPwdOpen(o => !o); setPwdState(null) }}
          >
            <span>修改密碼</span>
            <span className={`settings-expand-chevron ${pwdOpen ? 'is-open' : ''}`}>›</span>
          </button>

          <div className={`settings-expand-body ${pwdOpen ? 'is-open' : ''}`}>
            <form className="settings-pwd-form" onSubmit={handleChangePwd}>
              <input
                className="settings-input"
                type="password"
                placeholder="目前密碼"
                value={curPwd}
                onChange={e => { setCurPwd(e.target.value); setPwdState(null) }}
                autoComplete="current-password"
              />
              <input
                className="settings-input"
                type="password"
                placeholder="新密碼（至少 6 字元）"
                value={newPwd}
                onChange={e => { setNewPwd(e.target.value); setPwdState(null) }}
                autoComplete="new-password"
              />
              <input
                className="settings-input"
                type="password"
                placeholder="確認新密碼"
                value={confPwd}
                onChange={e => { setConfPwd(e.target.value); setPwdState(null) }}
                autoComplete="new-password"
              />
              {pwdState && pwdState !== 'loading' && pwdState !== 'ok' && (
                <p className="settings-msg is-error">{pwdState}</p>
              )}
              {pwdState === 'ok' && (
                <p className="settings-msg is-ok">密碼已更新！</p>
              )}
              <button
                type="submit"
                className="settings-submit-btn"
                disabled={!curPwd || !newPwd || !confPwd || pwdState === 'loading'}
              >
                {pwdState === 'loading' ? '更新中…' : '確認修改'}
              </button>
            </form>
          </div>
        </SettingsSection>
      )}

      {!isAuth && (
        <p className="quest-empty">請先登入以修改帳號設定</p>
      )}
    </PageShell>
  )
}
