// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode, type ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError } from './lib/api'
import type { LibraryBookItem } from './lib/api'
import Library, { PAGE_SIZE } from './Library'
import LibraryShelfActions from './LibraryShelfActions'

const mocks = vi.hoisted(() => ({
  getLibraryBooks: vi.fn(),
  moveLibraryBook: vi.fn(),
  getShelves: vi.fn(),
  deleteShelf: vi.fn(),
  addBookToShelf: vi.fn(),
  removeBookFromShelf: vi.fn(),
}))

vi.mock('./lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/api')>(),
  getLibraryBooks: mocks.getLibraryBooks,
  moveLibraryBook: mocks.moveLibraryBook,
  getShelves: mocks.getShelves,
  deleteShelf: mocks.deleteShelf,
  addBookToShelf: mocks.addBookToShelf,
  removeBookFromShelf: mocks.removeBookFromShelf,
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
    page_count: null,
    total_pages: null,
    current_page: null,
    progress_percent: null,
  }))
}

// 표지가 상세 링크이므로 라우터 안에서 그린다.
const renderInRouter = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getShelves.mockResolvedValue([])
})
afterEach(cleanup)

function managementAction(name: string) {
  const menu = document.querySelector<HTMLDetailsElement>('.library-management')!
  if (!menu.open) fireEvent.click(menu.querySelector('summary')!)
  return screen.getByRole('button', { name })
}
async function findManagementAction(name: string) {
  await waitFor(() => expect(document.querySelector('.library')?.getAttribute('aria-busy')).toBe('false'))
  return managementAction(name)
}


test('검색과 관리 조작은 기본 접고 검색 조건은 접어도 해제할 수 있다', async () => {
  mocks.getLibraryBooks.mockResolvedValue(makeBooks(2, 'A'))
  renderInRouter(<Library />)
  await screen.findByText('A 책 0')
  expect(screen.queryByRole('search')).toBeNull()
  expect(screen.queryByRole('button', { name: '순서 편집' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '서재 검색', expanded: false }))
  fireEvent.change(screen.getByLabelText('서재 검색어'), { target: { value: '한강' } })
  fireEvent.submit(screen.getByRole('search'))
  await screen.findByText('제목 ‘한강’ 검색 결과')
  fireEvent.click(screen.getByRole('button', { name: '서재 검색', expanded: true }))
  expect(screen.queryByRole('search')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '검색 해제' }))
  await screen.findByText('A 책 0')
  expect(screen.queryByText('제목 ‘한강’ 검색 결과')).toBeNull()
})

test('정렬 변경은 첫 페이지부터 받고 직접 정한 순서에서만 위치 편집을 허용한다', async () => {
  mocks.getLibraryBooks.mockResolvedValueOnce(makeBooks(PAGE_SIZE, 'A')).mockResolvedValueOnce(makeBooks(3, 'B'))
    .mockResolvedValueOnce(makeBooks(2, '등록')).mockResolvedValueOnce(makeBooks(1, '시작')).mockResolvedValueOnce(makeBooks(2, '직접'))
  renderInRouter(<Library />)
  fireEvent.click(await screen.findByRole('button', { name: '더 보기' }))
  await screen.findByText('B 책 2')
  const sort = screen.getByLabelText('서재 정렬')
  fireEvent.change(sort, { target: { value: 'created' } })
  await screen.findByText('등록 책 1')
  expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', PAGE_SIZE, 0, { sort: 'created' })
  expect(screen.queryByText('B 책 2')).toBeNull()
  expect(managementAction('순서 편집')).toHaveProperty('disabled', true)
  fireEvent.change(sort, { target: { value: 'started' } })
  await screen.findByText('시작 책 0')
  expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', PAGE_SIZE, 0, { sort: 'started' })
  fireEvent.change(sort, { target: { value: 'custom' } })
  await screen.findByText('직접 책 1')
  expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', PAGE_SIZE, 0, {})
  expect(managementAction('순서 편집')).toHaveProperty('disabled', false)
  fireEvent.click(managementAction('순서 편집'))
  expect(sort).toHaveProperty('disabled', true)
  expect(mocks.moveLibraryBook).not.toHaveBeenCalled()
})

