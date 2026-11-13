import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { addLibraryBook, ApiError, getLibraryBookByIsbn, statusLabels } from './lib/api'
import type { LibraryBookDetail } from './lib/api'
import { withAccessToken } from './lib/auth'
import { getCatalogBook, getPublicReviews } from './lib/catalog'
import type { CatalogBook, PublicReview } from './lib/catalog'
import { ADD_RATE_LIMITED, commonErrorMessage, isUnclearWrite } from './lib/errors'
import { formatKstDate } from './lib/record'
import { discoverySource } from './lib/discovery'

const PAGE_SIZE = 20

export default function BookCatalogPage() {
  const { isbn13 = '' } = useParams()
  const { state } = useLocation()
  return <BookCatalog key={isbn13} isbn13={isbn13} fallbackUrl={discoverySource(state, isbn13)} />
}

function BookCatalog({ isbn13, fallbackUrl }: { isbn13: string; fallbackUrl: string | null }) {
  const [book, setBook] = useState<CatalogBook | null>(null)
  const [bookError, setBookError] = useState('')
  // undefined는 확인 중, null은 서버가 404로 확인한 미등록 상태다.
  const [own, setOwn] = useState<LibraryBookDetail | null | undefined>(undefined)
  const [ownError, setOwnError] = useState('')
  const [reviews, setReviews] = useState<PublicReview[] | null>(null)
  const [reviewError, setReviewError] = useState('')
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [moreBusy, setMoreBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)
  const generation = useRef(0)
  const morePending = useRef(false)
  const addPending = useRef(false)

  function refresh() {
    generation.current++
    setBook(null); setBookError(''); setOwn(undefined); setOwnError('')
    setReviews(null); setReviewError(''); setHasMore(false); setOffset(0)
    morePending.current = false; setMoreBusy(false)
    setReload((value) => value + 1)
  }

  useEffect(() => {
    const version = ++generation.current
    const current = () => version === generation.current

    // 한 영역의 실패가 다른 영역을 가리지 않도록 세 요청을 동시에 시작한다.
    void getCatalogBook(isbn13).then((data) => {
      if (current()) setBook(data)
    }).catch((error: unknown) => {
      if (current()) setBookError(error instanceof ApiError && error.status === 404
        ? '이 책의 정보를 찾을 수 없습니다.' : commonErrorMessage(error, '책 정보를 불러오지 못했습니다'))
    })
    void withAccessToken((token) => getLibraryBookByIsbn(token, isbn13)).then((data) => {
      if (current()) setOwn(data)
    }).catch((error: unknown) => {
      if (current()) setOwnError(commonErrorMessage(error, '내 서재 정보를 확인하지 못했습니다'))
    })
    void withAccessToken((token) => getPublicReviews(token, isbn13, PAGE_SIZE, 0)).then((data) => {
      if (!current()) return
      setReviews(data); setOffset(data.length); setHasMore(data.length === PAGE_SIZE)
    }).catch((error: unknown) => {
      if (current()) setReviewError(commonErrorMessage(error, '후기를 불러오지 못했습니다'))
    })
    return () => { generation.current = version + 1 }
  }, [isbn13, reload])

  async function loadMore() {
    if (morePending.current) return
    morePending.current = true; setMoreBusy(true); setReviewError('')
    const version = generation.current
    try {
      const data = await withAccessToken((token) => getPublicReviews(token, isbn13, PAGE_SIZE, offset))
      if (version !== generation.current) return
      // 공개·비공개 전환으로 페이지가 밀려도 같은 후기를 두 번 그리지 않는다.
      setReviews((old) => [...(old ?? []), ...data.filter((item) => !old?.some((row) => row.id === item.id))])
      setOffset(offset + data.length); setHasMore(data.length === PAGE_SIZE)
    } catch (error) {
      if (version === generation.current) setReviewError(commonErrorMessage(error, '후기를 불러오지 못했습니다'))
    } finally {
      if (version === generation.current) { morePending.current = false; setMoreBusy(false) }
    }
  }

  async function add() {
    if (addPending.current || own !== null) return
    addPending.current = true; setAdding(true); setNotice('')
    const version = generation.current
    try {
      const result = await withAccessToken((token) => addLibraryBook(token, isbn13))
      if (version !== generation.current) return
      setNotice(result.created ? '서재에 담았습니다.' : '이미 서재에 있는 책입니다.')
      refresh()
    } catch (error) {
      if (version !== generation.current) return
      if (isUnclearWrite(error)) {
        setNotice('등록 결과를 확인하지 못했습니다. 내 서재 상태를 다시 확인하니 확인 후 다시 시도해주세요.')
        refresh()
      } else if (error instanceof ApiError && error.status === 429) setNotice(ADD_RATE_LIMITED)
      else setNotice(commonErrorMessage(error, '서재에 담지 못했습니다'))
    } finally {
      addPending.current = false; setAdding(false)
    }
  }

  return (
    <section className="detail catalog" aria-labelledby="catalog-title">
      <div className="catalog-nav">
        <Link to="/search" className="back-link">← 책 찾기</Link>
        <button type="button" className="secondary compact" disabled={adding} onClick={refresh}>다시 불러오기</button>
      </div>
      <div className="detail-head">
        {book?.thumbnail_url ? <img className="detail-cover" src={book.thumbnail_url} alt="" width={120} height={174} fetchPriority="high" referrerPolicy="no-referrer" />
          : <div className="detail-cover cover-empty" aria-hidden="true">{book?.title.slice(0, 1) ?? '책'}</div>}
        <div className="detail-info">
          <p className="catalog-eyebrow">책 이야기</p>
          <h1 id="catalog-title">{book?.title ?? '책 정보'}</h1>
          {book && <>
            <p className="book-authors">{book.authors.join(', ') || '저자 정보 없음'}</p>
            <p className="result-note">{[book.publisher, book.published_date, book.page_count && `${book.page_count}쪽`].filter(Boolean).join(' · ') || '출판 정보 없음'}</p>
            <p className="result-note">ISBN {book.isbn13}</p>
          </>}
        </div>
      </div>
      {bookError ? <div role="alert"><p>{bookError}</p>
        {fallbackUrl && <a href={fallbackUrl} target="_blank" rel="noreferrer">YES24에서 보기 ↗</a>}
      </div> : !book && <p role="status">책 정보를 불러오는 중…</p>}
      <p role="status" className="detail-notice">{notice}</p>

      <section className="detail-card" aria-labelledby="catalog-intro">
        <h2 id="catalog-intro">책 소개</h2>
        {book ? <>
          <p className="review-memo">{book.description || '책 소개가 제공되지 않았습니다.'}</p>
          {/^https?:\/\//i.test(book.source_url) && <a href={book.source_url} target="_blank" rel="noreferrer">제공처에서 더 보기 ↗</a>}
        </> : <p className="result-note">{bookError ? '책 정보를 다시 불러와주세요.' : '소개를 불러오는 중…'}</p>}
      </section>

      <section className="detail-card" aria-labelledby="catalog-own">
        <h2 id="catalog-own">나의 기록</h2>
        {ownError ? <><p>내 서재 정보를 확인하지 못했습니다.</p><p role="alert" className="result-note">{ownError}</p></>
          : own === undefined ? <p role="status">내 서재를 확인하는 중…</p>
            : own === null ? <><p className="result-note">아직 내 서재에 없는 책입니다.</p><button type="button" disabled={adding} onClick={() => void add()}>{adding ? '담는 중…' : '서재에 담기'}</button></>
              : <>
                <div className="review-heading"><span className={`book-status status-${own.status}`}>{statusLabels[own.status]}</span><span className="review-visibility">{own.is_review_public ? '공개 후기' : '비공개'}</span></div>
                {own.rating !== null && <p>내 별점 {own.rating} / 5</p>}
                <p className="review-memo">{own.memo || '아직 남긴 후기가 없습니다.'}</p>
                <Link to={`/books/${own.id}`}>내 기록 수정</Link>
              </>}
      </section>

      <section className="detail-card" aria-labelledby="catalog-reviews">
        <div className="review-heading"><h2 id="catalog-reviews">함께 읽은 이야기</h2>{book && <span className="result-note">공개 후기 {book.reviews.total_reviews}개</span>}</div>
        {book && <p className="review-summary">{book.reviews.average_rating === null ? '아직 평가 없음' : `★ ${book.reviews.average_rating.toFixed(1)} / 5 · ${book.reviews.rating_count}명 평가`}</p>}
        {reviewError && <p role="alert">후기를 불러오지 못했습니다.<span className="result-note"> {reviewError}</span></p>}
        {reviews === null && !reviewError && <p role="status">후기를 불러오는 중…</p>}
        {reviews?.length === 0 && <p className="result-note">아직 공개된 후기가 없습니다.</p>}
        <ul className="public-reviews">
          {reviews?.map((review) => <li key={review.id}>
            <div className="review-heading"><strong>{review.author_name}{review.is_mine && ' · 나'}</strong>{review.rating !== null && <span>★ {review.rating} / 5</span>}</div>
            {review.memo !== null && <p className="review-memo">{review.memo}</p>}
            <div className="review-heading result-note"><time dateTime={review.published_at}>{formatKstDate(review.published_at)} 작성</time>{review.updated_at !== review.published_at && <time dateTime={review.updated_at}>{formatKstDate(review.updated_at)} 수정</time>}{review.is_mine && <Link to={`/books/${review.id}`}>후기 수정</Link>}</div>
          </li>)}
        </ul>
        {hasMore && <button type="button" className="secondary" disabled={moreBusy} onClick={() => void loadMore()}>{moreBusy ? '불러오는 중…' : '후기 더 보기'}</button>}
        <p className="result-note">계정에서 공개를 허용한 후기와 별점만 보입니다.</p>
      </section>
    </section>
  )
}
