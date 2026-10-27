import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ApiError, getReadingLogs } from './lib/api'
import type { ReadingLogEntry } from './lib/api'
import { withAccessToken } from './lib/auth'
import { addMonths, calendarDays, monthOf, monthRange, spokenDate, spokenMonth } from './lib/dates'
import { useKstToday } from './useKstToday'
import CabinIcon from './CabinIcon'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) return '로그인 정보를 확인할 수 없습니다. 다시 로그인해주세요.'
    if (error.status === 503) return '서버가 잠시 응답할 수 없습니다. 잠시 후 다시 시도해주세요.'
    return `독서 기록을 불러오지 못했습니다. (${error.status})`
  }
  if (error instanceof TypeError) {
    return '서버에 연결하지 못했습니다. 네트워크를 확인하고 다시 시도해주세요.'
  }
  return '독서 기록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.'
}

// 달력은 실제 체크 기록(read_date + user_book_id)만으로 그리고, 체크 없는 날을 지어내지 않는다.
export default function ReadingRecords() {
  const today = useKstToday()
  const [month, setMonth] = useState(() => monthOf(today))
  const [logs, setLogs] = useState<ReadingLogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const version = useRef(0)

  function load(target: string) {
    const current = ++version.current
    const { start, end } = monthRange(target)
    withAccessToken((token) => getReadingLogs(token, start, end)).then(
      (fresh) => {
        if (current !== version.current) return
        setLogs(fresh)
        setError(null)
        setSelected((prev) => prev ?? fresh.at(-1)?.read_date ?? null)
      },
      (loadError: unknown) => {
        if (current !== version.current) return
        setError(errorMessage(loadError))
      },
    )
  }

  useEffect(() => {
    load(month)
    return () => {
      // 화면을 떠나거나 달이 바뀌면 이전 요청의 늦은 응답을 버린다.
      version.current += 1
    }
  }, [month])

  function moveMonth(delta: number) {
    setMonth(addMonths(month, delta))
    setLogs(null)
    setError(null)
    setSelected(null)
  }

  function retry() {
    setError(null)
    load(month)
  }

  const byDate = new Map<string, ReadingLogEntry[]>()
  for (const log of logs ?? []) {
    byDate.set(log.read_date, [...(byDate.get(log.read_date) ?? []), log])
  }
  const bookCount = new Set((logs ?? []).map((log) => log.user_book_id)).size
  const selectedLogs = selected ? byDate.get(selected) ?? [] : []

  return (
    <section className="records" aria-labelledby="records-title">
      <h1 id="records-title">독서 기록</h1>
      <p className="library-sub">체크한 날만 달력에 남습니다</p>

      <div className="records-month">
        <button type="button" className="calendar-nav" aria-label="이전 달" onClick={() => moveMonth(-1)}>
          ‹
        </button>
        <h2 aria-live="polite">{spokenMonth(month)}</h2>
        <button
          type="button"
          className="calendar-nav"
          aria-label="다음 달"
          onClick={() => moveMonth(1)}
          disabled={month >= monthOf(today)}
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

      {!error && logs === null && (
        <div className="cabin-loading">
          <CabinIcon className="cabin-icon" />
          <p>기록을 펼치는 중…</p>
        </div>
      )}

      {!error && logs !== null && (
        <>
          <p className="records-summary">
            {logs.length === 0
              ? '이 달에는 체크한 날이 없습니다.'
              : `${byDate.size}일 동안 ${bookCount}권을 읽었어요.`}
          </p>

          <div className="records-calendar">
            {WEEKDAYS.map((day) => (
              <span key={day} className="calendar-weekday" aria-hidden="true">{day}</span>
            ))}
            {calendarDays(month).map((day) => {
              if (monthOf(day) !== month) return <span key={day} aria-hidden="true" />
              const dayLogs = byDate.get(day) ?? []
              const cover = dayLogs[0]
              const label = dayLogs.length
                ? `${spokenDate(day)}, ${dayLogs.length}권 읽음: ${dayLogs.map((log) => log.title).join(', ')}`
                : spokenDate(day)
              return (
                <button
                  key={day}
                  type="button"
                  className={`records-day${day === today ? ' is-today' : ''}`}
                  aria-label={label}
                  aria-pressed={day === selected}
                  onClick={() => setSelected(day)}
                  disabled={day > today}
                >
                  {/* 그날 체크한 첫 책의 표지로 칸을 채우고, 여러 권이면 권수를 붙인다 */}
                  <span className="records-tile" aria-hidden="true">
                    {cover &&
                      (cover.thumbnail_url ? (
                        <img src={cover.thumbnail_url} alt="" loading="lazy" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="records-initial">{cover.title.slice(0, 1)}</span>
                      ))}
                    {dayLogs.length > 1 && <span className="records-count">{dayLogs.length}</span>}
                  </span>
                  <span className="records-num" aria-hidden="true">{Number(day.slice(8))}</span>
                </button>
              )
            })}
          </div>

          {selected && (
            <div className="records-day-list">
              <h3>{spokenDate(selected)}</h3>
              {selectedLogs.length === 0 ? (
                <p className="result-note">이 날은 체크한 책이 없습니다.</p>
              ) : (
                <ul>
                  {selectedLogs.map((log) => (
                    <li key={log.id}>
                      <Link to={`/books/${log.user_book_id}`} className="records-book">
                        {log.thumbnail_url ? (
                          <img className="result-cover" src={log.thumbnail_url} alt="" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="result-cover cover-empty" aria-hidden="true">{log.title.slice(0, 1)}</div>
                        )}
                        <span>
                          <span className="book-title">{log.title}</span>
                          {log.authors.length > 0 && (
                            <span className="book-authors">{log.authors.join(', ')}</span>
                          )}
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
    </section>
  )
}
