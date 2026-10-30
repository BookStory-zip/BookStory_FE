import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { getReadingLogs } from './lib/api'
import type { ReadingLogEntry } from './lib/api'
import { withAccessToken } from './lib/auth'
import { commonErrorMessage } from './lib/errors'
import { addMonths, calendarDays, monthOf, monthRange, spokenDate, spokenMonth } from './lib/dates'
import { useKstToday } from './useKstToday'
import CabinIcon from './CabinIcon'
import ReadingStatistics from './ReadingStatistics'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

function errorMessage(error: unknown) {
  return commonErrorMessage(error, '독서 기록을 불러오지 못했습니다')
}

// 달력은 실제 체크 기록(read_date + user_book_id)만으로 그리고, 체크 없는 날을 지어내지 않는다.
export default function ReadingRecords() {
  const today = useKstToday()
  const [month, setMonth] = useState(() => monthOf(today))
  const [view, setView] = useState<'calendar' | 'statistics'>('calendar')
  const [statisticsMode, setStatisticsMode] = useState<'month' | 'year'>('month')
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
    if (view !== 'calendar') return
    load(month)
    return () => {
      // 화면을 떠나거나 달이 바뀌면 이전 요청의 늦은 응답을 버린다.
      version.current += 1
    }
  }, [month, view])

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
      <p className="library-sub">읽은 날을 돌아보고, 나의 독서를 살펴보세요</p>
      <div className="records-switch" role="group" aria-label="독서 기록 보기">
        <button type="button" aria-pressed={view === 'calendar'} onClick={() => { if (view !== 'calendar') { setView('calendar'); setLogs(null); setError(null) } }}>달력</button>
        <button type="button" aria-pressed={view === 'statistics'} onClick={() => setView('statistics')}>통계</button>
      </div>

      {view === 'statistics' ? (
        <ReadingStatistics
          month={month} today={today} mode={statisticsMode}
          onModeChange={setStatisticsMode} onMove={moveMonth}
        />
      ) : (
        <>

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
                        <img src={cover.thumbnail_url} alt="" width={120} height={174} loading="lazy" referrerPolicy="no-referrer" />
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
                          <img className="result-cover" src={log.thumbnail_url} alt="" width={120} height={174} loading="lazy" referrerPolicy="no-referrer" />
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
        </>
      )}
    </section>
  )
}