test('정렬은 검색·상태·책장과 추가 페이지 조회에서도 유지된다', async () => {
  mocks.getShelves.mockResolvedValue([{ id: 's1', name: 'SF', position: 0, book_count: 22 }])
  mocks.getLibraryBooks.mockResolvedValue(makeBooks(PAGE_SIZE, 'A'))
  renderInRouter(<Library />)
  await screen.findByText('A 책 0')
  fireEvent.change(screen.getByLabelText('서재 정렬'), { target: { value: 'started' } })
  await screen.findByText('A 책 0')
  search('한강', '저자')
  await screen.findByText('A 책 0')
  fireEvent.change(screen.getByLabelText('읽기 상태'), { target: { value: 'reading' } })
  await screen.findByText('A 책 0')
  fireEvent.change(screen.getByLabelText('책장'), { target: { value: 's1' } })
  await screen.findByText('A 책 0')
  const expected = { sort: 'started', q: '한강', field: 'author', status: 'reading', shelf_id: 's1' }
  expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', PAGE_SIZE, 0, expected)
  mocks.getLibraryBooks.mockResolvedValueOnce(makeBooks(2, 'B'))
  fireEvent.click(screen.getByRole('button', { name: '더 보기' }))
  await screen.findByText('B 책 1')
  expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', PAGE_SIZE, PAGE_SIZE, expected)
  fireEvent.click(screen.getByRole('button', { name: '검색 해제' }))
  await screen.findByText('A 책 0')
  expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', PAGE_SIZE, 0, { sort: 'started', status: 'reading', shelf_id: 's1' })
})

test('이전 정렬의 늦은 응답이 현재 정렬 결과를 덮지 않는다', async () => {
  let resolveOld!: (books: LibraryBookItem[]) => void
  mocks.getLibraryBooks.mockResolvedValueOnce(makeBooks(1, 'A'))
    .mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve }))
    .mockResolvedValueOnce(makeBooks(1, 'NEW'))
  renderInRouter(<Library />)
  await screen.findByText('A 책 0')
  fireEvent.change(screen.getByLabelText('서재 정렬'), { target: { value: 'created' } })
  fireEvent.change(screen.getByLabelText('서재 정렬'), { target: { value: 'started' } })
  await screen.findByText('NEW 책 0')
  await act(async () => resolveOld(makeBooks(1, 'OLD')))
  expect(screen.queryByText('OLD 책 0')).toBeNull()
  expect(screen.getByLabelText('서재 정렬')).toHaveProperty('value', 'started')
})

test('서버가 정렬을 422로 거부하면 이전 정렬로 복구하고 검색어 오류와 구분한다', async () => {
  mocks.getLibraryBooks.mockResolvedValueOnce(makeBooks(1, 'A')).mockRejectedValueOnce(new ApiError(422, undefined, 'validation_error'))
    .mockResolvedValueOnce(makeBooks(1, 'A'))
  renderInRouter(<Library />)
  await screen.findByText('A 책 0')
  fireEvent.change(screen.getByLabelText('서재 정렬'), { target: { value: 'started' } })
  await screen.findByText('정렬 조건을 적용하지 못해 이전 정렬로 돌아왔어요.')
  await screen.findByText('A 책 0')
  expect(screen.getByLabelText('서재 정렬')).toHaveProperty('value', 'custom')
  expect(screen.getByLabelText('서재 정렬').getAttribute('aria-invalid')).toBe('true')
  expect(screen.getByLabelText('서재 검색어').getAttribute('aria-invalid')).toBeNull()
  expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', PAGE_SIZE, 0, {})
})

test('서재 카드의 끝 괄호만 정리하고 권 표시와 원문을 보존한다', async () => {
  const titles = ['해리 포터 (스페셜 에디션)', '1Q84 (1)', '(부록)', '제목 (설명) (한정판)', '토지 (상)', '토지 (하)', '원피스 (1권)', '삼국지 (제2권)', 'Dune (Vol. 2)']
  mocks.getLibraryBooks.mockResolvedValue(makeBooks(titles.length, 'A').map((book, index) => ({ ...book, title: titles[index] })))
  renderInRouter(<Library />)
  await screen.findByText('해리 포터')
  expect(screen.getByText('해리 포터').getAttribute('title')).toBe(titles[0])
  expect(screen.getByText('1Q84 (1)')).toBeTruthy()
  expect(screen.getByText('(부록)')).toBeTruthy()
  expect(screen.getByText('제목 (설명)')).toBeTruthy()
  for (const title of titles.slice(4)) expect(screen.getByText(title)).toBeTruthy()
  const options = screen.getByLabelText('읽기 상태').querySelectorAll('option')
  expect([...options].map(option => option.value)).toEqual(['', 'want_to_read', 'reading', 'completed'])
})

