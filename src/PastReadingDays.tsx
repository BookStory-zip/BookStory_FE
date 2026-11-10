import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, cancelReadingDate, checkReadingDate, getReadingLogs } from './lib/api'
import { withAccessToken } from './lib/auth'
import { addMonths, calendarDays, monthOf, monthRange, spokenDate, spokenMonth } from './lib/dates'
import { commonErrorMessage, isUnclearWrite } from './lib/errors'

type Range = { start: string | null; end: string }
// range: 상세 응답의 past_log_range. 편집 가능 여부는 날짜 계산이 아니라 이 범위만 따른다.
// blocked: 상세의 다른 저장·재조회 중이라 쓰기를 막는다.
type Props = { userBookId: string; range: Range; blocked: boolean; onChanged: () => Promise<boolean>; onBusyChange: (busy: boolean) => void }

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

function failureMessage(failure: unknown) {
  if (failure instanceof ApiError) {
    if (failure.code === 'date_order') return '시작일부터 완독일 사이의 날짜만 남길 수 있어요. 최신 범위를 다시 확인합니다.'
    if (failure.code === 'reading_check_not_allowed') return '이 책은 지금 과거 읽은 날을 남길 수 없어요. 최신 상태를 다시 확인합니다.'
    if (failure.code === 'date_too_old') return '지금 남길 수 있는 범위 밖의 기록은 고치거나 취소할 수 없어요. 최신 범위를 다시 확인합니다.'
    if (failure.status === 404) return '서재에서 이 책을 찾을 수 없습니다.'
  }
  if (isUnclearWrite(failure)) return '저장 결과를 확인하지 못했습니다. 다시 보내지 않고 최신 기록을 확인합니다.'
  return commonErrorMessage(failure, '읽은 날을 저장하지 못했습니다')
}

export default function PastReadingDays({ userBookId, range, blocked, onChanged, onBusyChange }: Props) {
  const [month, setMonth] = useState(monthOf(range.end))
  const [shownRange, setShownRange] = useState(range)
  // 이 책의 그 달 실제 체크 날짜(read_date). null이면 아직 모른다.
  const [checked, setChecked] = useState<Set<string> | null>(null)
  const [stale, setStale] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState('')
  const version = useRef(0)
  const active = useRef(true)
  const locked = useRef(false)
  const noticeRef = useRef<HTMLParagraphElement>(null)

  const load = useCallback(() => {
    const current = ++version.current
    const { start, end } = monthRange(month)
    return withAccessToken((token) => getReadingLogs(token, start, end)).then((logs) => {
      if (current !== version.current || !active.current) return
      setChecked(new Set(logs.filter((log) => log.user_book_id === userBookId).map((log) => log.read_date)))
      setError(null)
      setStale(false)
    }, (failure: unknown) => {
      if (current !== version.current || !active.current) return
      setError(commonErrorMessage(failure, '읽은 날을 불러오지 못했습니다'))
      setStale(true)
    })
  }, [month, userBookId])

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      version.current += 1
      onBusyChange(false)
    }
  }, [onBusyChange])

  useEffect(() => {
    void load()
    return () => { version.current += 1 }
  }, [load])

  // 상태·날짜 수정으로 범위가 바뀌어 보던 달이 범위 밖이 되면 완독일이 있는 달로 옮긴다.
  if (shownRange.start !== range.start || shownRange.end !== range.end) {
    setShownRange(range)
    if ((range.start !== null && month < monthOf(range.start)) || month > monthOf(range.end)) showMonth(monthOf(range.end))
  }

  const inRange = (day: string) => (range.start === null || day >= range.start) && day <= range.end
  const locking = pending || stale || blocked

  // 결과와 관계없이 다시 보내지 않고, 서버 기록과 상세(범위·최근 체크)를 다시 조회한다.
  async function write(request: (token: string) => Promise<unknown>, done: string) {
    if (locked.current || locking) return
    locked.current = true
    setPending(true)
    onBusyChange(true)
    setNotice('')
    let refresh = true
    try {
      try {
        await withAccessToken(request)
        if (active.current) {
          setNotice(done)
        }
      } catch (failure) {
        refresh = isUnclearWrite(failure) || !(failure instanceof ApiError) ||
          [404, 409].includes(failure.status) || failure.code === 'date_too_old'
        if (active.current) setNotice(failureMessage(failure))
      }
      if (refresh && active.current) {
        setStale(true)
        await Promise.all([load(), onChanged()])
      }
    } finally {
      locked.current = false
      if (active.current) {
        setPending(false)
        onBusyChange(false)
        // 누른 날짜 버튼에 포커스를 두고, 잠금 중 포커스를 잃었을 때만 결과 안내로 옮긴다.
        if (document.activeElement === document.body) noticeRef.current?.focus()
      }
    }
  }

  function toggle(day: string) {
    if (!checked) return
    const spoken = spokenDate(day)
    if (checked.has(day)) void write((token) => cancelReadingDate(token, userBookId, day), `${spoken} 체크를 취소했습니다.`)
    else void write((token) => checkReadingDate(token, userBookId, day), `${spoken}을 읽은 날로 남겼습니다.`)
  }

  function showMonth(target: string) {
    setChecked(null)
    setError(null)
    setStale(true)
    setMonth(target)
  }

  return (
    <section className="detail-card past-days" aria-labelledby="past-days-title" aria-busy={pending}>
      <h2 id="past-days-title">과거 읽은 날</h2>
      <p role="status" ref={noticeRef} tabIndex={-1}>{pending ? '저장 결과를 확인하는 중…' : notice}</p>

      <div className="calendar-head">
        <button type="button" className="calendar-nav" aria-label="이전 달" disabled={pending || (range.start !== null && month <= monthOf(range.start))} onClick={() => showMonth(addMonths(month, -1))}>‹</button>
        <p>{spokenMonth(month)}</p>
        <button type="button" className="calendar-nav" aria-label="다음 달" disabled={pending || month >= monthOf(range.end)} onClick={() => showMonth(addMonths(month, 1))}>›</button>
      </div>
      {error && <div className="library-note" role="alert">
        <p>{error}</p>
        <button type="button" className="secondary" disabled={pending} onClick={() => void load()}>최신 기록 다시 확인</button>
      </div>}
      {!checked && !error && <p className="result-note">읽은 날을 확인하는 중…</p>}
      {checked && (
        <div className="calendar-grid" role="group" aria-label={`${spokenMonth(month)} 읽은 날`}>
          {WEEKDAYS.map((day) => <span key={day} className="calendar-weekday" aria-hidden="true">{day}</span>)}
          {calendarDays(month).map((day) => {
            if (monthOf(day) !== month) return <span key={day} aria-hidden="true" />
            const editable = inRange(day)
            const read = checked.has(day)
            return (
              <button
                key={day}
                type="button"
                className="calendar-day"
                aria-label={`${spokenDate(day)}${read ? ', 읽은 날' : ''}${editable ? '' : ', 고칠 수 없음'}`}
                aria-pressed={read}
                disabled={!editable || locking}
                onClick={() => toggle(day)}
              >
                {Number(day.slice(8))}
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
