// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode, type ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError } from './lib/api'
import type { LibraryBookItem } from './lib/api'
import Library, { PAGE_SIZE } from './Library'

const mocks = vi.hoisted(() => ({
  getLibraryBooks: vi.fn(),
  moveLibraryBook: vi.fn(),
  getShelves: vi.fn(),
}))

vi.mock('./lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/api')>(),
  getLibraryBooks: mocks.getLibraryBooks,
  moveLibraryBook: mocks.moveLibraryBook,
  getShelves: mocks.getShelves,
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

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getShelves.mockResolvedValue([])
})
afterEach(cleanup)

test('더 보기는 받은 개수만큼 offset을 넘겨 다음 페이지를 이어 붙인다', async () => {
  mocks.getLibraryBooks
    .mockResolvedValueOnce(makeBooks(PAGE_SIZE, 'A'))
    .mockResolvedValueOnce(makeBooks(3, 'B'))
  renderInRouter(<Library />)

  fireEvent.click(await screen.findByRole('button', { name: '더 보기' }))

  await screen.findByText('B 책 2')
  expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', PAGE_SIZE, PAGE_SIZE, {})
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
  expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', PAGE_SIZE, 0, {})
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
  expect(screen.getByRole('status').textContent).toBe('순서를 저장하는 중…')
  finishMove()
  await waitFor(() => expect(mocks.getLibraryBooks).toHaveBeenCalledTimes(2))
  expect(screen.getByRole('status').textContent).toBe('최신 순서를 확인하는 중…')
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

test('추가 페이지에서 옮기면 불러온 범위를 한 번에 다시 읽고 옮긴 책에 포커스를 둔다', async () => {
  const books = makeBooks(23, 'A')
  const reordered = [...books.slice(0, 19), books[20], books[19], ...books.slice(21)]
  mocks.getLibraryBooks.mockResolvedValueOnce(books.slice(0, 20)).mockResolvedValueOnce(books.slice(20))
    .mockResolvedValueOnce(reordered)
  mocks.moveLibraryBook.mockResolvedValue(undefined)
  renderInRouter(<Library />)
  fireEvent.click(await screen.findByRole('button', { name: '더 보기' }))
  await screen.findByText('A 책 22')
  fireEvent.click(screen.getByRole('button', { name: '순서 편집' }))
  fireEvent.click(screen.getByRole('button', { name: 'A 책 19 뒤로' }))
  await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('A 책 19 이동 손잡이'))
  expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', 23, 0, {})
  expect(screen.getAllByRole('listitem').map((item) => item.querySelector('.book-title')?.textContent)[20]).toBe('A 책 19')
  // 마지막 페이지까지 받은 상태였으므로 꽉 찬 재조회 뒤에도 더 보기를 다시 띄우지 않는다.
  expect(screen.queryByRole('button', { name: '더 보기' })).toBeNull()
})

test.each([100, 101, 123])('%i권을 끝까지 불러온 뒤 이동해도 재조회 범위 밖의 책을 이어 볼 수 있다', async (count) => {
  let books = makeBooks(count, 'A')
  mocks.getLibraryBooks.mockImplementation((_token: string, limit: number, offset: number) =>
    Promise.resolve(books.slice(offset, offset + limit)))
  mocks.moveLibraryBook.mockImplementation(() => {
    books = [books[1], books[0], ...books.slice(2)]
    return Promise.resolve()
  })
  renderInRouter(<Library />)
  await screen.findByText('A 책 0')
  for (let offset = PAGE_SIZE; offset < count; offset += PAGE_SIZE) {
    fireEvent.click(screen.getByRole('button', { name: '더 보기' }))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(Math.min(offset + PAGE_SIZE, count)))
  }
  if (count % PAGE_SIZE === 0) fireEvent.click(screen.getByRole('button', { name: '더 보기' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: '더 보기' })).toBeNull())

  fireEvent.click(screen.getByRole('button', { name: '순서 편집' }))
  fireEvent.click(screen.getByRole('button', { name: 'A 책 0 뒤로' }))
  await waitFor(() => expect((screen.getByRole('button', { name: '편집 마치기' }) as HTMLButtonElement).disabled).toBe(false))
  expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', 100, 0, {})
  expect(screen.getAllByRole('listitem')).toHaveLength(100)
  for (let offset = 100; offset < count; offset += PAGE_SIZE) {
    const more = screen.queryByRole('button', { name: '더 보기' })
    expect(more).not.toBeNull()
    fireEvent.click(more!)
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(Math.min(offset + PAGE_SIZE, count)))
    expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', PAGE_SIZE, offset, {})
  }
  expect(screen.getAllByRole('listitem').map((item) => item.querySelector('.book-title')?.textContent)).toEqual(books.map((book) => book.title))
  expect(screen.queryByRole('button', { name: '더 보기' })).toBeNull()
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

