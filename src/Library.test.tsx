// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode, type ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError } from './lib/api'
import type { LibraryBookItem } from './lib/api'
import Library, { PAGE_SIZE } from './Library'

const mocks = vi.hoisted(() => ({
  getLibraryBooks: vi.fn(),
  moveLibraryBook: vi.fn(),
}))

vi.mock('./lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/api')>(),
  getLibraryBooks: mocks.getLibraryBooks,
  moveLibraryBook: mocks.moveLibraryBook,
}))
// 환경변수 없는 CI에서도 실제 Supabase 클라이언트를 만들지 않는다.
vi.mock('./lib/supabase', () => ({ supabase: { auth: {} } }))
vi.mock('./lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/auth')>(),
  withAccessToken: (request: (token: string) => Promise<unknown>) => request('test-token'),
}))

function makeBooks(count: number, prefix: string): LibraryBookItem[] {
  return Array.from({ length: count }, (_, index) => ({
    // 서재 id와 공통 책 id를 다르게 두어 혼동을 드러낸다.
    id: `${prefix}-user-book-${index}`,
    book_id: `${prefix}-book-${index}`,
    isbn13: '9788936433598',
    title: `${prefix} 책 ${index}`,
    authors: [],
    thumbnail_url: null,
    status: 'reading',
    created_at: '2026-10-27T00:00:00Z',
  }))
}

// 표지가 상세 링크이므로 라우터 안에서 그린다.
const renderInRouter = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

beforeEach(() => vi.resetAllMocks())
afterEach(cleanup)

test('더 보기는 받은 개수만큼 offset을 넘겨 다음 페이지를 이어 붙인다', async () => {
  mocks.getLibraryBooks
    .mockResolvedValueOnce(makeBooks(PAGE_SIZE, 'A'))
    .mockResolvedValueOnce(makeBooks(3, 'B'))
  renderInRouter(<Library />)

  fireEvent.click(await screen.findByRole('button', { name: '더 보기' }))

  await screen.findByText('B 책 2')
  expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', PAGE_SIZE, PAGE_SIZE)
  expect(screen.getAllByRole('listitem')).toHaveLength(PAGE_SIZE + 3)
  // 마지막 페이지가 PAGE_SIZE보다 적으면 더 보기를 숨긴다.
  expect(screen.queryByRole('button', { name: '더 보기' })).toBeNull()
})

test('조회 실패를 빈 서재로 표시하지 않고 재시도할 수 있다', async () => {
  mocks.getLibraryBooks
    .mockRejectedValueOnce(new ApiError(503))
    .mockResolvedValueOnce(makeBooks(1, 'A'))
  renderInRouter(<Library />)

  expect((await screen.findByRole('alert')).textContent).toContain('잠시 응답할 수 없습니다')
  expect(screen.queryByText(/아직 서재에 담은 책이 없습니다/)).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  await screen.findByText('A 책 0')
})

test('빈 배열이면 빈 서재 안내를 표시한다', async () => {
  mocks.getLibraryBooks.mockResolvedValueOnce([])
  renderInRouter(<Library />)
  await screen.findByText(/아직 서재에 담은 책이 없습니다/)
  expect(screen.getByRole('link', { name: '책 찾으러 가기' }).getAttribute('href')).toBe('/search')
})

test('계정이 바뀐 뒤 도착한 이전 계정 응답은 표시하지 않는다', async () => {
  let resolveA!: (books: LibraryBookItem[]) => void
  mocks.getLibraryBooks
    .mockReturnValueOnce(new Promise((resolve) => { resolveA = resolve }))
    .mockResolvedValueOnce(makeBooks(1, 'B'))
  const { rerender } = renderInRouter(<Library key="user-A" />)

  rerender(<MemoryRouter><Library key="user-B" /></MemoryRouter>)
  await screen.findByText('B 책 0')
  resolveA(makeBooks(1, 'A'))

  await waitFor(() => expect(screen.queryByText('A 책 0')).toBeNull())
  expect(screen.getAllByRole('listitem')).toHaveLength(1)
})

test('앞으로 이동은 새 선행 개인 id를 보내고 첫 페이지의 서버 순서를 표시한다', async () => {
  const books = makeBooks(3, 'A')
  mocks.getLibraryBooks.mockResolvedValueOnce(books).mockResolvedValueOnce([books[0], books[2], books[1]])
  mocks.moveLibraryBook.mockResolvedValue(undefined)
  renderInRouter(<Library />)
  fireEvent.click(await screen.findByRole('button', { name: '순서 편집' }))
  fireEvent.click(screen.getByRole('button', { name: 'A 책 2 앞으로' }))
  await waitFor(() => expect(mocks.moveLibraryBook).toHaveBeenCalledWith('test-token', books[2].id, books[0].id))
  await waitFor(() => expect(screen.getAllByRole('listitem').map((item) => item.querySelector('.book-title')?.textContent)).toEqual(['A 책 0', 'A 책 2', 'A 책 1']))
  expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', PAGE_SIZE, 0)
})

