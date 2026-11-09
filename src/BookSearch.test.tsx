// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError } from './lib/api'
import type { SearchBook } from './lib/api'
import BookSearch from './BookSearch'

const mocks = vi.hoisted(() => ({
  searchBooks: vi.fn(),
  addLibraryBook: vi.fn(),
}))

vi.mock('./lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/api')>(),
  searchBooks: mocks.searchBooks,
  addLibraryBook: mocks.addLibraryBook,
}))
// 환경변수 없는 CI에서도 실제 Supabase 클라이언트를 만들지 않는다.
vi.mock('./lib/supabase', () => ({ supabase: { auth: {} } }))
vi.mock('./lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/auth')>(),
  withAccessToken: (request: (token: string) => Promise<unknown>) => request('test-token'),
}))

function book(title: string, isbn13: string | null): SearchBook {
  return { title, authors: ['저자'], publisher: '출판사', thumbnail: null, isbn13 }
}

function search(query: string) {
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } })
  fireEvent.submit(screen.getByRole('search'))
}

beforeEach(() => {
  vi.resetAllMocks()
  render(<MemoryRouter><BookSearch /></MemoryRouter>)
})
afterEach(cleanup)

test('검색 기준은 검색바에서 고르고, 정렬은 결과가 나온 뒤 결과 위에서 고르며 더 보기에도 유지한다', async () => {
  mocks.searchBooks.mockResolvedValueOnce({ books: [book('첫 결과', '9788936433598')], isEnd: false })
    .mockResolvedValueOnce({ books: [book('최신 결과', '9788936433598')], isEnd: false })
    .mockResolvedValueOnce({ books: [book('다음 결과', '9788936434120')], isEnd: true })
  expect(screen.getByRole('searchbox').getAttribute('placeholder')).toBeNull()
  expect(screen.queryByLabelText('검색 결과 정렬')).toBeNull()
  fireEvent.change(screen.getByLabelText('검색 기준'), { target: { value: 'person' } })
  expect(mocks.searchBooks).not.toHaveBeenCalled()
  search('  한강  ')
  await screen.findByText('첫 결과')
  expect(mocks.searchBooks).toHaveBeenLastCalledWith('한강', 1, { target: 'person' })
  const sort = screen.getByLabelText('검색 결과 정렬')
  expect(sort.compareDocumentPosition(screen.getByRole('list')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  fireEvent.change(sort, { target: { value: 'latest' } })
  await screen.findByText('최신 결과')
  expect(mocks.searchBooks).toHaveBeenLastCalledWith('한강', 1, { target: 'person', sort: 'latest' })
  fireEvent.click(screen.getByRole('button', { name: '결과 더 보기' }))
  await screen.findByText('다음 결과')
  expect(mocks.searchBooks).toHaveBeenLastCalledWith('한강', 2, { target: 'person', sort: 'latest' })
})

test('기준·정렬 변경은 마지막 검색어로 첫 페이지부터 다시 조회하며 전체·정확도순으로 복구할 수 있다', async () => {
  mocks.searchBooks.mockResolvedValueOnce({ books: [book('이전 결과', '9788936433598')], isEnd: false })
    .mockResolvedValueOnce({ books: [book('저자 결과', '9788936434120')], isEnd: false })
    .mockResolvedValueOnce({ books: [book('최신 결과', '9788936434120')], isEnd: true })
    .mockResolvedValueOnce({ books: [book('전체 최신 결과', '9788936434120')], isEnd: true })
    .mockResolvedValueOnce({ books: [book('기본 결과', '9788936434120')], isEnd: true })
  search('한강')
  await screen.findByText('이전 결과')
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '아직 제출하지 않은 검색어' } })
  fireEvent.change(screen.getByLabelText('검색 기준'), { target: { value: 'person' } })
  await screen.findByText('저자 결과')
  expect(mocks.searchBooks).toHaveBeenLastCalledWith('한강', 1, { target: 'person' })
  expect(screen.queryByText('이전 결과')).toBeNull()
  fireEvent.change(screen.getByLabelText('검색 결과 정렬'), { target: { value: 'latest' } })
  await screen.findByText('최신 결과')
  expect(mocks.searchBooks).toHaveBeenLastCalledWith('한강', 1, { target: 'person', sort: 'latest' })
  expect(screen.getByText('‘한강’ · 저자')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('검색 기준'), { target: { value: '' } })
  await screen.findByText('전체 최신 결과')
  expect(mocks.searchBooks).toHaveBeenLastCalledWith('한강', 1, { sort: 'latest' })
  fireEvent.change(screen.getByLabelText('검색 결과 정렬'), { target: { value: 'accuracy' } })
  await screen.findByText('기본 결과')
  expect(mocks.searchBooks).toHaveBeenLastCalledWith('한강', 1, {})
})

