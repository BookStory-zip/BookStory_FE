// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError } from './lib/api'
import type { LibraryBookDetail } from './lib/api'
import BookDetail from './BookDetail'

const mocks = vi.hoisted(() => ({
  getLibraryBook: vi.fn(),
  updateLibraryStatus: vi.fn(),
  updateLibraryRecord: vi.fn(),
  updateReadingProgress: vi.fn(),
  deleteLibraryBook: vi.fn(),
  getReadingLogs: vi.fn(),
  checkReadingToday: vi.fn(),
  cancelReadingToday: vi.fn(),
  checkReadingDate: vi.fn(),
  getReadingSessions: vi.fn(),
  getReadingNotes: vi.fn(),
  createReadingNote: vi.fn(),
  getShelves: vi.fn(),
  addBookToShelf: vi.fn(),
  removeBookFromShelf: vi.fn(),
}))

vi.mock('./lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/api')>(),
  ...mocks,
}))
// 환경변수 없는 CI에서도 실제 Supabase 클라이언트를 만들지 않는다.
vi.mock('./lib/supabase', () => ({ supabase: { auth: {} } }))
vi.mock('./lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/auth')>(),
  withAccessToken: (request: (token: string) => Promise<unknown>) => request('test-token'),
}))

// BE 규칙: 중단은 읽는 중·중단에서, 포기는 읽는 중·중단·포기에서, 나머지는 언제나 요청할 수 있다.
function allowedFor(status: LibraryBookDetail['status']): LibraryBookDetail['allowed_statuses'] {
  const base: LibraryBookDetail['allowed_statuses'] = ['want_to_read', 'reading', 'completed']
  if (status === 'reading' || status === 'paused') return [...base, 'paused', 'abandoned']
  if (status === 'abandoned') return [...base, 'abandoned']
  return base
}

function detail(overrides: Partial<LibraryBookDetail> = {}): LibraryBookDetail {
  const status = overrides.status ?? 'reading'
  return {
    id: 'user-book-1',
    book_id: 'book-1',
    isbn13: '9788936433598',
    title: '소년이 온다',
    authors: ['한강'],
    thumbnail_url: null,
    status: 'reading',
    created_at: '2026-10-01T00:00:00Z',
    page_count: null,
    total_pages: null,
    current_page: null,
    progress_percent: null,
    publisher: null,
    published_date: '2014-05-19',
    description: null,
    source_url: 'https://example.test',
    started_at: '2026-10-01T03:00:00Z',
    last_read_at: null,
    last_read_date: null,
    completed_at: null,
    stopped_at: null,
    stop_reason: null,
    rating: null,
    memo: '첫 메모',
    is_review_public: false,
    review_published_at: null,
    review_updated_at: null,
    has_completed: false,
    updated_at: '2026-10-01T00:00:00Z',
    allowed_statuses: allowedFor(status),
    shelves: [],
    past_log_range: null,
    ...overrides,
  }
}

function renderDetail() {
  render(
    <MemoryRouter initialEntries={['/books/user-book-1']}>
      <Routes>
        <Route path="/books/:userBookId" element={<BookDetail userId="user-a" />} />
        <Route path="/" element={<p>서재 화면</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

test('상세에는 책장·타이머를 표시하지 않고 비활성인 현재 상태도 별도로 강조한다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail({ status: 'want_to_read' }))
  renderDetail()
  await screen.findByRole('heading', { name: '소년이 온다' })
  expect(screen.queryByRole('heading', { name: '책장' })).toBeNull()
  expect(screen.queryByRole('heading', { name: '독서 타이머' })).toBeNull()
  expect(screen.getByRole('radio', { name: /읽고 싶음/ }).closest('label')?.classList.contains('is-current')).toBe(true)
})

test('최근 체크는 버튼을 누른 시각이 아니라 실제 읽은 날짜를 표시한다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail({ last_read_at: '2026-10-28T03:00:00Z', last_read_date: '2026-10-25' }))
  renderDetail()
  await screen.findByRole('heading', { name: '소년이 온다' })
  expect(screen.getByText('최근 체크').nextElementSibling?.textContent).toBe('2026년 10월 25일')
})

test('과거 읽은 날은 past_log_range가 있을 때만 보이고, 완독 상태만으로 만들지 않는다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail({ status: 'completed', completed_at: '2025-02-20T03:00:00Z' }))
  renderDetail()
  await screen.findByRole('heading', { name: '소년이 온다' })
  expect(screen.queryByRole('heading', { name: '과거 읽은 날' })).toBeNull()
})

test('과거 읽은 날 체크 후 상세를 다시 불러와 최근 체크와 범위를 서버 기준으로 바꾼다', async () => {
  const range = { start: '2025-02-10', end: '2025-02-20' }
  mocks.getLibraryBook
    .mockResolvedValueOnce(detail({ status: 'completed', completed_at: '2025-02-20T03:00:00Z', past_log_range: range }))
    .mockResolvedValueOnce(detail({ status: 'completed', completed_at: '2025-02-20T03:00:00Z', past_log_range: range, last_read_date: '2025-02-15' }))
  mocks.getReadingLogs.mockResolvedValue([])
  renderDetail()
  const grid = await screen.findByRole('group', { name: '2025년 2월 읽은 날' })
  fireEvent.click(within(grid).getByRole('button', { name: '2025년 2월 15일' }))
  await waitFor(() => expect(screen.getByText('최근 체크').nextElementSibling?.textContent).toBe('2025년 2월 15일'))
  expect(mocks.checkReadingDate).toHaveBeenCalledWith('test-token', 'user-book-1', '2025-02-15')
  expect(mocks.getLibraryBook).toHaveBeenCalledTimes(2)
})

