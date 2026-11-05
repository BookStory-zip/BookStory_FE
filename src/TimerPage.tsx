import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ApiError, getLibraryBook, getLibraryBooks } from './lib/api'
import type { LibraryBookItem, ReadingStatus } from './lib/api'
import { withAccessToken } from './lib/auth'
import { commonErrorMessage } from './lib/errors'
import { readTimer, subscribeTimer } from './lib/timer'
import ReadingTimer from './ReadingTimer'

type SelectedBook = Pick<LibraryBookItem, 'id' | 'title' | 'status'>

function timerBookId(userId: string) {
  try { return readTimer(userId)?.userBookId ?? null } catch { return null }
}

export default function TimerPage({ userId }: { userId: string }) {
  const [params] = useSearchParams()
  const requestedBookId = params.get('book')
  const [mode, setMode] = useState<'reading' | 'history'>('reading')
  const [books, setBooks] = useState<LibraryBookItem[]>([])
  const [selected, setSelected] = useState<SelectedBook | null>(null)
  const [draftBookId, setDraftBookId] = useState(() => timerBookId(userId))
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const active = useRef(true)
  const version = useRef(0)
  const selectedId = useRef<string | null>(null)

  const load = useCallback(async () => {
    const run = ++version.current
    try {
      const result = await withAccessToken(async (token) => {
        const items: LibraryBookItem[] = []
        for (let offset = 0; ; offset += 100) {
          const page = await getLibraryBooks(token, 100, offset, mode === 'reading' ? { status: 'reading' } : {})
          if (!active.current || run !== version.current) return null
          items.push(...(mode === 'reading' ? page.filter((book) => book.status === 'reading') : page))
          if (page.length < 100) break
        }
        const restoreId = timerBookId(userId) ?? requestedBookId
        let restored: SelectedBook | null = null
        if (restoreId) {
          try { restored = await getLibraryBook(token, restoreId) } catch (failure) {
            if (!(failure instanceof ApiError) || failure.status !== 404) throw failure
            restored = { id: restoreId, title: '서재에서 찾을 수 없는 책', status: 'want_to_read' }
          }
        }
        return { items, restored }
      })
      if (!result || !active.current || run !== version.current) return
      setBooks(result.items)
      selectedId.current = result.restored?.id ?? null
      setSelected(result.restored)
      setError('')
    } catch (failure) {
      if (active.current && run === version.current) setError(commonErrorMessage(failure, '책 목록을 불러오지 못했습니다'))
    } finally {
      if (active.current && run === version.current) setLoading(false)
    }
  }, [mode, requestedBookId, userId])

  useEffect(() => {
    active.current = true
    void load()
    const unsubscribe = subscribeTimer(() => {
      const id = timerBookId(userId)
      setDraftBookId(id)
      if (id && (id !== selectedId.current || mode === 'history')) {
        setLoading(true)
        if (mode === 'history') setMode('reading')
        else void load()
      }
    })
    return () => { active.current = false; version.current += 1; unsubscribe() }
  }, [load, mode, userId])

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
        setError(commonErrorMessage(failure, '책 상태를 다시 확인하지 못했습니다'))
        if (failure instanceof ApiError && failure.status === 404) setSelected({ ...selected, status: 'want_to_read' })
      }
      return null
    }
  }

  return <section className="timer-page" aria-labelledby="timer-page-title">
    <h1 id="timer-page-title">타이머</h1>
    <p className="library-sub">읽는 시간을 기록하고, 저장한 시간을 확인하세요.</p>
    <div className="timer-modes" aria-label="타이머 화면">
      <button type="button" className="secondary" aria-pressed={mode === 'reading'} disabled={busy || !!draftBookId}
        onClick={() => { if (mode !== 'reading') { selectedId.current = null; setSelected(null); setLoading(true); setError(''); setMode('reading') } }}>측정</button>
      <button type="button" className="secondary" aria-pressed={mode === 'history'} disabled={busy || !!draftBookId}
        onClick={() => { if (mode !== 'history') { selectedId.current = null; setSelected(null); setLoading(true); setError(''); setMode('history') } }}>시간 기록</button>
    </div>
    {loading && <p className="result-note">책 목록을 불러오는 중…</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" className="secondary" disabled={busy || loading} onClick={() => { setLoading(true); setError(''); void load() }}>책 목록 다시 확인</button></div>}
    {!loading && !error && books.length === 0 && !selected && <p className="result-note">
      {mode === 'reading' ? '읽는 중인 책이 없습니다.' : '서재에 등록된 책이 없습니다.'} <Link to="/">서재로 가기</Link>
    </p>}
    {!loading && !error && (books.length > 0 || selected) && <div className="timer-book-picker">
      <label htmlFor="timer-book">{mode === 'reading' ? '어떤 책을 읽으시나요?' : '시간 기록을 확인할 책'}</label>
      <select id="timer-book" value={selected?.id ?? ''} disabled={busy || !!draftBookId}
        onChange={(event) => {
          const book = books.find((item) => item.id === event.target.value) ?? null
          selectedId.current = book?.id ?? null
          setSelected(book)
        }}>
        <option value="">책을 선택해주세요</option>
        {selected && !books.some((book) => book.id === selected.id) && <option value={selected.id}>{selected.title}</option>}
        {books.map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}
      </select>
      {draftBookId && <p className="result-note">측정을 저장하거나 버린 뒤 다른 책을 선택할 수 있어요.</p>}
    </div>}
    {!loading && selected && <ReadingTimer key={selected.id} userId={userId} userBookId={selected.id} status={selected.status}
      blocked={!!error} historyOnly={mode === 'history'} onBusyChange={setBusy} onSaved={refreshSelected} />}
  </section>
}