const search = (query: string, field?: '제목' | '저자') => {
  if (field) fireEvent.change(screen.getByLabelText('검색 기준'), { target: { value: field === '저자' ? 'author' : 'title' } })
  fireEvent.change(screen.getByLabelText('서재 검색어'), { target: { value: query } })
  fireEvent.click(screen.getByRole('button', { name: /^검색$/ }))
}

test('저자 검색은 서버에 검색 조건을 보내고, 필터 중에는 순서 편집을 막았다가 해제하면 다시 허용한다', async () => {
  mocks.getLibraryBooks
    .mockResolvedValueOnce(makeBooks(3, 'A'))
    .mockResolvedValueOnce(makeBooks(1, 'S'))
    .mockResolvedValueOnce(makeBooks(3, 'A'))
  renderInRouter(<Library />)
  await screen.findByText('A 책 2')
  expect(screen.getByRole('button', { name: '순서 편집' })).toHaveProperty('disabled', false)

  search('  한강  ', '저자')
  await screen.findByText('S 책 0')
  expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', PAGE_SIZE, 0, { q: '한강', field: 'author' })
  expect(screen.queryByText('A 책 0')).toBeNull()
  expect(screen.getByRole('button', { name: '순서 편집' })).toHaveProperty('disabled', true)
  expect(screen.getByText('검색·상태·책장 필터를 해제하면 전체 서재 순서를 편집할 수 있어요.')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: '검색 해제' }))
  await screen.findByText('A 책 2')
  expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', PAGE_SIZE, 0, {})
  expect(screen.getByLabelText('서재 검색어')).toHaveProperty('value', '')
  expect(screen.getByRole('button', { name: '순서 편집' })).toHaveProperty('disabled', false)
})

test('상태 필터는 검색과 함께 보내고, 조건을 바꾸면 처음부터 다시 조회한다', async () => {
  mocks.getLibraryBooks
    .mockResolvedValueOnce(makeBooks(PAGE_SIZE, 'A'))
    .mockResolvedValueOnce(makeBooks(PAGE_SIZE, 'B'))
    .mockResolvedValueOnce(makeBooks(2, 'C'))
    .mockResolvedValueOnce(makeBooks(1, 'D'))
  renderInRouter(<Library />)
  fireEvent.click(await screen.findByRole('button', { name: '더 보기' }))
  await screen.findByText('B 책 0')

  fireEvent.change(screen.getByLabelText('읽기 상태'), { target: { value: 'completed' } })
  await screen.findByText('C 책 1')
  expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', PAGE_SIZE, 0, { status: 'completed' })
  expect(screen.queryByText('B 책 0')).toBeNull()

  search('소년')
  await screen.findByText('D 책 0')
  expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', PAGE_SIZE, 0, { q: '소년', field: 'title', status: 'completed' })
})