test('메모는 기본 비공개이며 직접 선택해 저장해야 공개한다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail())
  renderDetail()
  const checkbox = await screen.findByRole('checkbox', { name: '메모와 별점 공개' })
  expect((checkbox as HTMLInputElement).checked).toBe(false)
  fireEvent.click(checkbox)
  fireEvent.click(screen.getByRole('button', { name: '기록 저장' }))
  await waitFor(() => expect(mocks.updateLibraryRecord).toHaveBeenCalledWith('test-token', 'user-book-1', { is_review_public: true }))
})

test('공개된 메모를 비우면 공개 선택을 끄고, 다시 입력해도 자동 공개하지 않는다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail({ is_review_public: true, review_published_at: '2026-11-02T00:00:00Z', review_updated_at: '2026-11-02T00:00:00Z' }))
  renderDetail()
  const memo = await screen.findByLabelText('메모')
  fireEvent.change(memo, { target: { value: '   ' } })
  const checkbox = screen.getByRole('checkbox', { name: '메모와 별점 공개' }) as HTMLInputElement
  expect(checkbox.checked).toBe(false)
  expect(checkbox.disabled).toBe(true)
  fireEvent.change(memo, { target: { value: '새 메모' } })
  expect(checkbox.checked).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '기록 저장' }))
  await waitFor(() => expect(mocks.updateLibraryRecord).toHaveBeenCalledWith('test-token', 'user-book-1', { memo: '새 메모', is_review_public: false }))
})

test('공개 전환 저장 실패 시 공개 선택과 메모 입력을 보존한다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail())
  mocks.updateLibraryRecord.mockRejectedValue(new ApiError(503))
  renderDetail()
  fireEvent.click(await screen.findByRole('checkbox', { name: '메모와 별점 공개' }))
  fireEvent.click(screen.getByRole('button', { name: '기록 저장' }))
  await screen.findByText(/입력은 그대로 두었으니/)
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
  expect((screen.getByLabelText('메모') as HTMLTextAreaElement).value).toBe('첫 메모')
})

test('공개 설정만 수정해도 책 정보로 이동하기 전에 미저장 경고를 보여준다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail())
  renderDetail()
  fireEvent.click(await screen.findByRole('checkbox', { name: '메모와 별점 공개' }))
  fireEvent.click(screen.getByRole('link', { name: '책 정보·공개 후기 보기' }))
  const dialog = screen.getByRole('dialog', { name: '저장하지 않은 기록이 있습니다' })
  fireEvent.click(within(dialog).getByRole('button', { name: '취소' }))
  expect(mocks.updateLibraryRecord).not.toHaveBeenCalled()
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
})

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getReadingSessions.mockResolvedValue([])
  mocks.getReadingNotes.mockResolvedValue([])
  mocks.getShelves.mockResolvedValue([])
  mocks.getReadingLogs.mockResolvedValue([])
  // 한국 시간 2026-10-28 12:00으로 고정해 '오늘' 계산을 안정시킨다.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-28T03:00:00Z'))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

test('서재 id로 상세를 조회하고 없는 날짜·별점을 채우지 않는다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail())
  renderDetail()

  await screen.findByRole('heading', { name: '소년이 온다' })
  expect(mocks.getLibraryBook).toHaveBeenCalledWith('test-token', 'user-book-1')
  expect(screen.getAllByText('없음').length).toBeGreaterThanOrEqual(3)
  expect(screen.getByRole('button', { name: '별점 지우기' })).toHaveProperty('disabled', true)
})

test('404는 타인 기록과 구분하지 않고 안내만 한다', async () => {
  mocks.getLibraryBook.mockRejectedValue(new ApiError(404))
  renderDetail()

  expect((await screen.findByRole('alert')).textContent).toContain('서재에서 이 책을 찾을 수 없습니다')
  expect(mocks.getLibraryBook).toHaveBeenCalledTimes(1)
})

test('기록 저장은 바뀐 필드만 보내고 성공 후 상세를 다시 조회한다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail())
  mocks.updateLibraryRecord.mockResolvedValue(undefined)
  renderDetail()

  fireEvent.click(await screen.findByRole('radio', { name: '4점' }))
  fireEvent.click(screen.getByRole('button', { name: '기록 저장' }))

  await waitFor(() => expect(mocks.getLibraryBook).toHaveBeenCalledTimes(2))
  expect(mocks.updateLibraryRecord).toHaveBeenCalledWith('test-token', 'user-book-1', { rating: 4 })
})

test('저장 실패 시 입력을 보존하고 409를 안내한다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail())
  mocks.updateLibraryRecord.mockRejectedValue(new ApiError(409))
  renderDetail()

  const memo = await screen.findByLabelText('메모')
  fireEvent.change(memo, { target: { value: '고친 메모' } })
  fireEvent.click(screen.getByRole('button', { name: '기록 저장' }))

  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('바꿀 수 없거나'))
  expect((memo as HTMLTextAreaElement).value).toBe('고친 메모')
})

test('완독을 고르면 기존 시작일과 오늘을 채우고, 그대로 두면 날짜를 보내지 않는다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail())
  mocks.updateLibraryStatus.mockResolvedValue(undefined)
  renderDetail()

  fireEvent.click(await screen.findByRole('radio', { name: /^완독/ }))
  // 기존 시작일 2026-10-01T03:00Z는 한국 날짜 10월 1일이다.
  expect(screen.getByRole('button', { name: '시작일 (선택) 2026년 10월 1일' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '완독일 (선택) 2026년 10월 28일' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '상태 바꾸기' }))

  await waitFor(() => expect(mocks.updateLibraryStatus).toHaveBeenCalledTimes(1))
  expect(mocks.updateLibraryStatus).toHaveBeenCalledWith('test-token', 'user-book-1', {
    status: 'completed',
  })
})

