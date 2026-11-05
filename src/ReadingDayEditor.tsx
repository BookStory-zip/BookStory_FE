import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ApiError, cancelReadingDate, checkReadingDate, getAllLibraryBooks, getReadingLogs } from './lib/api'
import type { LibraryBookItem, ReadingLogEntry } from './lib/api'
import { withAccessToken } from './lib/auth'
import { isEditableDate } from './lib/dates'
import { commonErrorMessage, isUnclearWrite } from './lib/errors'

// onReadyChange: 체크 상태를 불러와 카드를 보여 줄 수 있는지 알린다. 부모 목록의 중복 표시를 정한다.
type Props = { date: string; today: string; onChanged: () => Promise<boolean>; onBusyChange: (busy: boolean) => void; onReadyChange?: (ready: boolean) => void }

export default function ReadingDayEditor({ date, today, onChanged, onBusyChange, onReadyChange }: Props) {
  const [data, setData] = useState<{ books: LibraryBookItem[]; logs: ReadingLogEntry[] } | null>(null)
  const [blocked, setBlocked] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const version = useRef(0)
  const active = useRef(true)
  const locked = useRef(false)
  const noticeRef = useRef<HTMLParagraphElement>(null)
  const inRange = isEditableDate(date, today)

  const load = useCallback(() => {
    const current = ++version.current
    return withAccessToken(async (token) => {
      const [books, logs] = await Promise.all([getAllLibraryBooks(token, { status: 'reading' }), getReadingLogs(token, date, date)])
      return { books, logs }
    }).then((fresh) => {
      if (current !== version.current || !active.current) return false
      setData(fresh)
      setError(null)
      setBlocked(false)
      return true
    }, (failure: unknown) => {
      if (current !== version.current || !active.current) return false
      setError(commonErrorMessage(failure, '체크 상태를 불러오지 못했습니다'))
      setBlocked(true)
      return false
    })
  }, [date])

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      version.current += 1
      onBusyChange(false)
    }
  }, [onBusyChange])

  useEffect(() => {
    if (inRange) void load()
    return () => { version.current += 1 }
  }, [inRange, load])

  const ready = inRange && data !== null
  useEffect(() => {
    onReadyChange?.(ready)
    return () => onReadyChange?.(false)
  }, [ready, onReadyChange])

  async function change(id: string, cancel: boolean) {
    if (locked.current || blocked || !inRange) return
    locked.current = true
    setPending(true)
    onBusyChange(true)
    setNotice('')
    let refresh = true
    try {
      try {
        await withAccessToken(async (token) => {
          if (cancel) await cancelReadingDate(token, id, date)
          else await checkReadingDate(token, id, date)
        })
        if (active.current) setNotice(cancel ? '체크를 취소했습니다.' : '읽은 날로 남겼습니다.')
      } catch (failure) {
        refresh = isUnclearWrite(failure) || !(failure instanceof ApiError) || [404, 409].includes(failure.status)
        const message = failure instanceof ApiError && failure.code === 'date_order'
          ? '현재 독서 시작일보다 이전 날짜에는 체크할 수 없어요.'
          : failure instanceof ApiError && failure.code === 'reading_check_not_allowed'
            ? '현재 읽는 중인 책만 체크할 수 있어요. 상태를 다시 확인해주세요.'
            : failure instanceof ApiError && failure.status === 404
              ? '서재에서 이 책을 찾을 수 없습니다. 최신 목록을 확인해주세요.'
              : isUnclearWrite(failure)
                ? '저장 결과를 확인하지 못했습니다. 다시 보내지 않고 최신 체크를 확인합니다.'
                : commonErrorMessage(failure, '체크를 변경하지 못했습니다')
        if (active.current) setNotice(message)
      }
      if (refresh && active.current) {
        setBlocked(true)
        await Promise.all([load(), onChanged()])
      }
    } finally {
      locked.current = false
      if (active.current) {
        setPending(false)
        onBusyChange(false)
        noticeRef.current?.focus()
      }
    }
  }

  if (!inRange) return <p className="result-note">오늘을 포함한 최근 7일만 체크하거나 취소할 수 있어요.</p>
  const checked = new Set(data?.logs.map((log) => log.user_book_id))
  const rows = [
    ...(data?.logs.map((log) => ({ id: log.user_book_id, title: log.title, authors: log.authors, cover: log.thumbnail_url, checked: true })) ?? []),
    ...(data?.books.filter((book) => book.status === 'reading' && !checked.has(book.id)).map((book) => ({ id: book.id, title: book.title, authors: book.authors, cover: book.thumbnail_url, checked: false })) ?? []),
  ]
  return (
    <div className="reading-day-editor" aria-label="선택한 날짜 체크 편집" aria-busy={pending}>
      <p className="result-note">현재 읽는 중인 책만 체크할 수 있어요. 완독·중단한 책의 기존 체크는 취소할 수 있어요. 시작일 이전 날짜는 서버에서 확인합니다.</p>
      <p role="status" ref={noticeRef} tabIndex={-1}>{pending ? '체크 변경 결과를 확인하는 중…' : notice}</p>
      {error && <div className="library-note" role="alert">
        <p>{error}</p>
        <button type="button" className="secondary" disabled={pending} onClick={() => void load()}>최신 체크 다시 확인</button>
      </div>}
      {!data && !error && <p className="result-note">체크할 책을 확인하는 중…</p>}
      {data && rows.length === 0 && <p className="result-note">체크할 수 있는 읽는 중 책이나 취소할 기록이 없습니다.</p>}
      <ul>
        {/* 표지·제목과 체크 버튼을 한 카드에 둔다. 표지·제목은 기존 기록 목록처럼 상세로 이동한다 */}
        {rows.map((row) => <li key={row.id} className="reading-day-row">
          <Link to={`/books/${row.id}`} className="records-book">
            {row.cover ? (
              <img className="result-cover" src={row.cover} alt="" width={120} height={174} loading="lazy" referrerPolicy="no-referrer" />
            ) : (
              <div className="result-cover cover-empty" aria-hidden="true">{row.title.slice(0, 1)}</div>
            )}
            <span>
              <span className="book-title">{row.title}</span>
              {row.authors.length > 0 && <span className="book-authors">{row.authors.join(', ')}</span>}
              <span className="book-authors">{row.checked ? '읽은 날' : '아직 체크하지 않음'}</span>
            </span>
          </Link>
          <button type="button" className="secondary compact" aria-label={`${row.title} ${row.checked ? '체크 취소' : '체크'}`} disabled={pending || blocked} onClick={() => void change(row.id, row.checked)}>
            {row.checked ? '체크 취소' : '체크'}
          </button>
        </li>)}
      </ul>
    </div>
  )
}