test('목록 끝이 화면에 남으면 다음 페이지를 이어 불러오고 오류 뒤에는 자동 반복하지 않는다', async () => {
  const callbacks: IntersectionObserverCallback[] = []
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { callbacks.push(callback) }
    observe() {}
    disconnect() {}
  })
  try {
    mocks.getLibraryBooks.mockResolvedValueOnce(makeBooks(PAGE_SIZE, 'A'))
      .mockResolvedValueOnce(makeBooks(PAGE_SIZE, 'B'))
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(makeBooks(1, 'C'))
    renderInRouter(<Library />)
    await screen.findByText('A 책 0')
    await waitFor(() => expect(callbacks.length).toBeGreaterThan(0))
    expect(screen.queryByRole('button', { name: '더 보기' })).toBeNull()
    const intersect = async () => act(async () => callbacks.at(-1)!([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver))
    await intersect()
    await screen.findByText('B 책 19')
    await waitFor(() => expect(callbacks.length).toBeGreaterThan(1))
    await intersect()
    await screen.findByRole('alert')
    expect(mocks.getLibraryBooks).toHaveBeenCalledTimes(3)
    fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
    await screen.findByText('C 책 0')
    expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', PAGE_SIZE, PAGE_SIZE * 2, {})
  } finally { vi.unstubAllGlobals() }
})

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
  fireEvent.click(await findManagementAction('순서 편집'))
  fireEvent.keyDown(screen.getByRole('button', { name: 'A 책 2 이동 손잡이' }), { key: 'ArrowLeft' })
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
  fireEvent.click(await findManagementAction('순서 편집'))
  fireEvent.keyDown(screen.getByRole('button', { name: 'A 책 1 이동 손잡이' }), { key: 'ArrowLeft' })
  expect(mocks.moveLibraryBook).toHaveBeenCalledWith('test-token', books[1].id, null)
  expect((screen.getByRole('button', { name: 'A 책 0 이동 손잡이' }) as HTMLButtonElement).disabled).toBe(true)
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
  fireEvent.click(await findManagementAction('순서 편집'))
  fireEvent.keyDown(screen.getByRole('button', { name: 'A 책 1 이동 손잡이' }), { key: 'ArrowLeft' })
  const retry = await screen.findByRole('button', { name: '최신 순서 다시 확인' })
  await waitFor(() => expect(document.activeElement).toBe(retry))
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  expect((screen.getByRole('button', { name: 'A 책 0 이동 손잡이' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(retry)
  await waitFor(() => expect((screen.getByRole('button', { name: 'A 책 1 이동 손잡이' }) as HTMLButtonElement).disabled).toBe(false))
  expect(mocks.moveLibraryBook).toHaveBeenCalledTimes(1)
})

test('아래로 이동은 이동 대상을 뺀 뒤의 선행 id를 사용한다', async () => {
  const books = makeBooks(3, 'A')
  mocks.getLibraryBooks.mockResolvedValueOnce(books).mockResolvedValueOnce([books[1], books[0], books[2]])
  mocks.moveLibraryBook.mockResolvedValue(undefined)
  renderInRouter(<Library />)
  fireEvent.click(await findManagementAction('순서 편집'))
  fireEvent.keyDown(screen.getByRole('button', { name: 'A 책 0 이동 손잡이' }), { key: 'ArrowLeft' })
  fireEvent.keyDown(screen.getByRole('button', { name: 'A 책 2 이동 손잡이' }), { key: 'ArrowRight' })
  expect(mocks.moveLibraryBook).not.toHaveBeenCalled()
  fireEvent.keyDown(screen.getByRole('button', { name: 'A 책 0 이동 손잡이' }), { key: 'ArrowRight' })
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
  fireEvent.click(managementAction('순서 편집'))
  fireEvent.keyDown(screen.getByRole('button', { name: 'A 책 19 이동 손잡이' }), { key: 'ArrowRight' })
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

  fireEvent.click(managementAction('순서 편집'))
  fireEvent.keyDown(screen.getByRole('button', { name: 'A 책 0 이동 손잡이' }), { key: 'ArrowRight' })
  await waitFor(() => expect((screen.getByRole('button', { name: '편집 마치기' }) as HTMLButtonElement).disabled).toBe(false))
  expect(mocks.getLibraryBooks).toHaveBeenCalledWith('test-token', Math.min(count, 100), 0, {})
  if (count > 100) expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', count - 100, 100, {})
  expect(screen.getAllByRole('listitem')).toHaveLength(count)
  expect(screen.getAllByRole('listitem').map((item) => item.querySelector('.book-title')?.textContent)).toEqual(books.map((book) => book.title))
  expect(screen.queryByRole('button', { name: '더 보기' })).toBeNull()
  // 100권 넘게 그리는 테스트라 전체 병렬 실행에서는 기본 5초를 넘을 수 있다.
}, 20_000)

test('재조회 앞 구간이 짧게 오면 그 사이 바뀐 뒤 구간을 붙이지 않는다', async () => {
  const books = makeBooks(120, 'A')
  let reloading = false
  mocks.getLibraryBooks.mockImplementation((_token: string, limit: number, offset: number) =>
    // 재조회 중 다른 곳에서 한 권이 빠져 앞 구간이 짧아진 상황.
    Promise.resolve(reloading && offset === 0 ? books.slice(1, 100) : books.slice(offset, offset + limit)))
  mocks.moveLibraryBook.mockImplementation(() => { reloading = true; return Promise.resolve() })
  renderInRouter(<Library />)
  await screen.findByText('A 책 0')
  for (let offset = PAGE_SIZE; offset < 120; offset += PAGE_SIZE) {
    fireEvent.click(screen.getByRole('button', { name: '더 보기' }))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(offset + PAGE_SIZE))
  }
  fireEvent.click(managementAction('순서 편집'))
  fireEvent.keyDown(screen.getByRole('button', { name: 'A 책 1 이동 손잡이' }), { key: 'ArrowLeft' })
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(99))
  expect(screen.getAllByRole('listitem').at(-1)?.textContent).toContain('A 책 99')
}, 20_000)