test('완독일을 바꾸면 그 한국 날짜로 보내고 시작일은 그대로 생략한다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail())
  mocks.updateLibraryStatus.mockResolvedValue(undefined)
  renderDetail()

  fireEvent.click(await screen.findByRole('radio', { name: /^완독/ }))
  fireEvent.click(screen.getByRole('button', { name: /^완독일/ }))
  fireEvent.click(screen.getByRole('button', { name: '2026년 10월 20일' }))
  fireEvent.click(screen.getByRole('button', { name: '상태 바꾸기' }))

  await waitFor(() => expect(mocks.updateLibraryStatus).toHaveBeenCalledTimes(1))
  expect(mocks.updateLibraryStatus).toHaveBeenCalledWith('test-token', 'user-book-1', {
    status: 'completed',
    completed_date: '2026-10-20',
  })
})

test.each([
  ['started_date', '시작일'],
  ['completed_date', '완독일'],
])('서버가 %s를 미래로 거부하면 한국어로 안내하고 날짜·메모를 보존한다', async (field, label) => {
  mocks.getLibraryBook.mockResolvedValue(detail())
  mocks.updateLibraryStatus.mockRejectedValue(new ApiError(422, `${field} must not be in the future`, 'future_date'))
  renderDetail()

  fireEvent.click(await screen.findByRole('radio', { name: /^완독/ }))
  fireEvent.change(screen.getByLabelText('메모'), { target: { value: '저장 전 메모' } })
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }))
  // 기기에서는 과거로 보여도 서버 오늘보다 미래일 수 있다.
  fireEvent.click(screen.getByRole('button', { name: '2026년 10월 20일' }))
  fireEvent.click(screen.getByRole('button', { name: '상태 바꾸기' }))

  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('오늘 이후 날짜는 선택할 수 없어요'))
  expect(screen.getByRole('status').textContent).not.toContain('must not be in the future')
  expect(screen.getByRole('button', { name: `${label} (선택) 2026년 10월 20일` })).toBeTruthy()
  expect(screen.getByRole('radio', { name: /^완독/ })).toHaveProperty('checked', true)
  expect(screen.getByLabelText('메모')).toHaveProperty('value', '저장 전 메모')
  expect(screen.getByRole('button', { name: '상태 바꾸기' })).toHaveProperty('disabled', false)
  expect(mocks.updateLibraryStatus).toHaveBeenCalledTimes(1)
  expect(mocks.updateLibraryStatus).toHaveBeenCalledWith('test-token', 'user-book-1', { status: 'completed', [field]: '2026-10-20' })
  expect(mocks.getLibraryBook).toHaveBeenCalledTimes(1)
})

test('읽고 싶음에서 바로 완독하면 완독일을 채우지 않는다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail({ status: 'want_to_read', started_at: null }))
  renderDetail()

  fireEvent.click(await screen.findByRole('radio', { name: /^완독/ }))
  expect(screen.getByRole('button', { name: '시작일 (선택) 날짜 선택' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '완독일 (선택) 날짜 선택' })).toBeTruthy()
})

test('저장 성공 뒤 다시 조회가 실패해도 화면과 입력을 유지한다', async () => {
  mocks.getLibraryBook
    .mockResolvedValueOnce(detail())
    .mockRejectedValueOnce(new ApiError(503))
  mocks.updateLibraryRecord.mockResolvedValue(undefined)
  renderDetail()

  fireEvent.change(await screen.findByLabelText('메모'), { target: { value: '새 메모' } })
  fireEvent.click(screen.getByRole('button', { name: '기록 저장' }))

  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('잠시 응답할 수 없습니다'))
  expect(screen.getByRole('heading', { name: '소년이 온다' })).toBeTruthy()
  expect((screen.getByLabelText('메모') as HTMLTextAreaElement).value).toBe('새 메모')
})

