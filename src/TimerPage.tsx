import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ApiError, getAllLibraryBooks, getLibraryBook } from './lib/api'
import type { LibraryBookItem, ReadingStatus } from './lib/api'
import { withAccessToken } from './lib/auth'
import { commonErrorMessage } from './lib/errors'
import { readTimer, subscribeTimer } from './lib/timer'
import ReadingTimer from './ReadingTimer'

type SelectedBook = Pick<LibraryBookItem, 'id' | 'title' | 'status'>

function timerBookId(userId: string) {
  try { return readTimer(userId)?.userBookId ?? null } catch { return null }
}

// 측정 중인 책은 지워졌어도 저장·버리기를 위해 남기고, 주소로 받은 책은 조회에 실패하면 선택하지 않는다.
async function restoreBook(token: string, draftId: string | null, requestedId: string | null): Promise<SelectedBook | null> {
  const id = draftId ?? requestedId
  if (!id) return null
  try { return await getLibraryBook(token, id) } catch (failure) {
    if (!draftId) return null
    if (!(failure instanceof ApiError) || failure.status !== 404) throw failure
    return { id, title: '서재에서 찾을 수 없는 책', status: 'want_to_read' }
  }
}

export default function TimerPage({ userId, embedded = false }: { userId: string; embedded?: boolean }) {
  const [params] = useSearchParams()
  const requestedBookId = params.get('book')
  const [books, setBooks] = useState<LibraryBookItem[]>([])
  const [selected, setSelected] = useState<SelectedBook | null>(null)
  const [choice, setChoice] = useState('')
  const [draftBookId, setDraftBookId] = useState(() => timerBookId(userId))
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const active = useRef(true)
  const version = useRef(0)
  const selectedId = useRef<string | null | undefined>(undefined)
  const page = useRef<HTMLElement>(null)
  const focusAfterChoice = useRef(false)
  const Heading = embedded ? 'h2' : 'h1'
  useEffect(() => {
    if (!focusAfterChoice.current) return
    focusAfterChoice.current = false
    page.current?.querySelector<HTMLElement>(selected ? '.timer-actions button' : '#timer-book')?.focus()
  }, [selected])
  const load = useCallback(async () => {
    const run = ++version.current
    try {
      const [items, restored] = await withAccessToken((token) => Promise.all([
        getAllLibraryBooks(token, { status: 'reading' }),
        // 다시 확인할 때는 사용자가 고른 책을 주소의 책보다 먼저 유지한다.
        restoreBook(token, timerBookId(userId), selectedId.current === undefined ? requestedBookId : selectedId.current),
      ]))
      if (!active.current || run !== version.current) return
      setBooks(items)
      selectedId.current = restored?.id ?? null
      setSelected(restored)
      setError('')
    } catch (failure) {
      if (active.current && run === version.current) setError(commonErrorMessage(failure, '책 목록을 불러오지 못했습니다'))
    } finally {
      if (active.current && run === version.current) setLoading(false)
    }
  }, [requestedBookId, userId])

  useEffect(() => {
    active.current = true
    void load()
    const unsubscribe = subscribeTimer(() => {
      const id = timerBookId(userId)
      setDraftBookId(id)
      if (id && id !== selectedId.current) {
        setLoading(true)
        void load()
      }
    })
    return () => { active.current = false; version.current += 1; unsubscribe() }
  }, [load, userId])

  async function refreshSelected(): Promise<ReadingStatus | null> {
    if (!selected) return null
    const run = version.current
    try {
      const fresh = await withAccessToken((token) => getLibraryBook(token, selected.id))
      if (!active.current || run !== version.current) return null
      setSelected(fresh)
      setBooks((current) => current.map((book) => book.id === fresh.id ? { ...book, status: fresh.status } : book))
      return fresh.status
    } catch (failure) {
      if (active.current && run === version.current) {
        // 서재에서 지워진 책은 측정을 버릴 수 있도록 화면을 잠그지 않고 측정만 막는다.
        if (failure instanceof ApiError && failure.status === 404) setSelected({ ...selected, status: 'want_to_read' })
        else setError(commonErrorMessage(failure, '책 상태를 다시 확인하지 못했습니다'))
      }
      return null
    }
  }

  return <section ref={page} className="timer-page" aria-labelledby="timer-page-title">
    {selected ? <Heading id="timer-page-title" className="timer-book-title" aria-label={selected.title}>
      {!draftBookId ? <button type="button" className="timer-change-book" aria-label={`${selected.title}, 읽을 책 변경`} disabled={busy || loading}
        onClick={() => { if (busy || loading || timerBookId(userId)) return; selectedId.current = null; setChoice(selected.id); focusAfterChoice.current = true; setSelected(null) }}>{selected.title}</button> : selected.title}
    </Heading> : <Heading id="timer-page-title">책 선택</Heading>}
    {loading && <p className="result-note">책 목록을 불러오는 중…</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" className="secondary" disabled={busy || loading} onClick={() => { setLoading(true); setError(''); void load() }}>책 목록 다시 확인</button></div>}
    {!loading && !error && books.length === 0 && !selected && <p className="result-note">
      읽는 중인 책이 없습니다. <Link to="/">서재로 가기</Link>
    </p>}
    {!loading && !error && !selected && books.length > 0 && <div className="timer-book-picker">
      <label htmlFor="timer-book">어떤 책을 읽으시나요?</label>
      <select id="timer-book" value={choice} disabled={busy || !!draftBookId}
        onChange={(event) => setChoice(event.target.value)}>
        <option value="">책을 선택해주세요</option>
        {books.map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}
      </select>
      <button type="button" disabled={!choice || busy || !!draftBookId} onClick={() => {
        const book = books.find((item) => item.id === choice)
        if (!book || busy || timerBookId(userId)) return
        selectedId.current = book.id
        focusAfterChoice.current = true
        setSelected(book)
      }}>선택 완료</button>
    </div>}
    {!loading && selected && <ReadingTimer key={selected.id} userId={userId} userBookId={selected.id} status={selected.status}
      blocked={!!error} onBusyChange={setBusy} onSaved={refreshSelected} />}
  </section>
}
