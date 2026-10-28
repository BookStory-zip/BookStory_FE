import { useEffect, useRef, useState } from 'react'
import { getLibraryBooks, statusLabels } from './lib/api'
import type { LibraryBookItem } from './lib/api'
import { withAccessToken } from './lib/auth'
import { commonErrorMessage } from './lib/errors'
import { Link } from 'react-router'
import CabinIcon from './CabinIcon'

export const PAGE_SIZE = 20

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

  // 첫 조회는 초기 상태가 이미 loading이므로 화면 상태 전환은 버튼 핸들러에서만 한다.
  async function load(offset: number) {
    busy.current = true

    // Render 무료 인스턴스는 첫 응답이 늦을 수 있다.
    const slowTimer = setTimeout(() => setSlow(true), 4000)
    try {
      const page = await withAccessToken((token) =>
        getLibraryBooks(token, PAGE_SIZE, offset),
      )
      if (!active.current) return
      setBooks((current) => (offset === 0 ? page : [...current, ...page]))
      setHasMore(page.length === PAGE_SIZE)
      setPhase('ready')
    } catch (loadError) {
      if (!active.current) return
      setError(errorMessage(loadError))
      if (offset === 0) setPhase('error')
    } finally {
      clearTimeout(slowTimer)
      busy.current = false
      if (active.current) {
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
    if (busy.current) return
    setError(null)
    setLoadingMore(true)
    void load(books.length)
  }

  useEffect(() => {
    active.current = true
    if (!busy.current) void load(0)
    return () => {
      active.current = false
    }
  }, [])

  return (
    <section className="library" aria-labelledby="library-title" aria-busy={phase === 'loading'}>
      <h1 id="library-title">내 서재</h1>
      <p className="library-sub">숲속 오두막 책장에 꽂아 둔 책</p>

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
        <ul className="shelf">
          {books.map((book) => (
            <li key={book.id}>
              {/* 상세 경로에는 공통 책 id가 아닌 서재 id(user_book_id)를 쓴다 */}
              <Link to={`/books/${book.id}`} className="book">
              {book.thumbnail_url ? (
                <img
                  className="cover"
                  src={book.thumbnail_url}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
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
            </li>
          ))}
        </ul>
      )}

      {phase === 'ready' && error && (
        <p className="library-note" role="alert">{error}</p>
      )}

      {phase === 'ready' && hasMore && (
        <button
          type="button"
          className="secondary more"
          onClick={loadMore}
          disabled={loadingMore}
        >
          {loadingMore ? (slow ? '서버 응답을 기다리는 중…' : '불러오는 중…') : '더 보기'}
        </button>
      )}
    </section>
  )
}