test('공개 저장 후 상세 재조회가 끝날 때까지 잠그고, 이후 해제는 false를 전송한다', async () => {
  let finish!: (value: LibraryBookDetail) => void
  const published = detail({ is_review_public: true, review_published_at: '2026-10-28T03:00:00Z', review_updated_at: '2026-10-28T03:00:00Z' })
  mocks.getLibraryBook.mockResolvedValueOnce(detail())
    .mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    .mockResolvedValueOnce(detail())
  mocks.updateLibraryRecord.mockResolvedValue(undefined)
  renderDetail()
  const checkbox = await screen.findByRole('checkbox', { name: '메모와 별점 공개' }) as HTMLInputElement
  fireEvent.click(checkbox)
  fireEvent.click(screen.getByRole('button', { name: '기록 저장' }))
  await waitFor(() => expect(mocks.getLibraryBook).toHaveBeenCalledTimes(2))
  expect(checkbox.disabled).toBe(true)
  expect((screen.getByRole('button', { name: '저장하는 중…' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => finish(published))
  expect(checkbox.disabled).toBe(false)
  fireEvent.click(checkbox)
  fireEvent.click(screen.getByRole('button', { name: '기록 저장' }))
  await waitFor(() => expect(mocks.updateLibraryRecord).toHaveBeenCalledTimes(2))
  expect(mocks.updateLibraryRecord).toHaveBeenLastCalledWith('test-token', 'user-book-1', { is_review_public: false })
})

test.each(['success', 'timeout'])('저장 후 재조회 실패는 재저장을 막고 재확인 뒤 공개 해제를 보낸다: %s', async (result) => {
  const published = detail({ is_review_public: true, review_published_at: '2026-10-28T03:00:00Z', review_updated_at: '2026-10-28T03:00:00Z' })
  mocks.getLibraryBook.mockResolvedValueOnce(detail())
    .mockRejectedValueOnce(new ApiError(503))
    .mockResolvedValueOnce(published)
    .mockResolvedValueOnce(detail())
  if (result === 'timeout') mocks.updateLibraryRecord.mockRejectedValueOnce(new ApiError(504)).mockResolvedValue(undefined)
  else mocks.updateLibraryRecord.mockResolvedValue(undefined)
  renderDetail()
  const checkbox = await screen.findByRole('checkbox', { name: '메모와 별점 공개' }) as HTMLInputElement
  fireEvent.click(checkbox)
  fireEvent.click(screen.getByRole('button', { name: '기록 저장' }))
  await screen.findByText(/잠시 응답할 수 없습니다/)
  expect((screen.getByRole('button', { name: '기록 저장' }) as HTMLButtonElement).disabled).toBe(true)
  expect(checkbox.checked).toBe(true)
  expect((screen.getByLabelText('메모') as HTMLTextAreaElement).value).toBe('첫 메모')
  expect(mocks.updateLibraryRecord).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: '최신 상태 다시 확인' }))
  await waitFor(() => expect(checkbox.disabled).toBe(false))
  expect(screen.queryByText(/잠시 응답할 수 없습니다/)).toBeNull()
  fireEvent.click(checkbox)
  fireEvent.click(screen.getByRole('button', { name: '기록 저장' }))
  await waitFor(() => expect(mocks.updateLibraryRecord).toHaveBeenCalledTimes(2))
  expect(mocks.updateLibraryRecord).toHaveBeenLastCalledWith('test-token', 'user-book-1', { is_review_public: false })
})

test('504 저장은 다시 보내지 않고 서버 상태를 다시 조회한다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail())
  mocks.updateLibraryStatus.mockRejectedValue(new ApiError(504))
  renderDetail()

  fireEvent.click(await screen.findByRole('radio', { name: /^완독/ }))
  fireEvent.click(screen.getByRole('button', { name: '상태 바꾸기' }))

  await waitFor(() => expect(mocks.getLibraryBook).toHaveBeenCalledTimes(2))
  expect(mocks.updateLibraryStatus).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('status').textContent).toContain('저장 결과를 확인하지 못했습니다')
})

test('숨겨진 중단 사유는 기록 저장에 포함하지 않는다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail())
  mocks.updateLibraryRecord.mockResolvedValue(undefined)
  renderDetail()

  fireEvent.click(await screen.findByRole('radio', { name: '5점' }))
  fireEvent.click(screen.getByRole('button', { name: '기록 저장' }))

  await waitFor(() => expect(mocks.updateLibraryRecord).toHaveBeenCalledTimes(1))
  expect(screen.queryByLabelText('중단 사유')).toBeNull()
  expect(mocks.updateLibraryRecord.mock.calls[0][2]).toEqual({ rating: 5 })
})

test('읽고 싶음 전환과 삭제는 확인창에서 취소하면 요청하지 않는다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail())
  renderDetail()

  fireEvent.click(await screen.findByRole('radio', { name: /^읽고 싶음/ }))
  fireEvent.click(screen.getByRole('button', { name: '상태 바꾸기' }))
  const reset = screen.getByRole('dialog', { name: '읽고 싶음으로 되돌릴까요?' })
  expect(reset.textContent).toContain('완독일·별점·메모와 공개 후기도 초기화')
  fireEvent.click(within(reset).getByRole('button', { name: '취소' }))

  fireEvent.click(screen.getByRole('button', { name: '서재에서 빼기' }))
  const remove = screen.getByRole('dialog', { name: /서재에서 뺄까요/ })
  expect(remove.textContent).toContain('독서 노트와 공개 후기도 함께 삭제되고 책장에서도 빠지며')
  fireEvent.click(within(remove).getByRole('button', { name: '취소' }))

  expect(mocks.updateLibraryStatus).not.toHaveBeenCalled()
  expect(mocks.deleteLibraryBook).not.toHaveBeenCalled()
})

test('확인창에서 동의하면 삭제(204) 후 서재로 이동한다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail())
  mocks.deleteLibraryBook.mockResolvedValue(undefined)
  renderDetail()

  fireEvent.click(await screen.findByRole('button', { name: '서재에서 빼기' }))
  const remove = screen.getByRole('dialog', { name: /서재에서 뺄까요/ })
  fireEvent.click(within(remove).getByRole('button', { name: '서재에서 빼기' }))

  await screen.findByText('서재 화면')
  expect(mocks.deleteLibraryBook).toHaveBeenCalledWith('test-token', 'user-book-1')
})

test('중단은 읽는 중일 때만 고를 수 있다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail({ status: 'want_to_read' }))
  renderDetail()

  expect(await screen.findByRole('radio', { name: /^중단/ })).toHaveProperty('disabled', true)
})

function todayLog(userBookId = 'user-book-1') {
  return {
    id: 'log-1', user_book_id: userBookId, read_date: '2026-10-28', created_at: '2026-10-28T03:00:00Z',
    book_id: 'book-1', title: '소년이 온다', authors: [], thumbnail_url: null,
  }
}

test('오늘 체크는 한국 오늘 날짜의 기록으로 판단하고, 다른 책의 기록은 무시한다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail())
  mocks.getReadingLogs.mockResolvedValue([todayLog('other-book')])
  renderDetail()

  await screen.findByRole('button', { name: '오늘 읽었어요' })
  expect(mocks.getReadingLogs).toHaveBeenCalledWith('test-token', '2026-10-28', '2026-10-28')
})

