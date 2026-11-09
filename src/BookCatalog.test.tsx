// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError } from './lib/api'
import BookCatalog from './BookCatalog'

const mocks = vi.hoisted(() => ({ getCatalogBook: vi.fn(), getPublicReviews: vi.fn(), getLibraryBookByIsbn: vi.fn(), addLibraryBook: vi.fn() }))
vi.mock('./lib/catalog', () => ({ getCatalogBook: mocks.getCatalogBook, getPublicReviews: mocks.getPublicReviews }))
vi.mock('./lib/api', async (original) => ({ ...await original<typeof import('./lib/api')>(), getLibraryBookByIsbn: mocks.getLibraryBookByIsbn, addLibraryBook: mocks.addLibraryBook }))
vi.mock('./lib/supabase', () => ({ supabase: { auth: {} } }))
vi.mock('./lib/auth', async (original) => ({ ...await original<typeof import('./lib/auth')>(), withAccessToken: (request: (token: string) => Promise<unknown>) => request('test-token') }))

const isbn = '9788936433598'
const book = { isbn13: isbn, title: '채식주의자', authors: ['한강'], publisher: null, published_date: '2007-10-30', thumbnail_url: null, description: null, source_url: 'https://example.test/book', page_count: null, reviews: { total_reviews: 0, rating_count: 0, average_rating: null } }
const review = { id: 'review-1', author_name: '독서가', memo: '다시 읽고 싶은 책', rating: null, published_at: '2026-11-02T00:00:00Z', updated_at: '2026-11-02T00:00:00Z', is_mine: false }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getCatalogBook.mockResolvedValue(book)
  mocks.getPublicReviews.mockResolvedValue([])
  mocks.getLibraryBookByIsbn.mockResolvedValue(null)
})
afterEach(cleanup)
function open() {
  render(<MemoryRouter initialEntries={[`/catalog/${isbn}`]}><Routes>
    <Route path="/catalog/:isbn13" element={<BookCatalog />} />
    <Route path="/books/:userBookId" element={<p>내 기록 편집</p>} />
  </Routes></MemoryRouter>)
}

test('빈 후기와 별점 미평가를 구분하고, 내 기록이 없을 때만 담기를 제공한다', async () => {
  open()
  await screen.findByRole('heading', { name: '채식주의자' })
  expect(screen.getByText('아직 평가 없음')).toBeDefined()
  expect(await screen.findByText('아직 공개된 후기가 없습니다.')).toBeDefined()
  expect(screen.getByRole('button', { name: '서재에 담기' })).toBeDefined()
  expect(screen.getByText('책 소개가 제공되지 않았습니다.')).toBeDefined()
})

