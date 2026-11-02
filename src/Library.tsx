import { useEffect, useRef, useState } from 'react'
import { ApiError, getLibraryBooks, moveLibraryBook, statusLabels } from './lib/api'
import type { LibraryBookItem } from './lib/api'
import { withAccessToken } from './lib/auth'
import { commonErrorMessage, isUnclearWrite } from './lib/errors'
import { Link } from 'react-router'
import CabinIcon from './CabinIcon'

export const PAGE_SIZE = 20
const MAX_LIMIT = 100
const SCROLL_EDGE = 80
const SCROLL_STEP = 12

// 손가락·마우스 아래의 책 순번. 서재 밖이면 null.
function bookIndexAt(shelf: HTMLElement | null, x: number, y: number) {
  const target = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-book-index]')
  return target && shelf?.contains(target) ? Number(target.dataset.bookIndex) : null
}

function errorMessage(error: unknown) {
  return commonErrorMessage(error, '서재를 불러오지 못했습니다')
}

// 계정이 바뀌면 부모가 key로 새로 마운트하므로 이전 계정 목록이 남지 않는다.
export default function Library() {
  const [books, setBooks] = useState<LibraryBookItem[]>([])
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [slow, setSlow] = useState(false)
  const active = useRef(true)
  const busy = useRef(false)
  const loadVersion = useRef(0)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [notice, setNotice] = useState('')
  const [dragTarget, setDragTarget] = useState<number | null>(null)
  const dragRef = useRef<{ from: number; to: number; pointerId: number; x: number; y: number } | null>(null)
  const dragging = dragTarget !== null
  const shelf = useRef<HTMLUListElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const editButton = useRef<HTMLButtonElement>(null)
  const refreshButton = useRef<HTMLButtonElement>(null)
  const focusAfterMove = useRef<string | null>(null)
  const locked = saving || loadingMore || needsRefresh

  // 첫 조회는 초기 상태가 이미 loading이므로 화면 상태 전환은 버튼 핸들러에서만 한다.
  async function load(offset: number, preserve = false, limit = PAGE_SIZE) {
    busy.current = true
    const version = ++loadVersion.current

    // Render 무료 인스턴스는 첫 응답이 늦을 수 있다.
    const slowTimer = setTimeout(() => {
      if (active.current && version === loadVersion.current) setSlow(true)
    }, 4000)
    try {
      const page = await withAccessToken((token) =>
        getLibraryBooks(token, limit, offset),
      )
      if (!active.current || version !== loadVersion.current) return false
      setBooks((current) => (offset === 0 ? page : [...current, ...page]))
      // 불러온 범위를 다시 읽을 때는 꽉 차도 뒤에 책이 더 있는지 알 수 없으므로 기존 판단을 유지한다.
      setHasMore((previous) => page.length === limit && (limit === PAGE_SIZE || previous))
      setPhase('ready')
      return true
    } catch (loadError) {
      if (!active.current || version !== loadVersion.current) return false
      setError(errorMessage(loadError))
      if (offset === 0 && !preserve) setPhase('error')
      return false
    } finally {
      clearTimeout(slowTimer)
      if (active.current && version === loadVersion.current) {
        busy.current = false
        setSlow(false)
        setLoadingMore(false)
      }
    }
  }

  function retry() {
    if (busy.current) return
    setError(null)
    setPhase('loading')
    void load(0)
  }

  function loadMore() {
    if (busy.current || locked || dragRef.current) return
    setError(null)
    setLoadingMore(true)
    void load(books.length)
  }

  useEffect(() => {
    active.current = true
    if (!busy.current) void load(0)
    return () => {
      active.current = false
      loadVersion.current += 1
      busy.current = false
    }
  }, [])

  useEffect(() => {
    if (saving || !focusAfterMove.current) return
    const handle = shelf.current?.querySelector<HTMLButtonElement>(`[data-user-book-id="${focusAfterMove.current}"]`)
    // 다시 불러온 범위 밖으로 옮겨진 책은 편집 버튼으로 포커스를 돌린다.
    const target = needsRefresh ? refreshButton.current : handle ?? editButton.current ?? title.current
    target?.focus()
    if (!needsRefresh) focusAfterMove.current = null
  }, [saving, needsRefresh])

  // 드래그 중 화면 가장자리에서 자동 스크롤하고, Safari처럼 손잡이에 포커스가 없어도 Escape로 취소한다.
  useEffect(() => {
    if (!dragging) return
    let frame = requestAnimationFrame(function step() {
      const current = dragRef.current
      if (!current) return
      const dy = current.y < SCROLL_EDGE ? -SCROLL_STEP : current.y > window.innerHeight - SCROLL_EDGE ? SCROLL_STEP : 0
      if (dy) {
        window.scrollBy(0, dy)
        current.to = bookIndexAt(shelf.current, current.x, current.y) ?? current.from
        setDragTarget(current.to)
      }
      frame = requestAnimationFrame(step)
    })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      dragRef.current = null
      setDragTarget(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [dragging])

  async function refreshOrder(message: string, count = books.length) {
    setNeedsRefresh(true)
    setError(null)
    // 더 보기로 불러온 범위까지 다시 읽어 옮긴 책이 화면에서 사라지지 않게 한다.
    // ponytail: 100개(API 최대) 넘게 불러온 뒤 옮기면 100개까지만 다시 읽고 나머지는 더 보기로 이어 받는다.
    if (await load(0, true, Math.min(Math.max(count, PAGE_SIZE), MAX_LIMIT))) {
      if (!active.current) return
      setNeedsRefresh(false)
      setNotice(message)
    } else if (active.current) {
      setNotice('최신 순서를 확인한 뒤 다시 옮길 수 있어요.')
    }
  }

  async function move(from: number, to: number) {
    if (busy.current || locked || from === to || to < 0 || to >= books.length) return
    const moved = books[from]
    const remaining = books.filter((book) => book.id !== moved.id)
    const anchor = to === 0 ? null : remaining[to - 1].id
    busy.current = true
    focusAfterMove.current = moved.id
    setSaving(true)
    setNotice('')
    setError(null)
    const slowTimer = setTimeout(() => {
      if (active.current) setSlow(true)
    }, 4000)
    try {
      await withAccessToken((token) => moveLibraryBook(token, moved.id, anchor))
      clearTimeout(slowTimer)
      if (!active.current) return
      await refreshOrder('순서를 저장했습니다.')
    } catch (moveError) {
      if (!active.current) return
      if (isUnclearWrite(moveError) || (moveError instanceof ApiError && moveError.status === 404)) {
        await refreshOrder('최신 서재 순서를 불러왔습니다. 이동 결과를 확인해주세요.')
      } else {
        setError(commonErrorMessage(moveError, '순서를 바꾸지 못했습니다'))
      }
    } finally {
      clearTimeout(slowTimer)
      if (active.current) {
        busy.current = false
        setSaving(false)
        setSlow(false)
      }
    }
  }

  async function retryOrder() {
    if (busy.current) return
    setSaving(true)
    try {
      await refreshOrder('최신 서재 순서를 확인했습니다.')
    } finally {
      if (active.current) setSaving(false)
    }
  }

  function cancelDrag() {
    dragRef.current = null
    setDragTarget(null)
  }

  function updateDrag(event: { pointerId: number; clientX: number; clientY: number }) {
    const current = dragRef.current
    if (!current || current.pointerId !== event.pointerId) return
    current.x = event.clientX
    current.y = event.clientY
    current.to = bookIndexAt(shelf.current, current.x, current.y) ?? current.from
    setDragTarget(current.to)
  }

  return (
    <section className="library" aria-labelledby="library-title" aria-busy={phase === 'loading'}>
      <h1 id="library-title" ref={title} tabIndex={-1}>내 서재</h1>
      <p className="library-sub">숲속 오두막 책장에 꽂아 둔 책</p>

      {phase === 'ready' && books.length > 0 && (
        <div className="library-order">
          <button ref={editButton} type="button" className="secondary compact" aria-pressed={editing}
            disabled={saving || loadingMore || dragging} onClick={() => {
              setEditing(!editing)
              setNotice('')
            }}>
            {editing ? '편집 마치기' : '순서 편집'}
          </button>
          {editing && <p id="order-help">손잡이를 끌거나 앞·뒤 버튼으로 옮겨요. 이동할 때마다 저장돼요. 불러온 책 사이에서만 옮길 수 있어요.</p>}
        </div>
      )}
      <p className="library-order-status" role="status">{saving ? (slow ? '서버를 깨우는 중입니다. 처음 접속하면 30초 정도 걸릴 수 있습니다.' : needsRefresh ? '최신 순서를 확인하는 중…' : '순서를 저장하는 중…') : notice}</p>

      {phase === 'loading' && (
        <div className="cabin-loading">
          <CabinIcon className="cabin-icon" />
          <p>
            {slow ? '서버를 깨우는 중입니다. 처음 접속하면 30초 정도 걸릴 수 있습니다.' : '오두막 문을 여는 중…'}
          </p>
        </div>
      )}

      {phase === 'error' && (
        <div className="library-note" role="alert">
          <p>{error}</p>
          <button type="button" className="secondary" onClick={retry}>
            다시 시도
          </button>
        </div>
      )}

      {phase === 'ready' && books.length === 0 && (
        <div className="shelf-empty">
          <p>
            아직 서재에 담은 책이 없습니다. <Link to="/search">책 찾으러 가기</Link>
          </p>
        </div>
      )}

      {books.length > 0 && (
        <ul ref={shelf} className={`shelf${editing ? ' shelf-editing' : ''}`} aria-busy={saving}>
          {books.map((book, index) => (
            <li key={book.id} data-book-index={index} className={dragTarget === index ? 'order-target' : undefined}>
              {/* 상세 경로에는 공통 책 id가 아닌 서재 id(user_book_id)를 쓴다 */}
              <Link to={`/books/${book.id}`} className="book" draggable={false}>
              {book.thumbnail_url ? (
                <img
                  className="cover"
                  src={book.thumbnail_url}
                  alt=""
                  width={120}
                  height={174}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  draggable={false}
                />
              ) : (
                <div className="cover cover-empty" aria-hidden="true">
                  {book.title.slice(0, 1)}
                </div>
              )}
              <p className="book-title">{book.title}</p>
              {book.authors.length > 0 && (
                <p className="book-authors">{book.authors.join(', ')}</p>
              )}
              <p className={`book-status status-${book.status}`}>
                {statusLabels[book.status]}
              </p>
              </Link>
              {editing && (
                <div className="book-order" role="group" aria-label={`${book.title} 순서`}>
                  <button type="button" className="secondary order-handle" aria-label={`${book.title} 이동 손잡이`}
                    aria-describedby="order-help" disabled={locked}
                    data-user-book-id={book.id}
                    onPointerDown={(event) => {
                      if (locked || busy.current || !event.isPrimary || event.button !== 0) return
                      event.currentTarget.setPointerCapture(event.pointerId)
                      dragRef.current = { from: index, to: index, pointerId: event.pointerId, x: event.clientX, y: event.clientY }
                      setDragTarget(index)
                    }}
                    onPointerMove={updateDrag}
                    onPointerUp={(event) => {
                      if (dragRef.current?.pointerId !== event.pointerId) return
                      updateDrag(event)
                      const current = dragRef.current!
                      cancelDrag()
                      void move(current.from, current.to)
                    }}
                    onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}>
                    <span aria-hidden="true">⠿</span>
                  </button>
                  <div className="order-steps">
                    <button type="button" className="secondary" aria-label={`${book.title} 앞으로`} disabled={locked || dragging || index === 0} onClick={() => void move(index, index - 1)}>앞</button>
                    <button type="button" className="secondary" aria-label={`${book.title} 뒤로`} disabled={locked || dragging || index === books.length - 1} onClick={() => void move(index, index + 1)}>뒤</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {phase === 'ready' && error && (
        <p className="library-note" role="alert">{error}</p>
      )}

      {needsRefresh && !saving && (
        <button ref={refreshButton} type="button" className="secondary" onClick={() => void retryOrder()}>최신 순서 다시 확인</button>
      )}

      {phase === 'ready' && hasMore && (
        <button
          type="button"
          className="secondary more"
          onClick={loadMore}
          disabled={locked || dragging}
        >
          {loadingMore ? (slow ? '서버 응답을 기다리는 중…' : '불러오는 중…') : '더 보기'}
        </button>
      )}
    </section>
  )
}