test.each([new TypeError('network'), new DOMException('timeout', 'TimeoutError'), new ApiError(504)])('불명확한 실패 %s는 한 번만 쓰고 서버 순서로 복구한다', async (error) => {
  const books = makeBooks(2, 'A')
  mocks.getLibraryBooks.mockResolvedValueOnce(books).mockResolvedValueOnce([books[1], books[0]])
  mocks.moveLibraryBook.mockRejectedValueOnce(error)
  renderInRouter(<Library />)
  fireEvent.click(await findManagementAction('순서 편집'))
  fireEvent.keyDown(screen.getByRole('button', { name: 'A 책 1 이동 손잡이' }), { key: 'ArrowLeft' })
  await screen.findByText('최신 서재 순서를 불러왔습니다. 이동 결과를 확인해주세요.')
  expect(mocks.moveLibraryBook).toHaveBeenCalledTimes(1)
  expect(screen.getAllByRole('listitem')[0].textContent).toContain('A 책 1')
})

test('invalid_position은 한국어로 안내하고 기존 목록을 보존한다', async () => {
  mocks.getLibraryBooks.mockResolvedValueOnce(makeBooks(2, 'A'))
  mocks.moveLibraryBook.mockRejectedValueOnce(new ApiError(422, 'English detail', 'invalid_position'))
  renderInRouter(<Library />)
  fireEvent.click(await findManagementAction('순서 편집'))
  fireEvent.keyDown(screen.getByRole('button', { name: 'A 책 1 이동 손잡이' }), { key: 'ArrowLeft' })
  expect((await screen.findByRole('alert')).textContent).toContain('책을 자기 자신 뒤로 옮길 수 없습니다')
  expect(screen.getAllByRole('listitem')[0].textContent).toContain('A 책 0')
  expect(mocks.getLibraryBooks).toHaveBeenCalledTimes(1)
})

test('이동 실패는 목록 이어 받기를 막지 않고 다시 불러오기로 바꾸지 않는다', async () => {
  mocks.getLibraryBooks.mockResolvedValueOnce(makeBooks(PAGE_SIZE, 'A')).mockResolvedValueOnce(makeBooks(1, 'B'))
  mocks.moveLibraryBook.mockRejectedValueOnce(new ApiError(422, 'English detail', 'invalid_position'))
  renderInRouter(<Library />)
  fireEvent.click(await findManagementAction('순서 편집'))
  fireEvent.keyDown(screen.getByRole('button', { name: 'A 책 1 이동 손잡이' }), { key: 'ArrowLeft' })
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: '편집 마치기' }))
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '더 보기' }))
  await screen.findByText('B 책 0')
})

