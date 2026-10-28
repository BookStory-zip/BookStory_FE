import { useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import { Link } from 'react-router'
import { addLibraryBook, ApiError, searchBooks, statusLabels } from './lib/api'
import type { SearchBook } from './lib/api'
import { withAccessToken } from './lib/auth'
import { commonErrorMessage, isAuthFailure, isTimeout, RELOGIN_MESSAGE } from './lib/errors'

type SaveState = { phase: 'saving' | 'saved' | 'error'; message: string }

function searchErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 422) return '검색어를 확인해주세요. (1~200자)'
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
    if (error.status === 404) return '책 정보를 찾지 못해 담지 못했습니다.'
    if (error.status === 422) return 'ISBN 형식이 올바르지 않아 담지 못했습니다.'
    if (error.status === 502 || error.status === 504) {
      return '책 정보 제공처 문제로 담지 못했을 수 있습니다. 서재에서 확인한 뒤 다시 시도해주세요.'
    }
  }
  return commonErrorMessage(error, '서재에 담지 못했습니다')
}

export default function BookSearch() {
  const [results, setResults] = useState<SearchBook[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saves, setSaves] = useState<Record<string, SaveState>>({})
  const searchVersion = useRef(0)

  async function handleSearch(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = new FormData(event.currentTarget).get('query')

    if (typeof query !== 'string' || !query.trim()) {
      setError('검색어를 입력해주세요.')
      return
    }
    if (query.trim().length > 200) {
      setError('검색어는 200자 이하로 입력해주세요.')
      return
    }

    // 새 검색을 보내면 이전 검색의 늦은 응답은 버린다.
    const version = ++searchVersion.current
    setSearching(true)
    setError(null)
    try {
      const books = await searchBooks(query.trim())
      if (version !== searchVersion.current) return
      setResults(books)
    } catch (searchError) {
      if (version !== searchVersion.current) return
      setResults(null)
      setError(searchErrorMessage(searchError))
    } finally {
      if (version === searchVersion.current) setSearching(false)
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
      // 이미 담은 책이면 서버가 기존 기록을 그대로 돌려준다.
      const message =
        saved.status === 'want_to_read'
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
        <label htmlFor="search-query" className="visually-hidden">
          책 제목, 저자 또는 ISBN
        </label>
        <input
          id="search-query"
          name="query"
          type="search"
          placeholder="책 제목, 저자 또는 ISBN"
          maxLength={200}
          enterKeyHint="search"
          autoComplete="off"
        />
        <button type="submit" disabled={searching}>
          {searching ? '찾는 중…' : '검색'}
        </button>
      </form>

      {error && (
        <p className="library-note" role="alert">{error}</p>
      )}

      {results !== null && results.length === 0 && (
        <p className="library-note">검색 결과가 없습니다. 다른 검색어로 찾아보세요.</p>
      )}

      {results !== null && results.length > 0 && (
        <ul className="results" aria-busy={searching}>
          {results.map((book, index) => {
            const save = book.isbn13 ? saves[book.isbn13] : undefined
            return (
              <li key={`${book.isbn13 ?? 'no-isbn'}-${index}`} className="result">
                {book.thumbnail ? (
                  <img
                    className="result-cover"
                    src={book.thumbnail}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="result-cover cover-empty" aria-hidden="true">
                    {book.title.slice(0, 1) || '?'}
                  </div>
                )}
                <div className="result-body">
                  <p className="book-title">{book.title || '제목 정보 없음'}</p>
                  <p className="book-authors">
                    {[book.authors.join(', '), book.publisher].filter(Boolean).join(' · ') ||
                      '저자 정보 없음'}
                  </p>
                  {book.isbn13 ? (
                    <button
                      type="button"
                      className="secondary compact"
                      onClick={() => void handleAdd(book.isbn13!)}
                      disabled={save?.phase === 'saving' || save?.phase === 'saved'}
                    >
                      {save?.phase === 'saving'
                        ? '담는 중…'
                        : save?.phase === 'saved'
                          ? '담김'
                          : '서재에 담기'}
                    </button>
                  ) : (
                    <p className="result-note">
                      13자리 ISBN이 없어 서재에 담을 수 없습니다.
                    </p>
                  )}
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
    </section>
  )
}