test('공백만 입력하거나 200자를 넘는 검색어는 요청하지 않는다', async () => {
  mocks.getLibraryBooks.mockResolvedValueOnce(makeBooks(1, 'A'))
  renderInRouter(<Library />)
  await screen.findByText('A 책 0')
  search('   ')
  expect(screen.getByRole('alert').textContent).toBe('검색어를 입력해주세요.')
  // 정규화 뒤 코드 포인트로 센다: 이모지 200개는 허용 범위다.
  search('😀'.repeat(201))
  expect(screen.getByRole('alert').textContent).toBe('검색어는 200자까지 입력할 수 있어요.')
  expect(mocks.getLibraryBooks).toHaveBeenCalledTimes(1)
})

test('검색 결과 0건과 검색 오류를 구분한다', async () => {
  mocks.getLibraryBooks
    .mockResolvedValueOnce(makeBooks(1, 'A'))
    .mockResolvedValueOnce([])
    .mockRejectedValueOnce(new ApiError(503))
  renderInRouter(<Library />)
  await screen.findByText('A 책 0')
  search('없는 책')
  await screen.findByText('조건에 맞는 책이 없습니다.')
  expect(screen.queryByText(/아직 서재에 담은 책이 없습니다/)).toBeNull()

  search('다른 책')
  expect((await screen.findByRole('alert')).textContent).toContain('잠시 응답할 수 없습니다')
  expect(screen.queryByText('조건에 맞는 책이 없습니다.')).toBeNull()
})

test('조건을 바꾸면 이전 조건의 늦은 응답을 버린다', async () => {
  let resolveFirst!: (books: LibraryBookItem[]) => void
  mocks.getLibraryBooks
    .mockResolvedValueOnce(makeBooks(1, 'A'))
    .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve }))
    .mockResolvedValueOnce(makeBooks(1, 'NEW'))
  renderInRouter(<Library />)
  await screen.findByText('A 책 0')
  search('첫 검색')
  search('두 번째')
  await screen.findByText('NEW 책 0')
  await act(async () => { resolveFirst(makeBooks(1, 'OLD')) })
  expect(screen.queryByText('OLD 책 0')).toBeNull()
  expect(screen.getByText('NEW 책 0')).toBeTruthy()
})

test('필터 결과 더 보기가 실패해도 결과를 유지하고 같은 조건·위치로 다시 시도한다', async () => {
  mocks.getLibraryBooks
    .mockResolvedValueOnce(makeBooks(1, 'A'))
    .mockResolvedValueOnce(makeBooks(PAGE_SIZE, 'S'))
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce(makeBooks(2, 'T'))
  renderInRouter(<Library />)
  await screen.findByText('A 책 0')
  search('책')
  fireEvent.click(await screen.findByRole('button', { name: '더 보기' }))
  expect((await screen.findByRole('alert')).textContent).toContain('서버에 연결하지 못했습니다')
  expect(screen.getByText('S 책 19')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '더 보기' }))
  await screen.findByText('T 책 1')
  expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', PAGE_SIZE, PAGE_SIZE, { q: '책', field: 'title' })
})

test('순서 편집 중에는 검색·상태 조건을 바꾸지 않는다', async () => {
  mocks.getLibraryBooks.mockResolvedValueOnce(makeBooks(2, 'A'))
  renderInRouter(<Library />)
  fireEvent.click(await screen.findByRole('button', { name: '순서 편집' }))
  expect(screen.getByLabelText('서재 검색어')).toHaveProperty('disabled', true)
  expect(screen.getByLabelText('읽기 상태')).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: /^검색$/ })).toHaveProperty('disabled', true)
})