test('앞·뒤 버튼은 기본 숨기고 손잡이의 이동 메뉴에서 양 끝을 막고 옮긴다', async () => {
  const books = makeBooks(3, 'A')
  mocks.getLibraryBooks.mockResolvedValueOnce(books).mockResolvedValueOnce([books[1], books[0], books[2]])
  mocks.moveLibraryBook.mockResolvedValue(undefined)
  renderInRouter(<Library />)
  fireEvent.click(await findManagementAction('순서 편집'))
  expect(screen.queryByRole('button', { name: 'A 책 0 앞으로' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'A 책 0 이동 손잡이' }))
  expect(screen.getByRole('button', { name: 'A 책 0 앞으로' })).toHaveProperty('disabled', true)
  fireEvent.keyDown(screen.getByRole('button', { name: 'A 책 0 이동 손잡이' }), { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: 'A 책 2 이동 손잡이' }))
  expect(screen.getByRole('button', { name: 'A 책 2 뒤로' })).toHaveProperty('disabled', true)
  fireEvent.keyDown(screen.getByRole('button', { name: 'A 책 2 이동 손잡이' }), { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: 'A 책 1 이동 손잡이' }))
  fireEvent.click(screen.getByRole('button', { name: 'A 책 1 앞으로' }))
  await waitFor(() => expect(mocks.moveLibraryBook).toHaveBeenCalledWith('test-token', books[1].id, null))
  await screen.findByText('순서를 저장했습니다.')
  expect(screen.queryByRole('button', { name: 'A 책 1 앞으로' })).toBeNull()
})

test('404는 삭제된 책을 추정하지 않고 최신 목록으로 다시 확인한다', async () => {
  const books = makeBooks(2, 'A')
  mocks.getLibraryBooks.mockResolvedValueOnce(books).mockResolvedValueOnce([books[0]])
  mocks.moveLibraryBook.mockRejectedValueOnce(new ApiError(404))
  renderInRouter(<Library />)
  fireEvent.click(await findManagementAction('순서 편집'))
  fireEvent.keyDown(screen.getByRole('button', { name: 'A 책 1 이동 손잡이' }), { key: 'ArrowLeft' })
  await screen.findByText('최신 서재 순서를 불러왔습니다. 이동 결과를 확인해주세요.')
  expect(screen.queryByText('A 책 1')).toBeNull()
})

test('계정 전환 뒤 이전 이동 응답은 재조회나 새 계정 목록을 변경하지 않는다', async () => {
  let resolveMove!: () => void
  mocks.getLibraryBooks.mockResolvedValueOnce(makeBooks(2, 'A')).mockResolvedValueOnce(makeBooks(2, 'B'))
  mocks.moveLibraryBook.mockReturnValueOnce(new Promise<void>((resolve) => { resolveMove = resolve }))
  const { rerender } = renderInRouter(<Library key="A" />)
  fireEvent.click(await findManagementAction('순서 편집'))
  fireEvent.keyDown(screen.getByRole('button', { name: 'A 책 1 이동 손잡이' }), { key: 'ArrowLeft' })
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
  if (!screen.queryByRole('search')) fireEvent.click(screen.getByRole('button', { name: '서재 검색' }))
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
  expect(managementAction('순서 편집')).toHaveProperty('disabled', false)

  search('  한강  ', '저자')
  await screen.findByText('S 책 0')
  expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', PAGE_SIZE, 0, { q: '한강', field: 'author' })
  expect(screen.queryByText('A 책 0')).toBeNull()
  expect(managementAction('순서 편집')).toHaveProperty('disabled', true)
  expect(screen.getByText('검색·상태·책장 필터를 해제하면 전체 서재 순서를 편집할 수 있어요.')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: '검색 해제' }))
  await screen.findByText('A 책 2')
  expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', PAGE_SIZE, 0, {})
  expect(screen.getByLabelText('서재 검색어')).toHaveProperty('value', '')
  expect(managementAction('순서 편집')).toHaveProperty('disabled', false)
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
  fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
  await screen.findByText('T 책 1')
  expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', PAGE_SIZE, PAGE_SIZE, { q: '책', field: 'title' })
})

test('순서 편집 중에는 검색·상태 조건을 바꾸지 않는다', async () => {
  mocks.getLibraryBooks.mockResolvedValueOnce(makeBooks(2, 'A'))
  renderInRouter(<Library />)
  fireEvent.click(await findManagementAction('순서 편집'))
  expect(screen.getByLabelText('서재 검색어')).toHaveProperty('disabled', true)
  expect(screen.getByLabelText('읽기 상태')).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: /^검색$/, hidden: true })).toHaveProperty('disabled', true)
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

