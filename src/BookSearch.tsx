import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { SubmitEvent } from 'react'
import { Link } from 'react-router'
import { addLibraryBook, ApiError, SEARCH_LAST_PAGE, searchBooks, statusLabels } from './lib/api'
import type { SearchBook, SearchOptions, SearchSort, SearchTarget } from './lib/api'
import { withAccessToken } from './lib/auth'
import { ADD_RATE_LIMITED, codeMessage, commonErrorMessage, isAuthFailure, isTimeout, RELOGIN_MESSAGE } from './lib/errors'
import PopularBooks from './PopularBooks'

// ISBN13이 없는 책은 담을 수 없어 결과에서 뺀다.
type AddableBook = SearchBook & { isbn13: string }
const isAddable = (book: SearchBook): book is AddableBook => book.isbn13 !== null
const targetLabels: Record<SearchTarget, string> = { title: '제목', person: '저자', publisher: '출판사' }

type SaveState = { phase: 'saving' | 'saved' | 'error'; message: string }

// 429는 Retry-After(없으면 60초) 동안 검색·더 보기를 막는다. 자동으로 다시 보내지 않는다.
const retrySeconds = (error: ApiError) => Math.max(1, Math.ceil(error.retryAfter ?? 60))
// 화면을 나갔다 돌아와도 차단이 이어지도록 모듈 범위에 둔다(한도는 접속 IP 기준이라 계정과 무관).
let searchBlockedUntil = 0
const searchBlockListeners = new Set<() => void>()
const getSearchBlockedUntil = () => searchBlockedUntil
function subscribeSearchBlock(listener: () => void) {
  searchBlockListeners.add(listener)
  return () => { searchBlockListeners.delete(listener) }
}
function setSearchBlockedUntil(until: number) {
  searchBlockedUntil = until
  searchBlockListeners.forEach((listener) => listener())
}

function searchErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 429) return `검색 요청이 많습니다. ${retrySeconds(error)}초 뒤에 다시 시도해주세요.`
    if (error.status === 422 && !codeMessage(error)) return '검색어를 확인해주세요. (1~200자)'
    if (error.status === 502) return '책 정보 제공처에서 오류가 발생했습니다. 잠시 후 다시 검색해주세요.'
    if (error.status === 504) return '책 정보 제공처의 응답이 늦습니다. 잠시 후 다시 검색해주세요.'
  }
  return commonErrorMessage(error, '검색에 실패했습니다')
}

function saveErrorMessage(error: unknown) {
  if (isAuthFailure(error)) return RELOGIN_MESSAGE
  // 요청이 서버에 닿았는지 알 수 없으므로 자동으로 다시 보내지 않는다.
  if (error instanceof TypeError || isTimeout(error)) {
    return '저장 결과를 확인하지 못했습니다. 서재에서 담겼는지 확인해주세요.'
  }
  if (error instanceof ApiError) {
    if (error.status === 429) return ADD_RATE_LIMITED
    if (error.status === 404) return '책 정보를 찾지 못해 담지 못했습니다.'
    if (error.status === 422) return 'ISBN 형식이 올바르지 않아 담지 못했습니다.'
    if (error.status === 502 || error.status === 504) {
      return '책 정보 제공처 문제로 담지 못했을 수 있습니다. 서재에서 확인한 뒤 다시 시도해주세요.'
    }
  }
  return commonErrorMessage(error, '서재에 담지 못했습니다')
}