test('오늘 읽었어요를 누르면 체크 후 오늘 기록과 상세를 다시 조회한다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail())
  mocks.getReadingLogs.mockResolvedValueOnce([]).mockResolvedValue([todayLog()])
  mocks.checkReadingToday.mockResolvedValue(todayLog())
  renderDetail()

  fireEvent.click(await screen.findByRole('button', { name: '오늘 읽었어요' }))

  await screen.findByText('오늘 읽은 날로 남겼어요')
  expect(mocks.checkReadingToday).toHaveBeenCalledTimes(1)
  expect(mocks.getLibraryBook).toHaveBeenCalledTimes(2)
})

test('읽는 중이 아니어도 남은 오늘 체크는 취소할 수 있다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail({ status: 'paused' }))
  mocks.getReadingLogs.mockResolvedValueOnce([todayLog()]).mockResolvedValue([])
  mocks.cancelReadingToday.mockResolvedValue(undefined)
  renderDetail()

  fireEvent.click(await screen.findByRole('button', { name: '체크 취소' }))

  await screen.findByText('읽는 중인 책만 오늘 체크할 수 있습니다.')
  expect(mocks.cancelReadingToday).toHaveBeenCalledWith('test-token', 'user-book-1')
})

test('체크 409는 상태 안내로 바꾸고 다시 보내지 않는다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail())
  mocks.checkReadingToday.mockRejectedValue(new ApiError(409))
  renderDetail()

  fireEvent.click(await screen.findByRole('button', { name: '오늘 읽었어요' }))

  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('읽는 중인 책만 오늘 체크'))
  expect(mocks.checkReadingToday).toHaveBeenCalledTimes(1)
})

test('오늘 체크의 date_order도 상태 날짜 오류와 구분해 안내한다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail())
  mocks.checkReadingToday.mockRejectedValue(new ApiError(409, '', 'date_order'))
  renderDetail()
  fireEvent.click(await screen.findByRole('button', { name: '오늘 읽었어요' }))
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('현재 독서 시작일보다 이전 날짜에는 체크할 수 없어요.'))
  expect(mocks.checkReadingToday).toHaveBeenCalledTimes(1)
})

test('읽는 중인 책은 상태를 그대로 두고 바꾼 시작일만 보낸다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail())
  mocks.updateLibraryStatus.mockResolvedValue(undefined)
  renderDetail()

  fireEvent.click(await screen.findByRole('radio', { name: /^읽는 중.*날짜 고치기/ }))
  fireEvent.click(screen.getByRole('button', { name: '시작일 (선택) 2026년 10월 1일' }))
  fireEvent.click(screen.getByRole('button', { name: '2026년 10월 2일' }))
  fireEvent.click(screen.getByRole('button', { name: '날짜 고치기' }))

  await waitFor(() => expect(mocks.updateLibraryStatus).toHaveBeenCalledTimes(1))
  expect(mocks.updateLibraryStatus).toHaveBeenCalledWith('test-token', 'user-book-1', {
    status: 'reading',
    started_date: '2026-10-02',
  })
})

test('날짜를 바꾸지 않은 날짜 고치기는 요청하지 않는다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail())
  renderDetail()

  fireEvent.click(await screen.findByRole('radio', { name: /^읽는 중/ }))
  fireEvent.click(screen.getByRole('button', { name: '날짜 고치기' }))

  expect(screen.getByRole('status').textContent).toContain('바뀐 날짜가 없습니다')
  expect(mocks.updateLibraryStatus).not.toHaveBeenCalled()
})

test('완독한 책의 날짜 고치기는 오늘이 아닌 기존 완독일을 채운다', async () => {
  mocks.getLibraryBook.mockResolvedValue(
    detail({ status: 'completed', completed_at: '2026-10-10T05:00:00Z', has_completed: true }),
  )
  renderDetail()

  fireEvent.click(await screen.findByRole('radio', { name: /^완독/ }))
  expect(screen.getByRole('button', { name: '완독일 (선택) 2026년 10월 10일' })).toBeTruthy()
})

test('중단·포기 상태는 현재 상태로 날짜를 고칠 수 없다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail({ status: 'paused' }))
  renderDetail()

  expect(await screen.findByRole('radio', { name: /^중단/ })).toHaveProperty('disabled', true)
})

test('완독한 책을 다시 읽으면 새 독서로 보고 시작일을 비워 오늘부터 시작한다', async () => {
  mocks.getLibraryBook.mockResolvedValue(
    detail({ status: 'completed', completed_at: '2026-10-10T05:00:00Z', has_completed: true }),
  )
  mocks.updateLibraryStatus.mockResolvedValue(undefined)
  renderDetail()

  fireEvent.click(await screen.findByRole('radio', { name: /^읽는 중/ }))
  expect(screen.getByRole('button', { name: '시작일 (선택) 날짜 선택' })).toBeTruthy()
  expect(screen.getByText(/오늘부터 시작하고, 이전 완독일은 유지됩니다/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '상태 바꾸기' }))

  await waitFor(() => expect(mocks.updateLibraryStatus).toHaveBeenCalledTimes(1))
  expect(mocks.updateLibraryStatus.mock.calls[0][2]).toEqual({ status: 'reading' })
})

test('다시 읽을 때 시작일을 직접 고르면 그 날짜를 보낸다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail({ status: 'abandoned' }))
  mocks.updateLibraryStatus.mockResolvedValue(undefined)
  renderDetail()

  fireEvent.click(await screen.findByRole('radio', { name: /^읽는 중/ }))
  fireEvent.click(screen.getByRole('button', { name: '시작일 (선택) 날짜 선택' }))
  fireEvent.click(screen.getByRole('button', { name: '2026년 10월 20일' }))
  fireEvent.click(screen.getByRole('button', { name: '상태 바꾸기' }))

  await waitFor(() => expect(mocks.updateLibraryStatus).toHaveBeenCalledTimes(1))
  expect(mocks.updateLibraryStatus.mock.calls[0][2]).toEqual({
    status: 'reading',
    started_date: '2026-10-20',
  })
})

