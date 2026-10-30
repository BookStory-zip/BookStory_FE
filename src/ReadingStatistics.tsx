import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { getReadingStatistics, readingStatuses, statusLabels } from './lib/api'
import type { ReadingStatistics as StatisticsData } from './lib/api'
import { withAccessToken } from './lib/auth'
import { monthOf, spokenMonth } from './lib/dates'
import { commonErrorMessage } from './lib/errors'
import CabinIcon from './CabinIcon'

type Props = {
  month: string
  today: string
  mode: 'month' | 'year'
  onModeChange: (mode: 'month' | 'year') => void
  onMove: (months: number) => void
}

export default function ReadingStatistics({ month, today, mode, onModeChange, onMove }: Props) {
  const year = Number(month.slice(0, 4))
  const selectedMonth = mode === 'month' ? Number(month.slice(5)) : undefined
  const key = `${year}-${selectedMonth ?? 'year'}`
  const [result, setResult] = useState<{
    key: string; data: StatisticsData | null; error: string | null
  } | null>(null)
  const version = useRef(0)

  const load = useCallback(() => {
    const current = ++version.current
    withAccessToken((token) => getReadingStatistics(token, year, selectedMonth)).then(
      (data) => {
        if (version.current === current) setResult({ key, data, error: null })
      },
      (error: unknown) => {
        if (version.current !== current) return
        setResult({ key, data: null, error: commonErrorMessage(error, '독서 통계를 불러오지 못했습니다') })
      },
    )
  }, [key, year, selectedMonth])

  useEffect(() => {
    load()
    return () => { version.current += 1 }
  }, [load])

  const current = result?.key === key ? result : null
  const data = current?.data
  const error = current?.error
  const atLatest = mode === 'month' ? month >= monthOf(today) : year >= Number(today.slice(0, 4))

  return (
    <div className="reading-statistics">
      <div className="records-switch statistics-period" role="group" aria-label="통계 기간">
        <button type="button" aria-pressed={mode === 'month'} onClick={() => onModeChange('month')}>월간</button>
        <button type="button" aria-pressed={mode === 'year'} onClick={() => onModeChange('year')}>연간</button>
      </div>
      <div className="records-month">
        <button
          type="button" className="calendar-nav" aria-label={mode === 'month' ? '이전 달' : '이전 해'}
          disabled={mode === 'month' ? month <= '0001-01' : year <= 1}
          onClick={() => onMove(mode === 'month' ? -1 : -12)}
        >‹</button>
        <h2 aria-live="polite">{mode === 'month' ? spokenMonth(month) : `${year}년`}</h2>
        <button
          type="button" className="calendar-nav" aria-label={mode === 'month' ? '다음 달' : '다음 해'}
          disabled={atLatest} onClick={() => onMove(mode === 'month' ? 1 : 12)}
        >›</button>
      </div>

      {error ? (
        <div className="library-note" role="alert">
          <p>{error}</p>
          <button type="button" className="secondary" onClick={() => { setResult(null); load() }}>다시 시도</button>
        </div>
      ) : !data ? (
        <div className="cabin-loading" role="status">
          <CabinIcon className="cabin-icon" />
          <p>독서 통계를 펼치는 중…</p>
        </div>
      ) : (
        <>
          <div className="statistics-activity">
            <h3>읽은 날</h3>
            <p className="statistics-days"><strong>{data.period.reading_days}</strong><span>일</span></p>
            <p className="result-note">
              {data.period.reading_days === 0
                ? '이 기간에는 체크한 날이 없습니다.'
                : '같은 날 여러 권을 읽어도 하루로 셉니다.'}
            </p>
          </div>
          <section className="statistics-library" aria-labelledby="statistics-library-title">
            <h3 id="statistics-library-title">현재 서재</h3>
            <p className="result-note">선택한 기간과 관계없는 현재 현황입니다.</p>
            <dl className="statistics-totals">
              <div><dt>서재에 담은 책</dt><dd>{data.library.total_books}<span>권</span></dd></div>
              <div><dt>완독 경험이 있는 책</dt><dd>{data.library.completed_books}<span>권</span></dd></div>
            </dl>
            <dl className="statistics-statuses">
              {readingStatuses.map((status) => (
                <div key={status}><dt>{statusLabels[status]}</dt><dd>{data.library.status_counts[status]}권</dd></div>
              ))}
            </dl>
            <p className="result-note">완독 경험은 책마다 한 번만 세며, 재독 중인 책도 포함합니다.</p>
            {data.library.total_books === 0 && <Link className="text-link" to="/search">첫 책을 서재에 담아보세요</Link>}
          </section>
        </>
      )}
    </div>
  )
}
