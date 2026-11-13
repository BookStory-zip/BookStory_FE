import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ApiError } from './lib/api'
import { getPopularBooks, isPopularFresh, POPULAR_MAX_AGE } from './lib/discovery'
import type { PopularBooksSnapshot } from './lib/discovery'
import { spokenDate } from './lib/dates'
import { commonErrorMessage } from './lib/errors'

export default function PopularBooks() {
  // undefined는 조회 중, null은 첫 수집 전·빈 목록·오래된 수집본이다.
  const [data, setData] = useState<PopularBooksSnapshot | null | undefined>(undefined)
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<{ text: string; limit: 10 | 30 } | null>(null)
  const [retryAt, setRetryAt] = useState(0)
  const retryDeadline = useRef(0)
  const version = useRef(0)
  const busy = useRef(false)

  const load = useCallback((limit: 10 | 30) => {
    if (busy.current || Date.now() < retryDeadline.current) return
    busy.current = true
    const current = ++version.current
    return getPopularBooks(limit).then((snapshot) => {
      if (version.current !== current) return
      setData(isPopularFresh(snapshot) ? snapshot : null)
      setExpanded(limit === 30)
    }, (failure: unknown) => {
      if (version.current !== current) return
      let text = commonErrorMessage(failure, '인기 도서를 불러오지 못했습니다')
      if (failure instanceof ApiError && failure.status === 429) {
        const seconds = Math.max(1, Math.ceil(failure.retryAfter ?? 60))
        retryDeadline.current = Date.now() + seconds * 1000
        setRetryAt(retryDeadline.current)
        text = `인기 도서 요청이 많아요. ${seconds}초 후 다시 시도해주세요.`
      }
      setError({ text, limit })
    }).finally(() => {
      if (version.current === current) { busy.current = false; setLoading(false) }
    })
  }, [])

  useEffect(() => {
    void load(10)
    return () => { version.current += 1; busy.current = false }
  }, [load])

  function request(limit: 10 | 30) {
    if (busy.current || Date.now() < retryDeadline.current) return
    setLoading(true)
    setError(null)
    void load(limit)
  }

  useEffect(() => {
    if (!retryAt) return
    const timer = setTimeout(() => { retryDeadline.current = 0; setRetryAt(0) }, Math.max(0, retryAt - Date.now()))
    return () => clearTimeout(timer)
  }, [retryAt])

  useEffect(() => {
    if (!data?.collected_at) return
    const timer = setTimeout(() => setData(null), Math.max(0, Date.parse(data.collected_at) + POPULAR_MAX_AGE + 1 - Date.now()))
    return () => clearTimeout(timer)
  }, [data])

  if (data === null) return null
  return <section className="popular-books" aria-labelledby="popular-title">
    <div className="popular-heading">
      <h2 id="popular-title">요즘 인기 있는 책</h2>
      {data && (expanded || data.items.length >= 10) && <button type="button" className="link-button" disabled={loading || retryAt > 0}
        onClick={() => { if (expanded) setExpanded(false); else if (data.items.length > 10) setExpanded(true); else request(30) }}>
        {loading ? '불러오는 중…' : expanded ? '접기' : '전체 보기'}
      </button>}
    </div>
    {data && <>
      <p className="popular-source">YES24 일간·월간 베스트셀러 종합</p>
      <p className="result-note">{data.basis_date && `일간 ${spokenDate(data.basis_date)} 기준`} · {data.monthly_basis && `월간 ${data.monthly_basis.replace('-', '년 ')}월 기준`}</p>
      <ol className={`popular-list ${expanded ? 'is-expanded' : ''}`} aria-label="인기 도서 순위">
        {(expanded ? data.items : data.items.slice(0, 10)).map((book) => <li key={book.isbn13}>
          <span className="popular-rank" aria-label={`${book.rank}위`}>{book.rank}</span>
          <Link to={`/catalog/${book.isbn13}`} state={{ discoverySource: { isbn13: book.isbn13, source_url: book.source_url } }} title={book.title}>
            {book.thumbnail_url ? <img className="popular-cover" src={book.thumbnail_url} alt="" width={120} height={174} loading="lazy" referrerPolicy="no-referrer" />
              : <span className="popular-cover cover-empty" aria-hidden="true">{book.title.slice(0, 1)}</span>}
            <span className="popular-title">{book.title}</span>
          </Link>
          <p className="popular-author">{book.author || '저자 정보 없음'}</p>
          {book.publisher && <p className="popular-author">{book.publisher}</p>}
          <a className="popular-source-link" href={book.source_url} target="_blank" rel="noreferrer" aria-label={`${book.title} YES24에서 보기`}>YES24에서 보기 ↗</a>
        </li>)}
      </ol>
      <p className="result-note">일간·월간 순위를 종합하고 일부 분야를 제외한 목록입니다.</p>
    </>}
    {loading && !data && <p role="status" className="result-note">인기 도서를 불러오는 중…</p>}
    {error && <div className="library-note" role="alert"><p>{error.text}</p>
      <button type="button" className="secondary compact" disabled={loading || retryAt > 0} onClick={() => request(error.limit)}>다시 시도</button>
    </div>}
  </section>
}