test('중단 후 재개는 미리 채운 시작일을 바꾸지 않으면 보내지 않는다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail({ status: 'paused' }))
  mocks.updateLibraryStatus.mockResolvedValue(undefined)
  renderDetail()

  fireEvent.click(await screen.findByRole('radio', { name: /^읽는 중/ }))
  fireEvent.click(screen.getByRole('button', { name: '상태 바꾸기' }))

  await waitFor(() => expect(mocks.updateLibraryStatus).toHaveBeenCalledTimes(1))
  expect(mocks.updateLibraryStatus.mock.calls[0][2]).toEqual({ status: 'reading' })
})

test('오늘로 채운 완독일을 연 채 한국 자정을 넘기면 화면의 날짜를 보낸다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail())
  mocks.updateLibraryStatus.mockResolvedValue(undefined)
  renderDetail()

  fireEvent.click(await screen.findByRole('radio', { name: /^완독/ }))
  // 한국 시간 2026-10-29 00:01로 넘어가고 창으로 돌아온다.
  vi.setSystemTime(new Date('2026-10-28T15:01:00Z'))
  act(() => { window.dispatchEvent(new Event('focus')) })
  fireEvent.click(screen.getByRole('button', { name: '상태 바꾸기' }))

  await waitFor(() => expect(mocks.updateLibraryStatus).toHaveBeenCalledTimes(1))
  expect(mocks.updateLibraryStatus.mock.calls[0][2]).toEqual({
    status: 'completed',
    completed_date: '2026-10-28',
  })
})

test('저장하지 않은 기록이 있을 때만 새로고침 전에 경고한다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail())
  renderDetail()

  const memo = await screen.findByLabelText('메모')
  const before = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(before)
  expect(before.defaultPrevented).toBe(false)

  fireEvent.change(memo, { target: { value: '아직 저장 안 한 메모' } })
  const dirty = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(dirty)
  expect(dirty.defaultPrevented).toBe(true)
})

test('고를 수 있는 상태는 서버의 allowed_statuses를 따른다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail({ allowed_statuses: ['want_to_read', 'completed'] }))
  renderDetail()

  expect(await screen.findByRole('radio', { name: /^완독/ })).toHaveProperty('disabled', false)
  expect(screen.getByRole('radio', { name: /^중단/ })).toHaveProperty('disabled', true)
  expect(screen.getByRole('radio', { name: /^포기/ })).toHaveProperty('disabled', true)
})

test('오류 code가 있으면 원인별 한국어로 안내한다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail())
  mocks.updateLibraryStatus.mockRejectedValue(new ApiError(409, 'Final reading start must not be after completion', 'date_order'))
  renderDetail()

  fireEvent.click(await screen.findByRole('radio', { name: /^완독/ }))
  fireEvent.click(screen.getByRole('button', { name: '상태 바꾸기' }))

  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('날짜 순서가 올바르지 않습니다'))
  expect(screen.getByRole('status').textContent).not.toContain('Final reading')
  // 409는 화면이 오래된 상태라는 뜻이므로 서버 기준으로 다시 불러온다.
  await waitFor(() => expect(mocks.getLibraryBook).toHaveBeenCalledTimes(2))
})

test('독서 노트는 공개 후기 메모와 따로 저장하고 독서 체크를 만들지 않는다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail({ memo: '공개 후기 메모' }))
  mocks.createReadingNote.mockResolvedValue({
    id: 'note-1', user_book_id: 'user-book-1', note_date: '2026-10-28', quote: '문장', thought: null, page: null,
    created_at: '2026-10-28T03:00:00Z', updated_at: '2026-10-28T03:00:00Z',
  })
  renderDetail()
  fireEvent.click(await screen.findByRole('button', { name: '노트 쓰기' }))
  fireEvent.change(screen.getByLabelText('인상 깊은 문구'), { target: { value: '문장' } })
  fireEvent.click(screen.getByRole('button', { name: '노트 저장' }))

  await screen.findByText('노트를 저장했습니다.')
  expect(mocks.createReadingNote).toHaveBeenCalledWith('test-token', 'user-book-1', { note_date: '2026-10-28', quote: '문장', thought: null, page: null })
  expect(mocks.updateLibraryRecord).not.toHaveBeenCalled()
  expect(mocks.checkReadingToday).not.toHaveBeenCalled()
  expect(screen.getByLabelText('메모')).toHaveProperty('value', '공개 후기 메모')
})

const reading = { status: 'reading' as const, page_count: 300, total_pages: null, current_page: 120, progress_percent: 40 }
const progressCard = () => screen.getByRole('heading', { name: '읽기 진도' }).closest('form') as HTMLFormElement