test('서버가 검색 조건을 422로 거부하면 이전 조건으로 돌아가 이유를 입력란에 안내한다', async () => {
  mocks.getLibraryBooks
    .mockResolvedValueOnce(makeBooks(2, 'A'))
    .mockRejectedValueOnce(new ApiError(422, 'blank', 'blank_query'))
    .mockResolvedValueOnce(makeBooks(2, 'A'))
  renderInRouter(<Library />)
  await screen.findByText('A 책 1')
  search('\u001f')
  await waitFor(() => expect(mocks.getLibraryBooks).toHaveBeenCalledTimes(3))
  expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', PAGE_SIZE, 0, {})
  await screen.findByText('A 책 1')
  expect(screen.getByRole('alert').textContent).toBe('검색어를 입력해주세요.')
  expect(screen.getByLabelText('서재 검색어').getAttribute('aria-invalid')).toBe('true')
  expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull()

  // 조건을 바꾸면 지난 안내를 지운다.
  mocks.getLibraryBooks.mockResolvedValueOnce(makeBooks(1, 'C'))
  fireEvent.change(screen.getByLabelText('읽기 상태'), { target: { value: 'completed' } })
  await screen.findByText('C 책 0')
  expect(screen.queryByRole('alert')).toBeNull()
})

test('검색 기준만 바꾸고 제출하지 않았으면 상태 변경은 적용된 기준을 쓰고 선택 상자도 맞춘다', async () => {
  mocks.getLibraryBooks.mockResolvedValue(makeBooks(1, 'A'))
  renderInRouter(<Library />)
  await screen.findByText('A 책 0')
  search('한강', '제목')
  await waitFor(() => expect(mocks.getLibraryBooks).toHaveBeenCalledTimes(2))
  fireEvent.change(screen.getByLabelText('검색 기준'), { target: { value: 'author' } })
  fireEvent.change(screen.getByLabelText('읽기 상태'), { target: { value: 'completed' } })
  await waitFor(() => expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', PAGE_SIZE, 0, { q: '한강', field: 'title', status: 'completed' }))
  expect(screen.getByLabelText('검색 기준')).toHaveProperty('value', 'title')
})

const shelfItem = (id: string, name: string, count: number) => ({ id, name, book_count: count, position: 0 })

test('책장 필터는 검색·상태와 함께 서버에 보내고 서버 권수를 표시하며 순서 편집을 막는다', async () => {
  mocks.getShelves.mockResolvedValue([shelfItem('s1', 'SF', 12), shelfItem('s2', '에세이', 0)])
  mocks.getLibraryBooks.mockResolvedValueOnce(makeBooks(3, 'A')).mockResolvedValueOnce(makeBooks(1, 'S'))
  renderInRouter(<Library />)
  await screen.findByText('A 책 2')
  const select = await screen.findByLabelText('책장')
  expect([...(select as HTMLSelectElement).options].map((option) => option.textContent)).toEqual(['전체', 'SF (12권)', '에세이 (0권)'])
  fireEvent.change(select, { target: { value: 's1' } })
  await screen.findByText('S 책 0')
  expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', PAGE_SIZE, 0, { shelf_id: 's1' })
  expect(screen.getByRole('button', { name: '순서 편집' })).toHaveProperty('disabled', true)
})

test('선택한 책장이 없어졌으면(404) 책장 목록을 다시 받고 전체 책장으로 돌아간다', async () => {
  mocks.getShelves.mockResolvedValueOnce([shelfItem('s1', 'SF', 2)]).mockResolvedValueOnce([])
  mocks.getLibraryBooks
    .mockResolvedValueOnce(makeBooks(2, 'A'))
    .mockRejectedValueOnce(new ApiError(404, 'Shelf not found'))
    .mockResolvedValueOnce(makeBooks(2, 'A'))
  renderInRouter(<Library />)
  await screen.findByText('A 책 1')
  fireEvent.change(await screen.findByLabelText('책장'), { target: { value: 's1' } })
  await screen.findByText('선택한 책장을 찾을 수 없어 전체 책장으로 돌아왔어요.')
  await waitFor(() => expect(mocks.getShelves).toHaveBeenCalledTimes(2))
  expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', PAGE_SIZE, 0, {})
  await screen.findByText('A 책 1')
  expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull()
  expect(screen.queryByLabelText('책장')).toBeNull()
})