test('맨 앞으로 이동할 때 null을 보내고 저장과 재조회가 끝날 때까지 잠근다', async () => {
  const books = makeBooks(2, 'A')
  let finishMove!: () => void
  let finishLoad!: (value: LibraryBookItem[]) => void
  mocks.getLibraryBooks.mockResolvedValueOnce(books).mockReturnValueOnce(new Promise((resolve) => { finishLoad = resolve }))
  mocks.moveLibraryBook.mockReturnValueOnce(new Promise<void>((resolve) => { finishMove = resolve }))
  renderInRouter(<Library />)
  fireEvent.click(await screen.findByRole('button', { name: '순서 편집' }))
  fireEvent.click(screen.getByRole('button', { name: 'A 책 1 앞으로' }))
  expect(mocks.moveLibraryBook).toHaveBeenCalledWith('test-token', books[1].id, null)
  expect((screen.getByRole('button', { name: 'A 책 0 뒤로' }) as HTMLButtonElement).disabled).toBe(true)
  finishMove()
  await waitFor(() => expect(mocks.getLibraryBooks).toHaveBeenCalledTimes(2))
  expect((screen.getByRole('button', { name: '편집 마치기' }) as HTMLButtonElement).disabled).toBe(true)
  finishLoad([books[1], books[0]])
  await waitFor(() => expect((screen.getByRole('button', { name: '편집 마치기' }) as HTMLButtonElement).disabled).toBe(false))
})

test('불명확한 이동 후 재조회도 실패하면 목록을 보존하고 확인 성공 전에는 다시 쓰지 않는다', async () => {
  const books = makeBooks(2, 'A')
  mocks.getLibraryBooks.mockResolvedValueOnce(books).mockRejectedValueOnce(new ApiError(503)).mockResolvedValueOnce([books[1], books[0]])
  mocks.moveLibraryBook.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  renderInRouter(<Library />)
  fireEvent.click(await screen.findByRole('button', { name: '순서 편집' }))
  fireEvent.click(screen.getByRole('button', { name: 'A 책 1 앞으로' }))
  const retry = await screen.findByRole('button', { name: '최신 순서 다시 확인' })
  await waitFor(() => expect(document.activeElement).toBe(retry))
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  expect((screen.getByRole('button', { name: 'A 책 0 뒤로' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(retry)
  await waitFor(() => expect((screen.getByRole('button', { name: 'A 책 1 뒤로' }) as HTMLButtonElement).disabled).toBe(false))
  expect(mocks.moveLibraryBook).toHaveBeenCalledTimes(1)
})

test('아래로 이동은 이동 대상을 뺀 뒤의 선행 id를 사용한다', async () => {
  const books = makeBooks(3, 'A')
  mocks.getLibraryBooks.mockResolvedValueOnce(books).mockResolvedValueOnce([books[1], books[0], books[2]])
  mocks.moveLibraryBook.mockResolvedValue(undefined)
  renderInRouter(<Library />)
  fireEvent.click(await screen.findByRole('button', { name: '순서 편집' }))
  expect((screen.getByRole('button', { name: 'A 책 0 앞으로' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'A 책 2 뒤로' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'A 책 0 뒤로' }))
  await waitFor(() => expect(mocks.moveLibraryBook).toHaveBeenCalledWith('test-token', books[0].id, books[1].id))
  await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('A 책 0 이동 손잡이'))
})

test('추가 페이지에서 옮기면 첫 페이지로 되돌리고 더 보기 offset과 포커스를 복구한다', async () => {
  const books = makeBooks(23, 'A')
  const reordered = [...books.slice(0, 19), books[20], books[19], ...books.slice(21)]
  mocks.getLibraryBooks.mockResolvedValueOnce(books.slice(0, 20)).mockResolvedValueOnce(books.slice(20))
    .mockResolvedValueOnce(reordered.slice(0, 20)).mockResolvedValueOnce(reordered.slice(20))
  mocks.moveLibraryBook.mockResolvedValue(undefined)
  renderInRouter(<Library />)
  fireEvent.click(await screen.findByRole('button', { name: '더 보기' }))
  await screen.findByText('A 책 22')
  fireEvent.click(screen.getByRole('button', { name: '순서 편집' }))
  fireEvent.click(screen.getByRole('button', { name: 'A 책 19 뒤로' }))
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(20))
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '편집 마치기' })))
  fireEvent.click(screen.getByRole('button', { name: '더 보기' }))
  await screen.findByText('A 책 22')
  expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', PAGE_SIZE, 20)
  expect(new Set(screen.getAllByRole('listitem').map((item) => item.textContent)).size).toBe(23)
})