test('선택한 책을 책장에 담고 일부 실패하면 성공을 유지하며 실패한 책만 선택해 둔다', async () => {
  mocks.getShelves.mockResolvedValue([shelfItem('s1', 'SF', 0)])
  mocks.getLibraryBooks.mockResolvedValue(makeBooks(3, 'A'))
  mocks.addBookToShelf.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ApiError(503))
  renderInRouter(<Library />)
  fireEvent.click(await findManagementAction('책 선택'))
  expect(managementAction('책장 관리')).toHaveProperty('disabled', true)
  fireEvent.click(screen.getByRole('checkbox', { name: 'A 책 0 선택' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'A 책 2 선택' }))
  fireEvent.change(screen.getByLabelText('담을 책장'), { target: { value: 's1' } })
  fireEvent.click(screen.getByRole('button', { name: '책장에 담기' }))
  await screen.findByText(/A 책 2: 처리하지 못했습니다/)
  expect(mocks.addBookToShelf.mock.calls).toEqual([
    ['test-token', 's1', 'A-user-book-0'], ['test-token', 's1', 'A-user-book-2'],
  ])
  expect(screen.getByRole('checkbox', { name: 'A 책 0 선택' })).toHaveProperty('checked', false)
  expect(screen.getByRole('checkbox', { name: 'A 책 2 선택' })).toHaveProperty('checked', true)
  expect(mocks.getShelves).toHaveBeenCalledTimes(2)
})

test.each([new ApiError(503), new ApiError(401), new TypeError('network')])('책마다 같은 실패 %s면 남은 책은 보내지 않는다', async (failure) => {
  mocks.getShelves.mockResolvedValue([shelfItem('s1', 'SF', 0)])
  mocks.getLibraryBooks.mockResolvedValue(makeBooks(3, 'A'))
  mocks.addBookToShelf.mockRejectedValue(failure)
  renderInRouter(<Library />)
  fireEvent.click(await findManagementAction('책 선택'))
  for (const index of [0, 1, 2]) fireEvent.click(screen.getByRole('checkbox', { name: `A 책 ${index} 선택` }))
  fireEvent.change(screen.getByLabelText('담을 책장'), { target: { value: 's1' } })
  fireEvent.click(screen.getByRole('button', { name: '책장에 담기' }))
  await screen.findByText('남은 2권은 보내지 않았습니다. 잠시 후 다시 시도해주세요.')
  expect(mocks.addBookToShelf).toHaveBeenCalledTimes(1)
})

test('책별 404는 다음 책을 계속 보낸다', async () => {
  mocks.getShelves.mockResolvedValue([shelfItem('s1', 'SF', 0)])
  mocks.getLibraryBooks.mockResolvedValue(makeBooks(2, 'A'))
  mocks.addBookToShelf.mockRejectedValueOnce(new ApiError(404)).mockResolvedValueOnce(undefined)
  renderInRouter(<Library />)
  fireEvent.click(await findManagementAction('책 선택'))
  for (const index of [0, 1]) fireEvent.click(screen.getByRole('checkbox', { name: `A 책 ${index} 선택` }))
  fireEvent.change(screen.getByLabelText('담을 책장'), { target: { value: 's1' } })
  fireEvent.click(screen.getByRole('button', { name: '책장에 담기' }))
  await screen.findByText('1권을 책장에 담았습니다.')
  expect(mocks.addBookToShelf).toHaveBeenCalledTimes(2)
})

test('책장 변경 뒤 재조회가 실패했다가 다시 확인에 성공하면 이전 오류와 잠금을 지운다', async () => {
  mocks.getShelves.mockResolvedValue([shelfItem('s1', 'SF', 0)])
  mocks.getLibraryBooks.mockResolvedValueOnce(makeBooks(PAGE_SIZE, 'A')).mockRejectedValueOnce(new ApiError(503))
    .mockResolvedValueOnce(makeBooks(PAGE_SIZE, 'A')).mockResolvedValueOnce(makeBooks(1, 'B'))
  mocks.addBookToShelf.mockResolvedValue(undefined)
  renderInRouter(<Library />)
  fireEvent.click(await findManagementAction('책 선택'))
  fireEvent.click(screen.getByRole('checkbox', { name: 'A 책 0 선택' }))
  fireEvent.change(screen.getByLabelText('담을 책장'), { target: { value: 's1' } })
  fireEvent.click(screen.getByRole('button', { name: '책장에 담기' }))
  const recheck = await screen.findByRole('button', { name: '책장 정보 다시 확인' })
  // 재확인 전에는 눌러도 동작하지 않는 다시 불러오기를 막는다.
  expect(screen.getByRole('button', { name: '다시 불러오기' })).toHaveProperty('disabled', true)
  fireEvent.click(recheck)
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  expect(screen.queryByRole('button', { name: '다시 불러오기' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '더 보기' }))
  await screen.findByText('B 책 0')
})