test('진도는 서버 %와 쪽을 보여 주고, 바뀐 칸만 보낸 뒤 상세를 다시 불러와 입력을 맞춘다', async () => {
  mocks.getLibraryBook.mockResolvedValueOnce(detail(reading))
    .mockResolvedValueOnce(detail({ ...reading, current_page: 150, progress_percent: 50 }))
  mocks.updateReadingProgress.mockResolvedValueOnce(undefined)
  renderDetail()
  await screen.findByText('40%')
  const card = within(progressCard())
  expect(card.getByText('120 / 300쪽')).toBeTruthy()
  expect(card.getByText(/비워 두면 도서 정보의 300쪽을 써요/)).toBeTruthy()

  fireEvent.click(card.getByRole('button', { name: '진도 저장' }))
  expect(await screen.findByText('바뀐 진도가 없습니다.')).toBeTruthy()
  expect(mocks.updateReadingProgress).not.toHaveBeenCalled()

  fireEvent.change(card.getByLabelText('현재 쪽'), { target: { value: '150' } })
  fireEvent.click(card.getByRole('button', { name: '진도 저장' }))
  await screen.findByText('진도를 저장했습니다.')
  expect(mocks.updateReadingProgress).toHaveBeenCalledWith('test-token', 'user-book-1', { current_page: 150 })
  await screen.findByText('50%')
  expect(mocks.getLibraryBook).toHaveBeenCalledTimes(2)
  expect((within(progressCard()).getByLabelText('현재 쪽') as HTMLInputElement).value).toBe('150')
})

test('전체 쪽수를 모르면 진도를 숨기고 %를 막으며, 쪽수 없이 현재 쪽을 보내지 않는다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail({ ...reading, page_count: null, current_page: null, progress_percent: null }))
  renderDetail()
  await screen.findByText(/전체 쪽수를 몰라 진도를 표시하지 않아요/)
  const card = within(progressCard())
  expect(card.getByRole('radio', { name: '%' })).toHaveProperty('disabled', true)
  fireEvent.change(card.getByLabelText('현재 쪽'), { target: { value: '10' } })
  fireEvent.click(card.getByRole('button', { name: '진도 저장' }))
  expect(card.getByText('전체 쪽수를 먼저 입력해주세요.')).toBeTruthy()
  expect(document.activeElement).toBe(card.getByLabelText('현재 쪽'))
  expect(mocks.updateReadingProgress).not.toHaveBeenCalled()

  // 전체 쪽수와 현재 쪽을 함께 보내면 새 전체 쪽수로 검사한다.
  mocks.updateReadingProgress.mockResolvedValueOnce(undefined)
  fireEvent.change(card.getByLabelText('전체 쪽수'), { target: { value: '200' } })
  fireEvent.click(card.getByRole('button', { name: '진도 저장' }))
  await waitFor(() => expect(mocks.updateReadingProgress).toHaveBeenCalledWith('test-token', 'user-book-1', { total_pages: 200, current_page: 10 }))
})

test('%로 입력하면 반영 후 전체 쪽수로 반올림해 쪽을 보낸다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail({ ...reading, page_count: 301 }))
  mocks.updateReadingProgress.mockResolvedValueOnce(undefined)
  renderDetail()
  await screen.findByText('40%')
  const card = within(progressCard())
  fireEvent.click(card.getByRole('radio', { name: '%' }))
  expect((card.getByLabelText('현재 진도(%)') as HTMLInputElement).value).toBe('40')
  fireEvent.change(card.getByLabelText('현재 진도(%)'), { target: { value: '50' } })
  fireEvent.click(card.getByRole('button', { name: '진도 저장' }))
  await waitFor(() => expect(mocks.updateReadingProgress).toHaveBeenCalledWith('test-token', 'user-book-1', { current_page: 151 }))
})

test('진도 422는 다시 불러와도 서버 값이 같아 입력을 보존하고, 409는 바뀐 최신 상태를 보여 준다', async () => {
  mocks.getLibraryBook.mockResolvedValueOnce(detail(reading)).mockResolvedValueOnce(detail(reading))
  mocks.updateReadingProgress
    .mockRejectedValueOnce(new ApiError(422, 'current_page must be at most 300', 'page_out_of_range'))
    .mockRejectedValueOnce(new ApiError(409, 'not allowed', 'progress_not_allowed'))
  renderDetail()
  await screen.findByText('40%')
  fireEvent.change(within(progressCard()).getByLabelText('현재 쪽'), { target: { value: '200' } })
  fireEvent.click(within(progressCard()).getByRole('button', { name: '진도 저장' }))
  expect(await screen.findByText(/쪽수 범위를 확인해주세요/)).toBeTruthy()
  await waitFor(() => expect(mocks.getLibraryBook).toHaveBeenCalledTimes(2))
  expect((within(progressCard()).getByLabelText('현재 쪽') as HTMLInputElement).value).toBe('200')

  mocks.getLibraryBook.mockResolvedValueOnce(detail({ ...reading, status: 'completed', current_page: 300, progress_percent: 100 }))
  fireEvent.click(within(progressCard()).getByRole('button', { name: '진도 저장' }))
  expect(await screen.findByText('읽는 중·중단·포기 상태에서만 현재 쪽을 기록할 수 있어요. 최신 상태를 불러왔습니다.')).toBeTruthy()
  await screen.findByText('완독한 책은 100%로 표시돼요.')
  expect(within(progressCard()).queryByLabelText('현재 쪽')).toBeNull()
  expect(mocks.updateReadingProgress).toHaveBeenCalledTimes(2)
})

test('진도 저장 결과가 불명확하면 다시 보내지 않고, 다시 불러온 서버 값으로 입력을 맞춘다', async () => {
  // 다른 기기에서 140쪽으로 바뀐 상태라면 보내려던 150이 아니라 서버 값을 보여 준다.
  mocks.getLibraryBook.mockResolvedValueOnce(detail(reading)).mockResolvedValueOnce(detail({ ...reading, current_page: 140, progress_percent: 46 }))
  mocks.updateReadingProgress.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  renderDetail()
  await screen.findByText('40%')
  fireEvent.change(within(progressCard()).getByLabelText('현재 쪽'), { target: { value: '150' } })
  fireEvent.click(within(progressCard()).getByRole('button', { name: '진도 저장' }))
  await screen.findByText('46%')
  expect((within(progressCard()).getByLabelText('현재 쪽') as HTMLInputElement).value).toBe('140')
  expect(mocks.updateReadingProgress).toHaveBeenCalledTimes(1)
  expect(mocks.getLibraryBook).toHaveBeenCalledTimes(2)
})