test.each([new TypeError('network'), new DOMException('timeout', 'TimeoutError'), new ApiError(504)])('불명확한 실패 %s는 한 번만 쓰고 서버 순서로 복구한다', async (error) => {
  const books = makeBooks(2, 'A')
  mocks.getLibraryBooks.mockResolvedValueOnce(books).mockResolvedValueOnce([books[1], books[0]])
  mocks.moveLibraryBook.mockRejectedValueOnce(error)
  renderInRouter(<Library />)
  fireEvent.click(await screen.findByRole('button', { name: '순서 편집' }))
  fireEvent.click(screen.getByRole('button', { name: 'A 책 1 앞으로' }))
  await screen.findByText('최신 서재 순서를 불러왔습니다. 이동 결과를 확인해주세요.')
  expect(mocks.moveLibraryBook).toHaveBeenCalledTimes(1)
  expect(screen.getAllByRole('listitem')[0].textContent).toContain('A 책 1')
})

test('invalid_position은 한국어로 안내하고 기존 목록을 보존한다', async () => {
  mocks.getLibraryBooks.mockResolvedValueOnce(makeBooks(2, 'A'))
  mocks.moveLibraryBook.mockRejectedValueOnce(new ApiError(422, 'English detail', 'invalid_position'))
  renderInRouter(<Library />)
  fireEvent.click(await screen.findByRole('button', { name: '순서 편집' }))
  fireEvent.click(screen.getByRole('button', { name: 'A 책 1 앞으로' }))
  expect((await screen.findByRole('alert')).textContent).toContain('책을 자기 자신 뒤로 옮길 수 없습니다')
  expect(screen.getAllByRole('listitem')[0].textContent).toContain('A 책 0')
  expect(mocks.getLibraryBooks).toHaveBeenCalledTimes(1)
})

test('404는 삭제된 책을 추정하지 않고 최신 목록으로 다시 확인한다', async () => {
  const books = makeBooks(2, 'A')
  mocks.getLibraryBooks.mockResolvedValueOnce(books).mockResolvedValueOnce([books[0]])
  mocks.moveLibraryBook.mockRejectedValueOnce(new ApiError(404))
  renderInRouter(<Library />)
  fireEvent.click(await screen.findByRole('button', { name: '순서 편집' }))
  fireEvent.click(screen.getByRole('button', { name: 'A 책 1 앞으로' }))
  await screen.findByText('최신 서재 순서를 불러왔습니다. 이동 결과를 확인해주세요.')
  expect(screen.queryByText('A 책 1')).toBeNull()
})

test('계정 전환 뒤 이전 이동 응답은 재조회나 새 계정 목록을 변경하지 않는다', async () => {
  let resolveMove!: () => void
  mocks.getLibraryBooks.mockResolvedValueOnce(makeBooks(2, 'A')).mockResolvedValueOnce(makeBooks(2, 'B'))
  mocks.moveLibraryBook.mockReturnValueOnce(new Promise<void>((resolve) => { resolveMove = resolve }))
  const { rerender } = renderInRouter(<Library key="A" />)
  fireEvent.click(await screen.findByRole('button', { name: '순서 편집' }))
  fireEvent.click(screen.getByRole('button', { name: 'A 책 1 앞으로' }))
  rerender(<MemoryRouter><Library key="B" /></MemoryRouter>)
  await screen.findByText('B 책 0')
  resolveMove()
  await waitFor(() => expect(screen.queryByText('A 책 1')).toBeNull())
  expect(mocks.getLibraryBooks).toHaveBeenCalledTimes(2)
})

test('StrictMode 재마운트에서는 첫 조회의 늦은 응답을 무시한다', async () => {
  let resolveFirst!: (books: LibraryBookItem[]) => void
  mocks.getLibraryBooks.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve })).mockResolvedValueOnce(makeBooks(2, 'new'))
  render(<StrictMode><MemoryRouter><Library /></MemoryRouter></StrictMode>)
  await screen.findByText('new 책 0')
  resolveFirst(makeBooks(2, 'old'))
  await waitFor(() => expect(screen.queryByText('old 책 0')).toBeNull())
})