test('담을 책장이 목록에서 사라지면 선택을 비우고 담기를 막는다', () => {
  const props = { books: makeBooks(1, 'A'), blocked: false, onChanged: vi.fn(), onBusyChange: vi.fn() }
  const view = render(<LibraryShelfActions {...props} shelves={[shelfItem('s1', 'SF', 0)]} />)
  fireEvent.change(screen.getByLabelText('담을 책장'), { target: { value: 's1' } })
  expect(screen.getByRole('button', { name: '책장에 담기' })).toHaveProperty('disabled', false)
  view.rerender(<LibraryShelfActions {...props} shelves={[shelfItem('s2', '에세이', 0)]} />)
  expect(screen.getByLabelText('담을 책장')).toHaveProperty('value', '')
  expect(screen.getByRole('button', { name: '책장에 담기' })).toHaveProperty('disabled', true)
  view.unmount()
  expect(props.onBusyChange).toHaveBeenLastCalledWith(false)
})

test('보고 있는 책장에서 여러 권을 빼고 불명확한 결과는 실패로 단정하거나 자동 재전송하지 않는다', async () => {
  mocks.getShelves.mockResolvedValue([shelfItem('s1', 'SF', 3)])
  mocks.getLibraryBooks.mockResolvedValue(makeBooks(3, 'A'))
  mocks.removeBookFromShelf.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new TypeError('network'))
  renderInRouter(<Library />)
  fireEvent.change(await screen.findByLabelText('책장'), { target: { value: 's1' } })
  await waitFor(() => expect(mocks.getLibraryBooks).toHaveBeenCalledTimes(2))
  fireEvent.click(managementAction('책 선택'))
  fireEvent.click(screen.getByRole('checkbox', { name: 'A 책 0 선택' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'A 책 1 선택' }))
  fireEvent.click(screen.getByRole('button', { name: '책장에서 빼기' }))
  await screen.findByText(/A 책 1: 저장 여부를 확인하지 못했습니다/)
  expect(mocks.removeBookFromShelf).toHaveBeenCalledTimes(2)
  expect(mocks.removeBookFromShelf).toHaveBeenLastCalledWith('test-token', 's1', 'A-user-book-1')
  expect(mocks.getLibraryBooks).toHaveBeenCalledTimes(3)
})

test('선택 모드에서 보던 책장이 사라져도 전체 서재로 복귀한 뒤 잠금이 남지 않는다', async () => {
  let finishLoad!: (books: LibraryBookItem[]) => void
  mocks.getShelves.mockResolvedValueOnce([shelfItem('s1', 'SF', 1)]).mockResolvedValueOnce([])
  mocks.getLibraryBooks.mockResolvedValueOnce(makeBooks(1, 'A')).mockResolvedValueOnce(makeBooks(1, 'A'))
    .mockReturnValueOnce(new Promise((resolve) => { finishLoad = resolve }))
  mocks.removeBookFromShelf.mockRejectedValueOnce(new ApiError(404))
  renderInRouter(<Library />)
  fireEvent.change(await screen.findByLabelText('책장'), { target: { value: 's1' } })
  await waitFor(() => expect(mocks.getLibraryBooks).toHaveBeenCalledTimes(2))
  fireEvent.click(managementAction('책 선택'))
  fireEvent.click(screen.getByRole('checkbox', { name: 'A 책 0 선택' }))
  fireEvent.click(screen.getByRole('button', { name: '책장에서 빼기' }))
  await waitFor(() => expect(mocks.getLibraryBooks).toHaveBeenCalledTimes(3))
  await screen.findByText('오두막 문을 여는 중…')
  await act(async () => finishLoad(makeBooks(1, 'A')))
  await waitFor(() => expect(screen.getByRole('button', { name: '선택 마치기' })).toHaveProperty('disabled', false))
  expect(screen.queryByLabelText('책장')).toBeNull()
})

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
  expect(managementAction('순서 편집')).toHaveProperty('disabled', true)
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