test('읽고 싶음은 전체 쪽수만 받고, 초기화 안내에 현재 쪽 삭제·전체 쪽수 유지를 알린다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail({ ...reading, status: 'reading', current_page: 120 }))
  renderDetail()
  await screen.findByText('40%')
  fireEvent.click(screen.getByRole('radio', { name: /읽고 싶음/ }))
  fireEvent.click(screen.getByRole('button', { name: '상태 바꾸기' }))
  expect(screen.getByRole('dialog', { name: '읽고 싶음으로 되돌릴까요?', hidden: true }).textContent).toContain('현재 쪽')
  expect(screen.getByRole('dialog', { name: '읽고 싶음으로 되돌릴까요?', hidden: true }).textContent).toContain('전체 쪽수는 유지됩니다')
  cleanup()

  mocks.getLibraryBook.mockResolvedValue(detail({ ...reading, status: 'want_to_read', current_page: null, progress_percent: null }))
  renderDetail()
  await screen.findByText('읽기 시작하면 현재 쪽을 기록할 수 있어요.')
  expect(within(progressCard()).queryByLabelText('현재 쪽')).toBeNull()
  expect(within(progressCard()).getByLabelText('전체 쪽수')).toBeTruthy()
})

test.each([
  ['completed', true],
  ['abandoned', true],
  ['paused', false],
] as const)('%s → 읽는 중 안내는 현재 쪽 삭제 여부(%s)를 서버 규칙대로 알린다', async (status, clears) => {
  mocks.getLibraryBook.mockResolvedValue(detail({ ...reading, status, progress_percent: status === 'completed' ? 100 : 40 }))
  renderDetail()
  await screen.findByRole('heading', { name: '읽기 진도' })
  fireEvent.click(screen.getByRole('radio', { name: /^읽는 중/ }))
  const hint = screen.getByText(/한국 시간 기준입니다/).textContent
  expect(hint?.includes('현재 쪽은 비워지고 전체 쪽수는 유지됩니다.')).toBe(clears)
})

test('완독이어도 전체 쪽수를 모르면 진도 %가 없으므로 쪽수 입력을 안내한다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail({ status: 'completed', page_count: null, total_pages: null, current_page: null, progress_percent: null }))
  renderDetail()
  await screen.findByText('완독한 책은 전체 쪽수를 입력하면 100%로 표시돼요.')
  expect(within(progressCard()).queryByText('100%')).toBeNull()
})

test('완독 경험이 있는 책도 초기화 안내에 현재 쪽 삭제와 전체 쪽수 유지를 알린다', async () => {
  mocks.getLibraryBook.mockResolvedValue(detail({ ...reading, has_completed: true }))
  renderDetail()
  await screen.findByText('40%')
  fireEvent.click(screen.getByRole('radio', { name: /읽고 싶음/ }))
  fireEvent.click(screen.getByRole('button', { name: '상태 바꾸기' }))
  const message = screen.getByRole('dialog', { name: '읽고 싶음으로 되돌릴까요?', hidden: true }).textContent
  expect(message).toContain('현재 쪽이 초기화됩니다')
  expect(message).toContain('전체 쪽수는 유지됩니다')
})

test('저장 응답 형식이 어긋나도 서버에는 저장됐을 수 있으므로 상세를 다시 불러온다', async () => {
  mocks.getLibraryBook.mockResolvedValueOnce(detail(reading)).mockResolvedValueOnce(detail({ ...reading, current_page: 150, progress_percent: 50 }))
  mocks.updateReadingProgress.mockRejectedValueOnce(new Error('진도 응답 형식이 올바르지 않습니다.'))
  renderDetail()
  await screen.findByText('40%')
  fireEvent.change(within(progressCard()).getByLabelText('현재 쪽'), { target: { value: '150' } })
  fireEvent.click(within(progressCard()).getByRole('button', { name: '진도 저장' }))
  await screen.findByText('50%')
  expect(mocks.updateReadingProgress).toHaveBeenCalledTimes(1)
})

test('입력 중인 전체 쪽수로 %를 고를 수 있고, 상태만 바뀐 재조회에서는 진도 입력을 남긴다', async () => {
  const unknown = { ...reading, page_count: null, current_page: null, progress_percent: null }
  mocks.getLibraryBook.mockResolvedValueOnce(detail(unknown)).mockResolvedValueOnce(detail({ ...unknown, status: 'paused' }))
  mocks.updateLibraryStatus.mockResolvedValueOnce(undefined)
  renderDetail()
  await screen.findByText(/전체 쪽수를 몰라/)
  const card = () => within(progressCard())
  expect(card().getByRole('radio', { name: '%' })).toHaveProperty('disabled', true)
  fireEvent.change(card().getByLabelText('전체 쪽수'), { target: { value: '300' } })
  expect(card().getByRole('radio', { name: '%' })).toHaveProperty('disabled', false)

  fireEvent.click(screen.getByRole('radio', { name: /^중단/ }))
  fireEvent.click(screen.getByRole('button', { name: '상태 바꾸기' }))
  await screen.findByText('상태를 중단(으)로 바꿨습니다.')
  await waitFor(() => expect(mocks.getLibraryBook).toHaveBeenCalledTimes(2))
  expect((card().getByLabelText('전체 쪽수') as HTMLInputElement).value).toBe('300')
})