test('첫 검색 중 기준을 바꾸면 이전 기준의 늦은 결과를 버린다', async () => {
  let finishOld!: (result: { books: SearchBook[]; isEnd: boolean }) => void
  mocks.searchBooks.mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve }))
    .mockResolvedValueOnce({ books: [book('출판사 결과', '9788936434120')], isEnd: true })
  search('창비')
  fireEvent.change(screen.getByLabelText('검색 기준'), { target: { value: 'publisher' } })
  await screen.findByText('출판사 결과')
  await act(async () => finishOld({ books: [book('늦은 전체 결과', '9788936433598')], isEnd: true }))
  expect(screen.queryByText('늦은 전체 결과')).toBeNull()
  expect(mocks.searchBooks).toHaveBeenLastCalledWith('창비', 1, { target: 'publisher' })
})

test('기준을 바꾸면 누적 결과와 숨긴 권수를 초기화하고 이전 더 보기 응답을 버린다', async () => {
  let finishMore!: (result: { books: SearchBook[]; isEnd: boolean }) => void
  mocks.searchBooks.mockResolvedValueOnce({ books: [book('처음 책', '9788936433598'), book('상품', null)], isEnd: false })
    .mockReturnValueOnce(new Promise((resolve) => { finishMore = resolve }))
    .mockResolvedValueOnce({ books: [book('새 조건 책', '9788936434120')], isEnd: true })
  search('책')
  fireEvent.click(await screen.findByRole('button', { name: '결과 더 보기' }))
  fireEvent.change(screen.getByLabelText('검색 기준'), { target: { value: 'title' } })
  await screen.findByText('새 조건 책')
  await act(async () => finishMore({ books: [book('늦은 다음 책', '9788936433598'), book('상품', null)], isEnd: true }))
  expect(screen.queryByText('처음 책')).toBeNull()
  expect(screen.queryByText('늦은 다음 책')).toBeNull()
  expect(screen.queryByText(/표시하지 않았어요/)).toBeNull()
  expect(screen.queryByRole('button', { name: '결과 더 보기' })).toBeNull()
})

test('검색 429는 Retry-After 동안 다시 검색·더 보기를 막고 자동으로 다시 보내지 않는다', async () => {
  mocks.searchBooks.mockRejectedValueOnce(new ApiError(429, 'Too many requests', 'rate_limited', 1))
  search('소년이 온다')
  expect((await screen.findByRole('alert')).textContent).toBe('검색 요청이 많습니다. 1초 뒤에 다시 시도해주세요.')
  const button = screen.getByRole('button', { name: '검색' })
  expect(button).toHaveProperty('disabled', true)
  expect(screen.getByLabelText('검색 기준')).toHaveProperty('disabled', true)
  search('소년이 온다')
  expect(mocks.searchBooks).toHaveBeenCalledTimes(1)
  // 화면을 떠났다 돌아와도 남은 시간 동안 막는다.
  cleanup()
  render(<MemoryRouter><BookSearch /></MemoryRouter>)
  expect(screen.getByRole('button', { name: '검색' })).toHaveProperty('disabled', true)
  expect(screen.getByText('검색 요청이 많아 잠시 뒤에 다시 검색할 수 있어요.')).toBeTruthy()
  await waitFor(() => expect(screen.getByRole('button', { name: '검색' })).toHaveProperty('disabled', false), { timeout: 2000 })
  expect(screen.queryByText(/검색 요청이 많/)).toBeNull()
  expect(mocks.searchBooks).toHaveBeenCalledTimes(1)
})

test('담기 429는 저장되지 않았다고 안내한다', async () => {
  mocks.searchBooks.mockResolvedValue({ books: [book('소년이 온다', '9788936434120')], isEnd: true })
  mocks.addLibraryBook.mockRejectedValue(new ApiError(429, 'Too many requests', 'rate_limited', 30))
  search('소년이 온다')
  fireEvent.click(await screen.findByRole('button', { name: '서재에 담기' }))
  expect(await screen.findByText('요청이 많아 서재에 담지 못했습니다. 잠시 후 다시 시도해주세요.')).toBeTruthy()
})

