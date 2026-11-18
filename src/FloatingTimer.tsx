import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { getTimerSeconds, readTimer, subscribeTimer } from './lib/timer'

const TimerPage = lazy(() => import('./TimerPage'))

export default function FloatingTimer({ userId }: { userId: string }) {
  const { pathname } = useLocation()
  const legacyPath = /^\/timer\/?$/.test(pathname)
  const [open, setOpen] = useState(legacyPath)
  const [visited, setVisited] = useState(legacyPath)
  const [previousPath, setPreviousPath] = useState(pathname)
  const [label, setLabel] = useState('타이머')
  const trigger = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const container = useRef<HTMLElement>(null)

  useEffect(() => {
    const update = () => {
      try {
        const timer = readTimer(userId)
        const seconds = timer ? getTimerSeconds(timer, Date.now()) : null
        setLabel(seconds === null ? '타이머' : `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`)
      } catch { setLabel('타이머 확인') }
    }
    update()
    const unsubscribe = subscribeTimer(update)
    const interval = setInterval(update, 1000)
    return () => { unsubscribe(); clearInterval(interval) }
  }, [userId])

  useEffect(() => { if (open) closeButton.current?.focus() }, [open])

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target) &&
        !document.querySelector('#floating-timer-panel dialog[open]')) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  if (previousPath !== pathname) {
    setPreviousPath(pathname)
    // 뒤로가기 중에도 네이티브 확인창의 부모를 숨기지 않는다.
    if (!document.querySelector('#floating-timer-panel dialog[open]')) setOpen(legacyPath)
    if (legacyPath) setVisited(true)
  }

  function close() { setOpen(false); trigger.current?.focus() }

  return <aside ref={container} className="floating-timer" aria-label="공통 독서 타이머">
    <button ref={trigger} type="button" className="floating-timer-trigger" aria-label={`타이머 열기${label === '타이머' ? '' : ` · ${label}`}`}
      aria-expanded={open} aria-controls="floating-timer-panel" onClick={() => { setVisited(true); setOpen(!open) }}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M9 2h6M12 2v3m6 0 2 2M12 9v5l3 2" /><circle cx="12" cy="14" r="8" /></svg>
      {/^[0-9]+:[0-9]{2}$/.test(label) && <span className="timer-active-dot" aria-hidden="true" />}
    </button>
    {visited && <div id="floating-timer-panel" role="dialog" aria-label="독서 타이머 조작" className={`floating-timer-panel${open ? ' is-open' : ''}`} aria-hidden={!open} inert={!open}
      onKeyDown={(event) => { if (event.key === 'Escape' && !document.querySelector('dialog[open]')) { event.stopPropagation(); close() } }}>
      <button ref={closeButton} type="button" className="link-button floating-timer-close" aria-label="타이머 접기" onClick={close}>접기</button>
      <Suspense fallback={<p role="status">타이머를 여는 중…</p>}><TimerPage userId={userId} embedded={!legacyPath} /></Suspense>
    </div>}
  </aside>
}
