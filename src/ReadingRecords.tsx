import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { getReadingCompletions, getReadingLogs } from './lib/api'
import { withAccessToken } from './lib/auth'
import { commonErrorMessage } from './lib/errors'
import { addDays, addMonths, calendarDays, monthOf, monthRange, spokenDate, spokenMonth } from './lib/dates'
import { useKstToday } from './useKstToday'
import CabinIcon from './CabinIcon'
import ReadingStatistics from './ReadingStatistics'
import ReadingDayEditor from './ReadingDayEditor'
import ReadingReminder from './ReadingReminder'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

function errorMessage(error: unknown) {
  return commonErrorMessage(error, '독서 기록을 불러오지 못했습니다')
}

type DayBook = {
  user_book_id: string
  title: string
  authors: string[]
  thumbnail_url: string | null
  read: boolean
  completed: boolean
}

// 달력은 서버의 체크 기록(read_date)과 완독 기록(completed_date)으로만 그리고,
// 같은 날 같은 책은 하나로 합친다. 현재 상태로 완독일·읽은 날을 추정하지 않는다.
export default function ReadingRecords() {
  const today = useKstToday()
  const [month, setMonth] = useState(() => monthOf(today))
  const [view, setView] = useState<'calendar' | 'statistics'>('calendar')
  const [statisticsMode, setStatisticsMode] = useState<'month' | 'year'>('month')
  const [days, setDays] = useState<Map<string, DayBook[]> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editingBusy, setEditingBusy] = useState(false)
  const version = useRef(0)

  const load = useCallback((target: string) => {
    const current = ++version.current
    const { start, end } = monthRange(target)
    return withAccessToken((token) =>
      Promise.all([getReadingLogs(token, start, end), getReadingCompletions(token, start, end)]),
    ).then(
      ([logs, completions]) => {
        if (current !== version.current) return false
        const merged = new Map<string, DayBook[]>()
        const add = (date: string, book: Omit<DayBook, 'read' | 'completed'>, kind: 'read' | 'completed') => {
          const list = merged.get(date) ?? []
          const found = list.find((item) => item.user_book_id === book.user_book_id)
          if (found) found[kind] = true
          else list.push({ ...book, read: kind === 'read', completed: kind === 'completed' })
          merged.set(date, list)
        }
        for (const log of logs) add(log.read_date, log, 'read')
        for (const done of completions) add(done.completed_date, done, 'completed')
        setDays(merged)
        setError(null)
        setSelected((prev) => prev ?? [...merged.keys()].sort().at(-1) ?? (monthOf(today) === target ? today : null))
        return true
      },
      (loadError: unknown) => {
        if (current !== version.current) return false
        setError(errorMessage(loadError))
        return false
      },
    )
  }, [today])

  useEffect(() => {
    if (view !== 'calendar') return
    load(month)
    return () => {
      // 화면을 떠나거나 달이 바뀌면 이전 요청의 늦은 응답을 버린다.
      version.current += 1
    }
  }, [month, view, load])

  function moveMonth(delta: number) {
    const nextMonth = addMonths(month, delta)
    const latestMonth = monthOf(today)
    setMonth(nextMonth > latestMonth ? latestMonth : nextMonth)
    setDays(null)
    setError(null)
    setSelected(null)
    setEditing(false)
  }

  function retry() {
    setError(null)
    load(month)
  }

  const all = [...(days?.values() ?? [])].flat()
  const readDays = [...(days?.values() ?? [])].filter((list) => list.some((book) => book.read)).length
  const bookCount = new Set(all.filter((book) => book.read).map((book) => book.user_book_id)).size
  const completedCount = all.filter((book) => book.completed).length
  const selectedBooks = selected ? days?.get(selected) ?? [] : []

  return (
    <section className="records" aria-labelledby="records-title">
      <h1 id="records-title">독서 기록</h1>
      <p className="library-sub">읽은 날을 돌아보고, 나의 독서를 살펴보세요</p>
      <div className="records-switch" role="group" aria-label="독서 기록 보기">
        <button type="button" disabled={editingBusy} aria-pressed={view === 'calendar'} onClick={() => { if (view !== 'calendar') { setView('calendar'); setDays(null); setError(null) } }}>달력</button>
        <button type="button" disabled={editingBusy} aria-pressed={view === 'statistics'} onClick={() => setView('statistics')}>통계</button>
      </div>

      {view === 'statistics' ? (
        <ReadingStatistics
          month={month} today={today} mode={statisticsMode}
          onModeChange={setStatisticsMode} onMove={moveMonth}
        />
      ) : (
        <>

      <ReadingReminder />

      <div className="records-month">
        <button type="button" className="calendar-nav" aria-label="이전 달" disabled={editingBusy} onClick={() => moveMonth(-1)}>
          ‹
        </button>
        <h2 aria-live="polite">{spokenMonth(month)}</h2>
        <button
          type="button"
          className="calendar-nav"
          aria-label="다음 달"
          onClick={() => moveMonth(1)}
          disabled={editingBusy || month >= monthOf(today)}
        >
          ›
        </button>
      </div>

      {error && (
        <div className="library-note" role="alert">
          <p>{error}</p>
          <button type="button" className="secondary" onClick={retry}>다시 시도</button>
        </div>
      )}

      {!error && days === null && (
        <div className="cabin-loading">
          <CabinIcon className="cabin-icon" />
          <p>기록을 펼치는 중…</p>
        </div>
      )}

      {!error && days !== null && (
        <>
          <p className="records-summary">
            {all.length === 0
              ? '이 달에는 체크하거나 완독한 기록이 없습니다.'
              : [
                  readDays > 0 && `${readDays}일 동안 ${bookCount}권을 읽었어요.`,
                  completedCount > 0 && `완독 ${completedCount}권.`,
                ].filter(Boolean).join(' ')}
          </p>

          <div className="records-calendar">
            {WEEKDAYS.map((day) => (
              <span key={day} className="calendar-weekday" aria-hidden="true">{day}</span>
            ))}
            {calendarDays(month).map((day) => {
              if (monthOf(day) !== month) return <span key={day} aria-hidden="true" />
              const dayBooks = days.get(day) ?? []
              const cover = dayBooks[0]
              const hasCompleted = dayBooks.some((book) => book.completed)
              const label = dayBooks.length
                ? `${spokenDate(day)}, ${dayBooks.length}권: ${dayBooks.map((book) => (book.completed ? `${book.title}(완독)` : book.title)).join(', ')}`
                : spokenDate(day)
              return (
                <button
                  key={day}
                  type="button"
                  className={`records-day${day === today ? ' is-today' : ''}`}
                  aria-label={label}
                  aria-pressed={day === selected}
                  onClick={() => setSelected(day)}
                  disabled={editingBusy || day > today}
                >
                  {/* 그날 첫 책의 표지로 칸을 채우고, 여러 권이면 권수, 완독한 책이 있으면 완독 라벨을 붙인다 */}
                  <span className="records-tile" aria-hidden="true">
                    {cover &&
                      (cover.thumbnail_url ? (
                        <img src={cover.thumbnail_url} alt="" width={120} height={174} loading="lazy" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="records-initial">{cover.title.slice(0, 1)}</span>
                      ))}
                    {dayBooks.length > 1 && <span className="records-count">{dayBooks.length}</span>}
                    {hasCompleted && <span className="records-done">완독</span>}
                  </span>
                  <span className="records-num" aria-hidden="true">{Number(day.slice(8))}</span>
                </button>
              )
            })}
          </div>

          {selected && (
            <div className="records-day-list">
              <h3>{spokenDate(selected)}</h3>
              <p className="result-note">한국 시간 기준으로 오늘을 포함한 최근 7일의 체크를 변경할 수 있어요.</p>
              {selected >= addDays(today, -6) && selected <= today && (
                <button type="button" className="secondary" aria-expanded={editing} disabled={editingBusy} onClick={() => setEditing(!editing)}>
                  {editing ? '편집 닫기' : '체크·취소하기'}
                </button>
              )}
              {editing && <ReadingDayEditor key={selected} date={selected} today={today} onChanged={() => load(month)} onBusyChange={setEditingBusy} />}
              {selectedBooks.length === 0 ? (
                <p className="result-note">이 날은 체크하거나 완독한 책이 없습니다.</p>
              ) : (
                <ul>
                  {selectedBooks.map((book) => (
                    <li key={book.user_book_id}>
                      <Link to={`/books/${book.user_book_id}`} className="records-book">
                        {book.thumbnail_url ? (
                          <img className="result-cover" src={book.thumbnail_url} alt="" width={120} height={174} loading="lazy" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="result-cover cover-empty" aria-hidden="true">{book.title.slice(0, 1)}</div>
                        )}
                        <span>
                          <span className="book-title">{book.title}</span>
                          {book.authors.length > 0 && (
                            <span className="book-authors">{book.authors.join(', ')}</span>
                          )}
                          <span className="book-authors">
                            {[book.read && '읽은 날', book.completed && '완독한 날'].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
        </>
      )}
    </section>
  )
}
