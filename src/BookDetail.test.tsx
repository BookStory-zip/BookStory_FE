// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError } from './lib/api'
import type { LibraryBookDetail } from './lib/api'
import BookDetail from './BookDetail'

const mocks = vi.hoisted(() => ({
  getLibraryBook: vi.fn(),
  updateLibraryStatus: vi.fn(),
  updateLibraryRecord: vi.fn(),
  deleteLibraryBook: vi.fn(),
}))

vi.mock('./lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/api')>(),
  ...mocks,
}))
vi.mock('./lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/auth')>(),
  withAccessToken: (request: (token: string) => Promise<unknown>) => request('test-token'),
}))

function detail(overrides: Partial<LibraryBookDetail> = {}): LibraryBookDetail {
  return {
    id: 'user-book-1',
    book_id: 'book-1',
    isbn13: '9788936433598',
    title: '소년이 온다',
    authors: ['한강'],
    thumbnail_url: null,
    status: 'reading',
    created_at: '2026-10-01T00:00:00Z',
    publisher: null,
    published_date: '2014-05-19',
    description: null,
    source_url: 'https://example.test',
    started_at: '2026-10-01T03:00:00Z',
    last_read_at: null,
    completed_at: null,
    stopped_at: null,
    stop_reason: null,
    rating: null,
    memo: '첫 메모',
    has_completed: false,
    updated_at: '2026-10-01T00:00:00Z',
    ...overrides,
  }
}

function renderDetail() {
  render(
    <MemoryRouter initialEntries={['/books/user-book-1']}>
      <Routes>
        <Route path="/books/:userBookId" element={<BookDetail />} />
        <Route path="/" element={<p>서재 화면</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
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
    completed_at: '2026-10-20T23:59:59+09:00',
  })
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
  expect(reset.textContent).toContain('완독일·별점·메모도 초기화')
  fireEvent.click(within(reset).getByRole('button', { name: '취소' }))

  fireEvent.click(screen.getByRole('button', { name: '서재에서 빼기' }))
  const remove = screen.getByRole('dialog', { name: /서재에서 뺄까요/ })
  expect(remove.textContent).toContain('독서 체크 기록도 함께 삭제')
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