test('검색 화면에 재진입한 뒤 이전 요청의 429가 도착해도 현재 검색을 막는다', async () => {
  let rejectSearch!: (error: unknown) => void
  mocks.searchBooks.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectSearch = reject }))
  search('소년이 온다')
  cleanup()
  render(<MemoryRouter><BookSearch /></MemoryRouter>)

  await act(async () => rejectSearch(new ApiError(429, undefined, 'rate_limited', 1)))
  expect(screen.getByRole('button', { name: '검색' })).toHaveProperty('disabled', true)
  expect(screen.getByText('검색 요청이 많아 잠시 뒤에 다시 검색할 수 있어요.')).toBeTruthy()
  search('다른 책')
  expect(mocks.searchBooks).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(screen.getByRole('button', { name: '검색' })).toHaveProperty('disabled', false), { timeout: 2000 })
  expect(screen.queryByText(/검색 요청이 많/)).toBeNull()
})

test('공백만 입력하면 요청하지 않는다', () => {
  search('   ')
  expect(mocks.searchBooks).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toContain('검색어를 입력')
})

test('먼저 보낸 검색의 늦은 응답이 최신 결과를 덮지 않는다', async () => {
  let resolveFirst!: (result: { books: SearchBook[]; isEnd: boolean }) => void
  mocks.searchBooks
    .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve }))
    .mockResolvedValueOnce({ books: [book('두 번째 결과', '9788936433598')], isEnd: true })

  search('첫 검색')
  search('두 번째 검색')
  await screen.findByText('두 번째 결과')
  resolveFirst({ books: [book('첫 번째 결과', '9788936433581')], isEnd: true })

  await waitFor(() => expect(screen.queryByText('첫 번째 결과')).toBeNull())
})

test('ISBN13이 없는 결과는 숨기되 없는 책으로 안내하지 않고 숨긴 권수를 알린다', async () => {
  mocks.searchBooks.mockResolvedValueOnce({ books: [book('ISBN10만 있는 책', null)], isEnd: true })
  search('책')

  await screen.findByText('ISBN13이 없어 서재에 담을 수 없는 책 1권은 표시하지 않았어요.')
  expect(screen.queryByText('검색 결과가 없습니다.')).toBeNull()
  expect(screen.queryByText('ISBN10만 있는 책')).toBeNull()
  expect(screen.queryByRole('button', { name: '서재에 담기' })).toBeNull()
})

test('표시 가능한 책이 없는 페이지에서도 다음 페이지를 조회하고 이전 결과를 유지한다', async () => {
  mocks.searchBooks
    .mockResolvedValueOnce({ books: [book('숨길 상품', null)], isEnd: false })
    .mockResolvedValueOnce({ books: [book('표시할 책', '9788936433598')], isEnd: false })
    .mockResolvedValueOnce({ books: [book('다른 상품', null)], isEnd: true })
  search('책')
  await screen.findByText('담을 수 있는 책이 이 페이지에 없습니다. 더 보기를 눌러 주세요.')
  expect(screen.queryByText('숨길 상품')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '결과 더 보기' }))
  await screen.findByText('표시할 책')
  fireEvent.click(screen.getByRole('button', { name: '결과 더 보기' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: '결과 더 보기' })).toBeNull())
  expect(screen.getByText('표시할 책')).toBeTruthy()
  expect(screen.queryByText('다른 상품')).toBeNull()
  expect(screen.queryByText('검색 결과가 없습니다.')).toBeNull()
  // 더 보기로 받은 페이지의 숨긴 권수도 더한다.
  expect(screen.getByText('ISBN13이 없어 서재에 담을 수 없는 책 2권은 표시하지 않았어요.')).toBeTruthy()
  expect(mocks.searchBooks).toHaveBeenLastCalledWith('책', 3, {})
})

