import { useEffect, useId, useRef, useState } from 'react'
import type { ButtonHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onClick' | 'onKeyDown'> & {
  label: string
  previous: boolean
  next: boolean
  onMove: (direction: -1 | 1) => void
}

export default function OrderHandle({ label, previous, next, disabled, onMove, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, ...props }: Props) {
  const [open, setOpen] = useState(false)
  const [menuRoot, setMenuRoot] = useState<HTMLElement | null>(null)
  const id = useId()
  const container = useRef<HTMLDivElement>(null)
  const handle = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const pointerMoved = useRef(false)
  const ignoreClick = useRef(false)
  const restoreFocus = useRef(false)

  useEffect(() => {
    if (!open) return
    const menu = panel.current!
    const rect = handle.current!.getBoundingClientRect()
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`
    menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8))}px`
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
    const close = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node) && !menu.contains(event.target as Node)) setOpen(false)
    }
    const closeOnScroll = () => setOpen(false)
    document.addEventListener('pointerdown', close)
    window.addEventListener('resize', closeOnScroll)
    window.addEventListener('scroll', closeOnScroll, true)
    return () => {
      document.removeEventListener('pointerdown', close)
      window.removeEventListener('resize', closeOnScroll)
      window.removeEventListener('scroll', closeOnScroll, true)
    }
  }, [open])

  useEffect(() => {
    if (!disabled && restoreFocus.current) {
      restoreFocus.current = false
      handle.current?.focus()
    }
  }, [disabled])

  function move(direction: -1 | 1) {
    if (disabled || (direction === -1 ? !previous : !next)) return
    setOpen(false)
    restoreFocus.current = true
    onMove(direction)
  }

  function toggleMenu(button: HTMLButtonElement) {
    setMenuRoot(button.closest('dialog') ?? document.body)
    setOpen(!open)
  }

  return <div ref={container} className="order-control"
    onPointerDownCapture={(event) => { if (event.isPrimary) ignoreClick.current = false }}
    onClickCapture={(event) => {
      // 새 메뉴 위로 재지정된 터치 호환 click이 이동 명령을 누르지 않게 한다.
      if (event.detail > 0 && ignoreClick.current) {
        ignoreClick.current = false
        event.preventDefault()
        event.stopPropagation()
      }
    }}
    // Safari는 탭한 메뉴 버튼 대신 바깥 조상(tabIndex -1)에 포커스를 준다. Tab으로 나갈 때만 blur로 닫는다.
    onBlur={(event) => {
      const next = event.relatedTarget
      if (next instanceof HTMLElement && next.tabIndex >= 0 && !event.currentTarget.contains(next) && !panel.current?.contains(next)) setOpen(false)
    }}
    onKeyDown={(event) => {
      if (open && event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
        handle.current?.focus()
      }
    }}>
    <button {...props} ref={handle} type="button" className="secondary order-handle" disabled={disabled}
      aria-label={`${label} 이동 손잡이`} aria-expanded={open} aria-controls={id}
      onKeyDown={(event) => {
        if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)) {
          event.preventDefault()
          move(event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1)
        }
      }}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return
        origin.current = { x: event.clientX, y: event.clientY }
        pointerMoved.current = false
        onPointerDown?.(event)
      }}
      onPointerMove={(event) => {
        if (event.isPrimary && origin.current && Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 6) pointerMoved.current = true
        onPointerMove?.(event)
      }}
      onPointerUp={(event) => {
        const tapped = event.isPrimary && event.pointerType === 'touch' && origin.current !== null && !pointerMoved.current
          && Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) <= 6
        origin.current = null
        if (tapped) ignoreClick.current = true
        onPointerUp?.(event)
        // 터치 드래그 뒤 브라우저가 click을 생략해도 다음 탭으로 메뉴를 열 수 있다.
        if (tapped) toggleMenu(event.currentTarget)
      }}
      onPointerCancel={(event) => { origin.current = null; onPointerCancel?.(event) }}
      onClick={(event) => {
        if (event.detail > 0 && pointerMoved.current) { pointerMoved.current = false; return }
        pointerMoved.current = false
        toggleMenu(event.currentTarget)
      }}><span aria-hidden="true">⠿</span></button>
    {open && menuRoot && createPortal(<div ref={panel} id={id} className="order-menu" role="group" aria-label={`${label} 이동`}>
      <button type="button" className="secondary compact" aria-label={`${label} 앞으로`} disabled={disabled || !previous} onClick={() => move(-1)}>앞으로 한 칸</button>
      <button type="button" className="secondary compact" aria-label={`${label} 뒤로`} disabled={disabled || !next} onClick={() => move(1)}>뒤로 한 칸</button>
    </div>, menuRoot)}
  </div>
}
