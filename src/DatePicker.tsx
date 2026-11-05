import { useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { addDays, addMonths, calendarDays, monthOf, spokenDate as spoken } from './lib/dates'

type Props = {
  label: string
  value: string
  max: string
  // 고를 수 있는 가장 이른 날짜. 없으면 하한 없음.
  min?: string
  // 오늘 표시할 날짜. 없으면 max를 오늘로 본다.
  today?: string
  onChange: (date: string) => void
  disabled?: boolean
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

export default function DatePicker({ label, value, max, min = '', today = max, onChange, disabled = false }: Props) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(monthOf(value || max))
  const triggerRef = useRef<HTMLButtonElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  const days = calendarDays(month)
  const focusTarget = value && monthOf(value) === month ? value : days.find((day) => monthOf(day) === month && day >= min && day <= max) ?? `${month}-01`

  function toggle() {
    if (!open) setMonth(monthOf(value || max))
    setOpen(!open)
  }

  function pick(date: string) {
    onChange(date)
    setOpen(false)
    triggerRef.current?.focus()
  }

  function close() {
    setOpen(false)
    triggerRef.current?.focus()
  }

  // 화살표·Home/End로 날짜를 옮기고, 달이 바뀌면 그 달을 보여 준다.
  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    const current = (event.target as HTMLElement).dataset.date
    if (!current) return
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    }
    const step = moves[event.key]
    if (step === undefined) return
    event.preventDefault()
    const next = addDays(current, step)
    if (next > max || next < min) return
    setMonth(monthOf(next))
    requestAnimationFrame(() => {
      gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${next}"]`)?.focus()
    })
  }

  const [year, monthNumber] = month.split('-').map(Number)

  return (
    <div className="date-field">
      <span id={`${id}-label`} className="date-label">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        className="date-trigger"
        aria-labelledby={`${id}-label ${id}-value`}
        aria-expanded={open}
        aria-controls={`${id}-calendar`}
        onClick={toggle}
        disabled={disabled}
      >
        <span id={`${id}-value`}>{value ? spoken(value) : '날짜 선택'}</span>
      </button>

      {open && (
        <div
          id={`${id}-calendar`}
          className="calendar"
          role="group"
          aria-label={`${label} 달력`}
          onKeyDown={handleKey}
        >
          <div className="calendar-head">
            <button type="button" className="calendar-nav" aria-label="이전 달" onClick={() => setMonth(addMonths(month, -1))} disabled={month <= monthOf(min)}>
              ‹
            </button>
            <p aria-live="polite">{year}년 {monthNumber}월</p>
            <button
              type="button"
              className="calendar-nav"
              aria-label="다음 달"
              onClick={() => setMonth(addMonths(month, 1))}
              disabled={addMonths(month, 1) > monthOf(max)}
            >
              ›
            </button>
          </div>
          <div className="calendar-grid" ref={gridRef}>
            {WEEKDAYS.map((day) => (
              <span key={day} className="calendar-weekday" aria-hidden="true">{day}</span>
            ))}
            {days.map((day) => {
              const outside = monthOf(day) !== month
              return (
                <button
                  key={day}
                  type="button"
                  data-date={day}
                  className={`calendar-day${outside ? ' is-outside' : ''}${day === today ? ' is-today' : ''}`}
                  aria-label={spoken(day)}
                  aria-pressed={day === value}
                  tabIndex={day === focusTarget ? 0 : -1}
                  disabled={day > max || day < min}
                  onClick={() => pick(day)}
                >
                  {Number(day.slice(8))}
                </button>
              )
            })}
          </div>
          <div className="calendar-foot">
            <button type="button" className="secondary compact" onClick={() => pick('')} disabled={!value}>
              지우기
            </button>
            <button type="button" className="secondary compact" onClick={close}>
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
