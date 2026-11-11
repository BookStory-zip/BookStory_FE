import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { getNoteTimeline } from './lib/api'
import type { ReadingNoteEntry } from './lib/api'
import { withAccessToken } from './lib/auth'
import { monthOf, monthRange, spokenDate, spokenMonth } from './lib/dates'
import { commonErrorMessage } from './lib/errors'
import { refreshNotePhotos, NOTE_REFRESH_PAGE_SIZE } from './lib/notes'
import CabinIcon from './CabinIcon'
import { NoteText } from './ReadingNotes'

type Props = { month: string; today: string; onMove: (months: number) => void }
type List = { items: ReadingNoteEntry[]; offset: number; more: boolean }
const PAGE_SIZE = 20

// 서버의 평평한 목록(날짜·작성 시각 내림차순)을 그대로 두고, 화면에서만 같은 날짜끼리 묶는다.
function byDate(items: ReadingNoteEntry[]) {
  const groups: { date: string; items: ReadingNoteEntry[] }[] = []
  for (const item of items) {
    const last = groups.at(-1)
    if (last?.date === item.note_date) last.items.push(item)
    else groups.push({ date: item.note_date, items: [item] })
  }
  return groups
}

export default function NoteTimeline({ month, today, onMove }: Props) {
  const [list, setList] = useState<List | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const version = useRef(0)
  const photoRefresh = useRef<Promise<void> | null>(null)

  const load = useCallback((offset: number) => {
    const current = ++version.current
    const { start, end } = monthRange(month)
    withAccessToken((token) => getNoteTimeline(token, start, end, PAGE_SIZE, offset)).then((page) => {
      if (version.current !== current) return
      setList((previous) => ({
        items: offset === 0 ? page : [...new Map([...(previous?.items ?? []), ...page].map((item) => [item.id, item])).values()],
        offset: offset + page.length, more: page.length === PAGE_SIZE,
      }))
    }, (loadError: unknown) => {
      // 더 보기 실패에도 이미 받은 노트와 다음 위치를 남긴다.
      if (version.current === current) setError(commonErrorMessage(loadError, '노트를 불러오지 못했습니다'))
    }).finally(() => {
      if (version.current === current) setLoading(false)
    })
  }, [month])

  useEffect(() => {
    load(0)
    // 달을 바꾸거나 화면을 떠나면 이전 요청의 늦은 응답을 버린다.
    return () => { version.current += 1 }
  }, [load])

  function more(offset: number) {
    setLoading(true)
    setError(null)
    load(offset)
  }

  function refreshPhotos(): Promise<void> {
    if (photoRefresh.current) return photoRefresh.current
    const currentVersion = version.current
    const { start, end } = monthRange(month)
    const isCurrent = () => version.current === currentVersion
    const request = refreshNotePhotos(list?.items ?? [], (offset) =>
      withAccessToken((token) => getNoteTimeline(token, start, end, NOTE_REFRESH_PAGE_SIZE, offset)), isCurrent)
      .then((items) => {
        if (!items || !isCurrent()) return
        setList((previous) => !previous || !isCurrent() ? previous : { ...previous, items, offset: Math.max(0, previous.offset - (previous.items.length - items.length)) })
      }).finally(() => { photoRefresh.current = null })
    photoRefresh.current = request
    return request
  }

  // 부모가 달마다 key로 다시 그리므로 이 목록은 항상 현재 달의 것이다.
  const current = list
  const failure = error

  return (
    <div className="note-timeline">
      <div className="records-month">
        <button type="button" className="calendar-nav" aria-label="이전 달" disabled={month <= '0001-01'} onClick={() => onMove(-1)}>‹</button>
        <h2 aria-live="polite">{spokenMonth(month)}</h2>
        <button type="button" className="calendar-nav" aria-label="다음 달" disabled={month >= monthOf(today)} onClick={() => onMove(1)}>›</button>
      </div>
      <p className="result-note">책마다 남긴 비공개 독서 노트를 날짜별로 모아 봅니다.</p>

      {!current && !failure && (
        <div className="cabin-loading" role="status">
          <CabinIcon className="cabin-icon" />
          <p>노트를 펼치는 중…</p>
        </div>
      )}
      {current?.items.length === 0 && <p className="records-summary">이 달에 남긴 노트가 없습니다.</p>}
      {current && byDate(current.items).map((group) => (
        <section key={group.date} className="note-day" aria-labelledby={`note-day-${group.date}`}>
          <h3 id={`note-day-${group.date}`}>{spokenDate(group.date)}</h3>
          <ul className="note-list">
            {group.items.map((item) => (
              <li key={item.id}>
                <Link to={`/books/${encodeURIComponent(item.user_book_id)}`} className="records-book">
                  {item.thumbnail_url ? (
                    <img className="result-cover" src={item.thumbnail_url} alt="" width={120} height={174} loading="lazy" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="result-cover cover-empty" aria-hidden="true">{item.title.slice(0, 1)}</div>
                  )}
                  <span>
                    <span className="book-title">{item.title}</span>
                    {item.authors.length > 0 && <span className="book-authors">{item.authors.join(', ')}</span>}
                  </span>
                </Link>
                <NoteText note={item} onRefresh={refreshPhotos} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {failure && (
        <div className="library-note" role="alert">
          <p>{failure}</p>
          <button type="button" className="secondary" disabled={loading} onClick={() => more(current?.offset ?? 0)}>다시 시도</button>
        </div>
      )}
      {current?.more && !failure && (
        <button type="button" className="secondary" disabled={loading} onClick={() => more(current.offset)}>{loading ? '불러오는 중…' : '노트 더 보기'}</button>
      )}
    </div>
  )
}