test('책장 필터 조회를 다시 시도하다 책장이 없어졌으면(404) 로딩에 머물지 않고 전체 책장으로 돌아간다', async () => {
  mocks.getShelves.mockResolvedValue([shelfItem('s1', 'SF', 2)])
  mocks.getLibraryBooks
    .mockResolvedValueOnce(makeBooks(2, 'A'))
    .mockRejectedValueOnce(new ApiError(503))
    .mockRejectedValueOnce(new ApiError(404, 'Shelf not found'))
    .mockResolvedValueOnce(makeBooks(2, 'A'))
  renderInRouter(<Library />)
  await screen.findByText('A 책 1')
  fireEvent.change(await screen.findByLabelText('책장'), { target: { value: 's1' } })
  fireEvent.click(await screen.findByRole('button', { name: '다시 시도' }))
  await screen.findByText('선택한 책장을 찾을 수 없어 전체 책장으로 돌아왔어요.')
  await screen.findByText('A 책 1')
  expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', PAGE_SIZE, 0, {})
})

test('보던 책장을 지우다 이미 없던 경우(404)에도 책장 목록을 다시 받아 전체 책장으로 돌아간다', async () => {
  mocks.getShelves.mockResolvedValueOnce([shelfItem('s1', 'SF', 1)]).mockResolvedValueOnce([])
  mocks.getLibraryBooks.mockResolvedValueOnce(makeBooks(2, 'A')).mockResolvedValueOnce(makeBooks(1, 'S')).mockResolvedValueOnce(makeBooks(2, 'A'))
  mocks.deleteShelf.mockRejectedValueOnce(new ApiError(404, 'Shelf not found'))
  renderInRouter(<Library />)
  await screen.findByText('A 책 1')
  fireEvent.change(await screen.findByLabelText('책장'), { target: { value: 's1' } })
  await screen.findByText('S 책 0')
  fireEvent.click(managementAction('책장 관리'))
  fireEvent.click(screen.getByRole('button', { name: 'SF 삭제' }))
  fireEvent.click(screen.getByRole('button', { name: '책장 삭제', hidden: true }))
  await screen.findByText('보던 책장이 목록에 없어 전체 책장으로 돌아왔어요.')
  await screen.findByText('A 책 1')
  expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', PAGE_SIZE, 0, {})
  expect(managementAction('순서 편집')).toHaveProperty('disabled', false)
})

test('Safari처럼 메뉴 버튼 탭이 포커스를 바깥 조상으로 옮겨도 책장 관리를 연다', async () => {
  mocks.getLibraryBooks.mockResolvedValue(makeBooks(2, 'A'))
  renderInRouter(<Library />)
  const action = await findManagementAction('책장 관리')
  const menu = document.querySelector<HTMLDetailsElement>('.library-management')!
  fireEvent.focusOut(menu.querySelector('summary')!, { relatedTarget: document.querySelector('.library') })
  expect(menu.open).toBe(true)
  fireEvent.click(action)
  expect(await screen.findByRole('dialog', { name: '책장 관리' })).toBeTruthy()
})

test('관리 메뉴는 바깥 탭·Escape·Tab 이탈로 닫히고, 메뉴 안 탭으로는 닫히지 않는다', async () => {
  mocks.getLibraryBooks.mockResolvedValue(makeBooks(2, 'A'))
  renderInRouter(<Library />)
  const action = await findManagementAction('책장 관리')
  const menu = document.querySelector<HTMLDetailsElement>('.library-management')!
  fireEvent.pointerDown(action)
  expect(menu.open).toBe(true)
  fireEvent.pointerDown(screen.getByText('A 책 0'))
  expect(menu.open).toBe(false)
  managementAction('책장 관리')
  fireEvent.keyDown(menu, { key: 'Escape' })
  expect(menu.open).toBe(false)
  expect(document.activeElement).toBe(menu.querySelector('summary'))
  // 키보드 Tab으로 바깥 조작으로 나가면 닫는다.
  managementAction('책장 관리')
  fireEvent.focusOut(menu.querySelector('summary')!, { relatedTarget: screen.getByRole('button', { name: '서재 검색' }) })
  expect(menu.open).toBe(false)
})

test('서재 카드는 진도를 아는 책만 %를 붙이고, 완독은 상태만 보여 준다', async () => {
  const [a, b, c] = makeBooks(3, 'P')
  mocks.getLibraryBooks.mockResolvedValue([
    { ...a, page_count: 300, current_page: 120, progress_percent: 40 },
    { ...b, status: 'completed', page_count: 200, current_page: 200, progress_percent: 100 },
    { ...c, page_count: null, current_page: 50, progress_percent: null },
  ])
  renderInRouter(<Library />)
  await screen.findByText('P 책 0')
  const status = (title: string) => screen.getByText(title).closest('a')!.querySelector('.book-status')!.textContent
  expect(status('P 책 0')).toBe('읽는 중 · 40%')
  expect(status('P 책 1')).toBe('완독')
  expect(status('P 책 2')).toBe('읽는 중')
})
