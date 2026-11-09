import { afterEach, expect, test, vi } from 'vitest'
import { getLibraryBookByIsbn } from './api'
import { getCatalogBook, getPublicReviews } from './catalog'

const book = {
  isbn13: '9788936433598', title: '채식주의자', authors: ['한강'],
  publisher: null, published_date: null, thumbnail_url: null, description: null,
  source_url: 'https://example.test/book', page_count: null,
  reviews: { total_reviews: 0, rating_count: 0, average_rating: null },
}
const review = {
  id: 'review-1', author_name: '독서가', memo: '공개한 메모', rating: null,
  published_at: '2026-11-02T00:00:00Z', updated_at: '2026-11-02T00:00:00Z', is_mine: false,
}

const ownBook = {
  ...book, id: 'own-1', book_id: 'book-1', status: 'reading', created_at: '2026-11-02T00:00:00Z',
  total_pages: null, current_page: null, progress_percent: null,
  started_at: null, last_read_at: null, last_read_date: null, past_log_range: null, completed_at: null, stopped_at: null, stop_reason: null,
  memo: '개인 메모', rating: null, has_completed: false, updated_at: '2026-11-02T00:00:00Z',
  allowed_statuses: ['reading'], is_review_public: false, review_published_at: null, review_updated_at: null, shelves: [],
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

function respond(body: unknown, status = 200) {
  const fetch = vi.fn().mockResolvedValue(Response.json(body, { status }))
  vi.stubGlobal('fetch', fetch)
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')
  return fetch
}

test('공통 책 정보는 인증 없이 조회하고 빈 평가와 null 정보를 유지한다', async () => {
  const fetch = respond(book)
  await expect(getCatalogBook(book.isbn13)).resolves.toEqual(book)
  expect(fetch).toHaveBeenCalledWith(`https://api.example.test/books/${book.isbn13}`, {
    headers: {}, signal: expect.any(AbortSignal),
  })
})

test.each([
  { ...book, isbn13: '9788936434120' },
  { ...book, reviews: { total_reviews: 1, rating_count: 0, average_rating: 0 } },
  { ...book, reviews: { total_reviews: 0, rating_count: 1, average_rating: 4 } },
])('잘못된 도서·평가 응답은 거부한다: %j', async (body) => {
  respond(body)
  await expect(getCatalogBook(book.isbn13)).rejects.toThrow('책 정보 응답 형식이 올바르지 않습니다.')
})

test('공개 후기의 페이지 조건과 현재 토큰을 전달한다', async () => {
  const fetch = respond([review])
  await expect(getPublicReviews('test-token', book.isbn13, 20, 40)).resolves.toEqual([review])
  expect(fetch).toHaveBeenCalledWith(`https://api.example.test/books/${book.isbn13}/reviews?limit=20&offset=40`, {
    headers: { Authorization: 'Bearer test-token' }, signal: expect.any(AbortSignal),
  })
})

test.each([{ ...review, is_mine: 'false' }, { ...review, memo: '' }, { ...review, rating: 0 }])(
  '불완전한 후기를 표시하지 않는다: %j', async (body) => {
    respond([body])
    await expect(getPublicReviews('test-token', book.isbn13, 20, 0)).rejects.toThrow('후기 응답 형식이 올바르지 않습니다.')
  },
)

test('ISBN 개인 조회의 404만 미등록으로 처리한다', async () => {
  respond({ detail: 'Library book not found' }, 404)
  await expect(getLibraryBookByIsbn('test-token', book.isbn13)).resolves.toBeNull()
})

test('ISBN 개인 조회에서 공개 설정을 포함한 전체 상세를 검증한다', async () => {
  const fetch = respond(ownBook)
  await expect(getLibraryBookByIsbn('test-token', book.isbn13)).resolves.toEqual(ownBook)
  expect(fetch.mock.calls[0][0]).toBe(`https://api.example.test/library/books/by-isbn/${book.isbn13}`)
})

test.each([
  { ...ownBook, is_review_public: undefined },
  { ...ownBook, review_published_at: undefined },
  { ...ownBook, review_updated_at: '잘못된 날짜' },
  { ...ownBook, is_review_public: null },
  { ...ownBook, isbn13: '9788936434120' },
  { ...ownBook, last_read_date: undefined },
  { ...ownBook, last_read_date: '2026-11-03T00:00:00Z' },
])('잘못된 개인 공개 설정이나 다른 책을 비공개 기본값으로 바꾸지 않는다: %j', async (body) => {
  respond(body)
  await expect(getLibraryBookByIsbn('test-token', book.isbn13)).rejects.toThrow('책 상세 응답 형식이 올바르지 않습니다.')
})

test.each([401, 503])('개인 조회 %i 실패는 미등록으로 바꾸지 않는다', async (status) => {
  respond({ detail: 'unavailable' }, status)
  await expect(getLibraryBookByIsbn('test-token', book.isbn13)).rejects.toMatchObject({ status })
})