export default function BookSearch() {
  const [results, setResults] = useState<AddableBook[] | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saves, setSaves] = useState<Record<string, SaveState>>({})
  const [options, setOptions] = useState<SearchOptions>({})
  // 더 보기는 입력 중인 값 대신 마지막 요청의 검색어·조건을 이어 쓴다.
  const [paging, setPaging] = useState<{ query: string; options: SearchOptions; page: number; isEnd: boolean } | null>(null)
  const lastQuery = useRef('')
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState<string | null>(null)
  const blockedUntil = useSyncExternalStore(subscribeSearchBlock, getSearchBlockedUntil)
  const coolingDown = blockedUntil > 0
  const searchVersion = useRef(0)

  // 차단이 끝나면 429 안내도 지운다. 차단 중에는 다른 검색 오류가 생기지 않는다.
  useEffect(() => {
    if (!blockedUntil) return
    const timer = setTimeout(() => {
      if (searchBlockedUntil !== blockedUntil) return
      setSearchBlockedUntil(0)
      setError(null)
      setMoreError(null)
    }, Math.max(0, blockedUntil - Date.now()))
    return () => clearTimeout(timer)
  }, [blockedUntil])

  function startCooldown(error: unknown) {
    if (!(error instanceof ApiError) || error.status !== 429) return
    setSearchBlockedUntil(Date.now() + retrySeconds(error) * 1000)
  }

  async function handleSearch(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = new FormData(event.currentTarget).get('query')
    await runSearch(typeof query === 'string' ? query : '', options)
  }

  async function runSearch(query: string, searchOptions: SearchOptions) {
    if (!query.trim()) {
      setError('검색어를 입력해주세요.')
      return
    }
    if (query.trim().length > 200) {
      setError('검색어는 200자 이하로 입력해주세요.')
      return
    }

    if (coolingDown) return
    setHasSearched(true)
    lastQuery.current = query.trim()
    // 새 검색을 보내면 이전 검색·더 보기의 늦은 응답은 버린다.
    const version = ++searchVersion.current
    setSearching(true)
    setLoadingMore(false)
    setError(null)
    setMoreError(null)
    try {
      const { books, isEnd } = await searchBooks(query.trim(), 1, searchOptions)
      if (version !== searchVersion.current) return
      const addable = books.filter(isAddable)
      setResults(addable)
      setPaging({ query: query.trim(), options: searchOptions, page: 1, isEnd })
    } catch (searchError) {
      if (version !== searchVersion.current) return
      setResults(null)
      setError(searchErrorMessage(searchError))
      startCooldown(searchError)
    } finally {
      if (version === searchVersion.current) setSearching(false)
    }
  }

  function changeOptions(target?: SearchTarget, sort?: SearchSort) {
    if (coolingDown) return
    const next: SearchOptions = { ...(target && { target }), ...(sort && sort !== 'accuracy' && { sort }) }
    setOptions(next)
    if (lastQuery.current) void runSearch(lastQuery.current, next)
  }

  async function handleMore() {
    // 새 검색 응답 전에는 paging이 이전 검색어라 더 보기를 막는다.
    if (!paging || paging.isEnd || paging.page >= SEARCH_LAST_PAGE || searching || loadingMore || coolingDown) return
    const version = searchVersion.current
    const nextPage = paging.page + 1
    setLoadingMore(true)
    setMoreError(null)
    try {
      const { books, isEnd } = await searchBooks(paging.query, nextPage, paging.options)
      if (version !== searchVersion.current) return
      const addable = books.filter(isAddable)
      setResults((current) => [...(current ?? []), ...addable])
      setPaging({ ...paging, page: nextPage, isEnd })
    } catch (moreLoadError) {
      if (version !== searchVersion.current) return
      // 이미 보이는 결과는 그대로 두고 더 보기만 다시 시도하게 한다.
      setMoreError(searchErrorMessage(moreLoadError))
      startCooldown(moreLoadError)
    } finally {
      if (version === searchVersion.current) setLoadingMore(false)
    }
  }

  async function handleAdd(isbn13: string) {
    if (saves[isbn13]?.phase === 'saving') return
    setSaves((current) => ({
      ...current,
      [isbn13]: { phase: 'saving', message: '담는 중…' },
    }))
    try {
      const saved = await withAccessToken((token) => addLibraryBook(token, isbn13))
      // 새로 담으면 201, 이미 있던 책이면 200과 기존 기록이 온다.
      const message = saved.created
        ? '서재에 담았습니다.'
        : `이미 서재에 있는 책입니다. (${statusLabels[saved.status]})`
      setSaves((current) => ({ ...current, [isbn13]: { phase: 'saved', message } }))
    } catch (saveError) {
      setSaves((current) => ({
        ...current,
        [isbn13]: { phase: 'error', message: saveErrorMessage(saveError) },
      }))
    }
  }

  return (
    <section className="search" aria-labelledby="search-title">
      <h1 id="search-title">책 찾기</h1>
      <p className="library-sub">숲길에서 만난 책을 오두막 책장에 담아 보세요</p>

      <form className="search-form" role="search" onSubmit={handleSearch}>
        <label htmlFor="search-target" className="visually-hidden">검색 기준</label>
        <select id="search-target" value={options.target ?? ''} disabled={coolingDown}
          onChange={(event) => changeOptions((event.target.value || undefined) as SearchTarget | undefined, options.sort)}>
          <option value="">전체</option>
          <option value="title">제목</option>
          <option value="person">저자</option>
          <option value="publisher">출판사</option>
        </select>
        <label htmlFor="search-query" className="visually-hidden">
          책 제목, 저자, 출판사 또는 ISBN
        </label>
        <input
          id="search-query"
          name="query"
          type="search"
          maxLength={200}
          enterKeyHint="search"
          autoComplete="off"
        />
        <button type="submit" disabled={searching || coolingDown}>
          {searching ? '찾는 중…' : '검색'}
        </button>
      </form>
      {!hasSearched && <PopularBooks />}
      {results !== null && paging && <div className="search-summary">
        <p className="result-note" aria-live="polite">
          ‘{paging.query}’ · {paging.options.target ? targetLabels[paging.options.target] : '전체'}
        </p>
        <label htmlFor="search-sort" className="visually-hidden">검색 결과 정렬</label>
        <select id="search-sort" value={options.sort ?? 'accuracy'} disabled={coolingDown}
          onChange={(event) => changeOptions(options.target, event.target.value as SearchSort)}>
          <option value="accuracy">정확도순</option>
          <option value="latest">출간일 최신순</option>
        </select>
      </div>}

      {error && (
        <p className="library-note" role="alert">{error}</p>
      )}
      {coolingDown && !error && !moreError && (
        <p className="library-note" role="status">검색 요청이 많아 잠시 뒤에 다시 검색할 수 있어요.</p>
      )}

      {results !== null && results.length === 0 && <p className="library-note">
        {paging && !paging.isEnd && paging.page < SEARCH_LAST_PAGE
          ? '이 페이지에는 표시할 책이 없어요. 더 보기를 눌러 주세요.'
          : '검색 결과가 없습니다.'}
      </p>}

      {results !== null && results.length > 0 && (
        <ul className="results" aria-busy={searching}>
          {results.map((book, index) => {
            const save = saves[book.isbn13]
            return (
              <li key={`${book.isbn13}-${index}`} className="result">
                {book.thumbnail ? (
                  <img
                    className="result-cover"
                    src={book.thumbnail}
                    alt=""
                    width={120}
                    height={174}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="result-cover cover-empty" aria-hidden="true">
                    {book.title.slice(0, 1) || '?'}
                  </div>
                )}
                <div className="result-body">
                  <p className="book-title"><Link to={`/catalog/${book.isbn13}`}>{book.title || '제목 정보 없음'}</Link></p>
                  <p className="book-authors">
                    {[book.authors.join(', '), book.publisher].filter(Boolean).join(' · ') ||
                      '저자 정보 없음'}
                  </p>
                    <button
                      type="button"
                      className="secondary compact"
                      onClick={() => void handleAdd(book.isbn13)}
                      disabled={save?.phase === 'saving' || save?.phase === 'saved'}
                    >
                      {save?.phase === 'saving'
                        ? '담는 중…'
                        : save?.phase === 'saved'
                          ? '담김'
                          : '서재에 담기'}
                    </button>
                  {save && save.phase !== 'saving' && (
                    <p
                      className={`result-note ${save.phase === 'error' ? 'is-error' : ''}`}
                      role="status"
                    >
                      {save.message}
                      {save.phase === 'saved' && (
                        <>
                          {' '}
                          <Link to="/">서재로 가기</Link>
                        </>
                      )}
                    </p>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {moreError && <p className="library-note" role="alert">{moreError}</p>}

      {results !== null && paging && !paging.isEnd && paging.page < SEARCH_LAST_PAGE && (
        <button type="button" className="secondary more" onClick={() => void handleMore()} disabled={loadingMore || searching || coolingDown}>
          {loadingMore ? '불러오는 중…' : '결과 더 보기'}
        </button>
      )}
    </section>
  )
}