test('담는 중에는 다시 누를 수 없고, 이미 있던 책이면 기존 상태를 알린다', async () => {
  let resolveAdd!: (value: { id: string; status: string; created: boolean }) => void
  mocks.searchBooks.mockResolvedValueOnce({ books: [book('읽던 책', '9788936433598')], isEnd: true })
  mocks.addLibraryBook.mockReturnValueOnce(new Promise((resolve) => { resolveAdd = resolve }))
  search('책')

  fireEvent.click(await screen.findByRole('button', { name: '서재에 담기' }))
  const saving = screen.getByRole('button', { name: '담는 중…' }) as HTMLButtonElement
  expect(saving.disabled).toBe(true)
  fireEvent.click(saving)
  expect(mocks.addLibraryBook).toHaveBeenCalledTimes(1)
  expect(mocks.addLibraryBook).toHaveBeenCalledWith('test-token', '9788936433598')

  resolveAdd({ id: 'user-book-1', status: 'reading', created: false })
  expect((await screen.findByRole('status')).textContent).toContain('이미 서재에 있는 책입니다. (읽는 중)')
})

test('검색 오류는 빈 결과로 바꾸지 않고 원인을 구분한다', async () => {
  mocks.searchBooks.mockRejectedValueOnce(new ApiError(504))
  search('책')

  expect((await screen.findByRole('alert')).textContent).toContain('응답이 늦습니다')
  expect(screen.queryByText(/검색 결과가 없습니다/)).toBeNull()
})

test('등록 중 네트워크 오류는 자동 재전송하지 않고 서재 확인을 안내한다', async () => {
  mocks.searchBooks.mockResolvedValueOnce({ books: [book('책', '9788936433598')], isEnd: true })
  mocks.addLibraryBook.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  search('책')

  fireEvent.click(await screen.findByRole('button', { name: '서재에 담기' }))
  expect((await screen.findByRole('status')).textContent).toContain('서재에서 담겼는지 확인')
  expect(mocks.addLibraryBook).toHaveBeenCalledTimes(1)
})

test('새로 담은 책(201)은 담았다고 안내한다', async () => {
  mocks.searchBooks.mockResolvedValueOnce({ books: [book('새 책', '9788936433598')], isEnd: true })
  mocks.addLibraryBook.mockResolvedValueOnce({ id: 'user-book-1', status: 'want_to_read', created: true })
  search('책')

  fireEvent.click(await screen.findByRole('button', { name: '서재에 담기' }))
  expect((await screen.findByRole('status')).textContent).toContain('서재에 담았습니다.')
})

test('결과 더 보기는 다음 페이지를 이어 붙이고 마지막 페이지면 숨긴다', async () => {
  mocks.searchBooks
    .mockResolvedValueOnce({ books: [book('1쪽 책', '9788936433598')], isEnd: false })
    .mockResolvedValueOnce({ books: [book('2쪽 책', '9788936433581')], isEnd: true })
  search('책')

  fireEvent.click(await screen.findByRole('button', { name: '결과 더 보기' }))
  await screen.findByText('2쪽 책')
  expect(screen.getByText('1쪽 책')).toBeTruthy()
  expect(mocks.searchBooks).toHaveBeenLastCalledWith('책', 2, {})
  expect(screen.queryByRole('button', { name: '결과 더 보기' })).toBeNull()
})

test('더 보기 실패는 이미 받은 결과를 지우지 않는다', async () => {
  mocks.searchBooks
    .mockResolvedValueOnce({ books: [book('1쪽 책', '9788936433598')], isEnd: false })
    .mockRejectedValueOnce(new ApiError(504))
  search('책')

  fireEvent.click(await screen.findByRole('button', { name: '결과 더 보기' }))
  expect((await screen.findByRole('alert')).textContent).toContain('응답이 늦습니다')
  expect(screen.getByText('1쪽 책')).toBeTruthy()
  expect(screen.getByRole('button', { name: '결과 더 보기' })).toBeTruthy()
})

test('새 검색 응답 전에는 이전 검색어로 더 보기를 보내지 않는다', async () => {
  mocks.searchBooks
    .mockResolvedValueOnce({ books: [book('첫 검색 1쪽', '9788936433598')], isEnd: false })
    .mockReturnValueOnce(new Promise(() => {}))
  search('첫 검색')
  const more = await screen.findByRole('button', { name: '결과 더 보기' })

  search('두 번째 검색')
  fireEvent.click(more)

  expect(more).toHaveProperty('disabled', true)
  expect(mocks.searchBooks).toHaveBeenCalledTimes(2)
})

test('서버 오류 code가 있는 422는 code별 안내를 보여 준다', async () => {
  mocks.searchBooks.mockRejectedValueOnce(new ApiError(422, 'Search query must not be blank', 'blank_query'))
  search('책')

  expect((await screen.findByRole('alert')).textContent).toContain('검색어를 입력해주세요.')
})