test('개인 조회 실패를 미등록으로 처리하지 않고 재시도한다', async () => {
  mocks.getLibraryBookByIsbn.mockRejectedValueOnce(new ApiError(503))
  open()
  await screen.findByText('내 서재 정보를 확인하지 못했습니다.')
  expect(screen.queryByRole('button', { name: '서재에 담기' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
  await screen.findByRole('button', { name: '서재에 담기' })
})

test('후기 오류가 내 기록을 가리지 않고, 개인 메모는 별도 영역에 표시한다', async () => {
  mocks.getPublicReviews.mockRejectedValue(new ApiError(503))
  mocks.getLibraryBookByIsbn.mockResolvedValue({ id: 'own-1', status: 'reading', memo: '비공개 메모', rating: 4, is_review_public: false })
  open()
  expect(await screen.findByText('비공개 메모')).toBeDefined()
  expect(screen.getByText('비공개')).toBeDefined()
  expect(screen.getByRole('link', { name: '내 기록 수정' }).getAttribute('href')).toBe('/books/own-1')
  expect(screen.queryByRole('button', { name: '서재에 담기' })).toBeNull()
  expect(screen.queryByText('아직 공개된 후기가 없습니다.')).toBeNull()
})

test('더 보기 실패 시 기존 후기를 유지하고 같은 offset으로 재시도한다', async () => {
  const first = Array.from({ length: 20 }, (_, index) => ({ ...review, id: `r-${index}`, memo: `후기 ${index}` }))
  mocks.getPublicReviews.mockResolvedValueOnce(first).mockRejectedValueOnce(new ApiError(503)).mockResolvedValueOnce([{ ...review, id: 'last', memo: '마지막 후기', is_mine: true }])
  open()
  await screen.findByText('후기 0')
  fireEvent.click(screen.getByRole('button', { name: '후기 더 보기' }))
  await screen.findByText('후기를 불러오지 못했습니다.')
  expect(screen.getByText('후기 19')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: '후기 더 보기' }))
  await screen.findByText('마지막 후기')
  expect(mocks.getPublicReviews.mock.calls.map((args) => args[3])).toEqual([0, 20, 20])
  expect(screen.queryByRole('button', { name: '후기 더 보기' })).toBeNull()
})

test('담기 중 중복 클릭을 막고 성공 뒤 개인 정보를 다시 조회한다', async () => {
  let finish!: (value: unknown) => void
  mocks.addLibraryBook.mockReturnValue(new Promise((resolve) => { finish = resolve }))
  open()
  const button = await screen.findByRole('button', { name: '서재에 담기' })
  fireEvent.click(button); fireEvent.click(button)
  expect(mocks.addLibraryBook).toHaveBeenCalledTimes(1)
  mocks.getLibraryBookByIsbn.mockResolvedValue({ id: 'new-1', status: 'want_to_read', memo: null, rating: null, is_review_public: false })
  await act(async () => finish({ id: 'new-1', created: true, status: 'want_to_read' }))
  await screen.findByRole('link', { name: '내 기록 수정' })
  expect(mocks.getLibraryBookByIsbn).toHaveBeenCalledTimes(2)
})

test('담기 시간 초과에는 자동 재전송 없이 서버를 재조회한다', async () => {
  mocks.addLibraryBook.mockRejectedValue(new DOMException('timeout', 'TimeoutError'))
  open()
  fireEvent.click(await screen.findByRole('button', { name: '서재에 담기' }))
  await waitFor(() => expect(mocks.getLibraryBookByIsbn).toHaveBeenCalledTimes(2))
  expect(mocks.addLibraryBook).toHaveBeenCalledTimes(1)
  expect(screen.getByText(/등록 결과를 확인하지 못했습니다/)).toBeDefined()
})

test('책을 바꾼 뒤 도착한 이전 책의 개인 메모를 표시하지 않는다', async () => {
  let finish!: (value: unknown) => void
  mocks.getLibraryBookByIsbn.mockReturnValueOnce(new Promise((resolve) => { finish = resolve })).mockResolvedValueOnce(null)
  mocks.getCatalogBook.mockResolvedValueOnce(book).mockResolvedValueOnce({ ...book, title: '다음 책', isbn13: '9788936434120' })
  render(<MemoryRouter initialEntries={[`/catalog/${isbn}`]}>
    <Link to="/catalog/9788936434120">다른 책</Link>
    <Routes><Route path="/catalog/:isbn13" element={<BookCatalog />} /></Routes>
  </MemoryRouter>)
  await screen.findByRole('heading', { name: '채식주의자' })
  fireEvent.click(screen.getByRole('link', { name: '다른 책' }))
  await screen.findByRole('heading', { name: '다음 책' })
  await act(async () => finish({ id: 'old-1', status: 'reading', memo: '이전 책 개인 메모', rating: null, is_review_public: false }))
  expect(screen.queryByText('이전 책 개인 메모')).toBeNull()
})

test('새로 불러온 뒤 도착한 이전 페이지의 후기를 버린다', async () => {
  let finish!: (value: unknown) => void
  mocks.getPublicReviews.mockResolvedValueOnce(Array.from({ length: 20 }, (_, index) => ({ ...review, id: `r-${index}` })))
    .mockReturnValueOnce(new Promise((resolve) => { finish = resolve })).mockResolvedValueOnce([])
  open()
  fireEvent.click(await screen.findByRole('button', { name: '후기 더 보기' }))
  fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
  await screen.findByText('아직 공개된 후기가 없습니다.')
  await act(async () => finish([{ ...review, id: 'stale', memo: '늦은 후기' }]))
  expect(screen.queryByText('늦은 후기')).toBeNull()
})

test('공개 책 정보는 국립중앙도서관 쪽수가 있을 때만 쪽수를 보여 준다', async () => {
  open()
  expect((await screen.findByText(/2007-10-30/)).textContent).toBe('2007-10-30')
  cleanup()
  mocks.getCatalogBook.mockResolvedValue({ ...book, page_count: 247 })
  open()
  expect((await screen.findByText(/247쪽/)).textContent).toBe('2007-10-30 · 247쪽')
})
