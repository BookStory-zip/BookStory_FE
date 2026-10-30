// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError } from './lib/api'
import type { ReadingLogEntry } from './lib/api'
import ReadingRecords from './ReadingRecords'

const mocks = vi.hoisted(() => ({ getReadingLogs: vi.fn(), getReadingStatistics: vi.fn() }))

vi.mock('./lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/api')>(),
  getReadingLogs: mocks.getReadingLogs,
  getReadingStatistics: mocks.getReadingStatistics,
}))
// 환경변수 없는 CI에서도 실제 Supabase 클라이언트를 만들지 않는다.
vi.mock('./lib/supabase', () => ({ supabase: { auth: {} } }))
vi.mock('./lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/auth')>(),
  withAccessToken: (request: (token: string) => Promise<unknown>) => request('test-token'),
}))

function log(id: string, readDate: string, userBookId: string, title: string): ReadingLogEntry {
  return {
    id, user_book_id: userBookId, read_date: readDate, created_at: `${readDate}T00:00:00Z`,
    book_id: `book-${userBookId}`, title, authors: [], thumbnail_url: null,
  }
}

const renderRecords = () => render(<MemoryRouter><ReadingRecords /></MemoryRouter>)

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-28T03:00:00Z'))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

test('이번 달 한국 날짜 범위를 조회하고 체크한 날만 표시한다', async () => {
  mocks.getReadingLogs.mockResolvedValue([
    log('1', '2026-10-03', 'ub-a', '소년이 온다'),
    log('2', '2026-10-03', 'ub-b', '데미안'),
    log('3', '2026-10-05', 'ub-a', '소년이 온다'),
  ])
  renderRecords()

  await screen.findByText('2일 동안 2권을 읽었어요.')
  expect(mocks.getReadingLogs).toHaveBeenCalledWith('test-token', '2026-10-01', '2026-10-31')
  fireEvent.click(screen.getByRole('button', { name: '달력' }))
  expect(screen.getByText('2일 동안 2권을 읽었어요.')).toBeTruthy()
  expect(screen.getByRole('button', { name: '2026년 10월 3일, 2권 읽음: 소년이 온다, 데미안' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '2026년 10월 4일' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '2026년 10월 29일' })).toHaveProperty('disabled', true)

  fireEvent.click(screen.getByRole('button', { name: '2026년 10월 3일, 2권 읽음: 소년이 온다, 데미안' }))
  expect(screen.getByRole('link', { name: /데미안/ }).getAttribute('href')).toBe('/books/ub-b')
})

test('이전 달로 옮기면 그 달 범위를 조회하고, 늦게 온 이전 응답은 버린다', async () => {
  let resolveOctober!: (logs: ReadingLogEntry[]) => void
  mocks.getReadingLogs
    .mockReturnValueOnce(new Promise((resolve) => { resolveOctober = resolve }))
    .mockResolvedValueOnce([log('9', '2026-09-30', 'ub-a', '9월의 책')])
  renderRecords()

  fireEvent.click(screen.getByRole('button', { name: '이전 달' }))
  await screen.findByText('1일 동안 1권을 읽었어요.')
  expect(mocks.getReadingLogs).toHaveBeenLastCalledWith('test-token', '2026-09-01', '2026-09-30')

  resolveOctober([log('1', '2026-10-03', 'ub-a', '10월의 책')])
  await waitFor(() => expect(screen.getByText('2026년 9월')).toBeTruthy())
  expect(screen.queryByText(/10월의 책/)).toBeNull()
  expect(screen.getByRole('button', { name: '다음 달' })).toHaveProperty('disabled', false)
})

test('조회 실패를 빈 달로 바꾸지 않고 다시 시도할 수 있다', async () => {
  mocks.getReadingLogs.mockRejectedValueOnce(new ApiError(503)).mockResolvedValueOnce([])
  renderRecords()

  expect((await screen.findByRole('alert')).textContent).toContain('잠시 응답할 수 없습니다')
  expect(screen.queryByText('이 달에는 체크한 날이 없습니다.')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  await screen.findByText('이 달에는 체크한 날이 없습니다.')
})

const monthlyStatistics = {
  library: {
    total_books: 5,
    status_counts: { want_to_read: 1, reading: 1, completed: 1, paused: 1, abandoned: 1 },
    completed_books: 2,
  },
  period: {
    year: 2026, month: 10, start_date: '2026-10-01', end_date: '2026-10-31', reading_days: 3,
  },
}

test('통계는 탭을 열 때 조회하고 연간 합계와 현재 서재를 구분한다', async () => {
  mocks.getReadingLogs.mockResolvedValue([])
  mocks.getReadingStatistics.mockResolvedValueOnce(monthlyStatistics)
  renderRecords()
  await screen.findByText('이 달에는 체크한 날이 없습니다.')
  expect(mocks.getReadingStatistics).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: '통계' }))
  await screen.findByText('3')
  expect(mocks.getReadingStatistics).toHaveBeenLastCalledWith('test-token', 2026, 10)
  expect(screen.getByRole('heading', { name: '현재 서재' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /2026년 10월 3일/ })).toBeNull()

  mocks.getReadingStatistics.mockResolvedValueOnce({
    ...monthlyStatistics,
    period: {
      year: 2026, month: null, start_date: '2026-01-01', end_date: '2026-12-31', reading_days: 17,
    },
  })
  fireEvent.click(screen.getByRole('button', { name: '연간' }))
  await screen.findByText('17')
  expect(mocks.getReadingStatistics).toHaveBeenLastCalledWith('test-token', 2026, undefined)
  expect(screen.getByRole('button', { name: '다음 해' })).toHaveProperty('disabled', true)
})

test('달력에서 선택한 월을 통계에서도 유지하고 과거 연도를 조회한다', async () => {
  mocks.getReadingLogs.mockResolvedValue([])
  mocks.getReadingStatistics.mockResolvedValue(monthlyStatistics)
  renderRecords()
  await screen.findByText('이 달에는 체크한 날이 없습니다.')
  fireEvent.click(screen.getByRole('button', { name: '이전 달' }))
  await screen.findByRole('heading', { name: '2026년 9월' })
  fireEvent.click(screen.getByRole('button', { name: '통계' }))
  await screen.findByText('3')
  expect(mocks.getReadingStatistics).toHaveBeenLastCalledWith('test-token', 2026, 9)

  fireEvent.click(screen.getByRole('button', { name: '연간' }))
  fireEvent.click(screen.getByRole('button', { name: '이전 해' }))
  await screen.findByRole('heading', { name: '2025년' })
  expect(mocks.getReadingStatistics).toHaveBeenLastCalledWith('test-token', 2025, undefined)

  fireEvent.click(screen.getByRole('button', { name: '달력' }))
  await screen.findByRole('heading', { name: '2025년 9월' })
})

test('과거 12월에서 다음 해로 이동해도 월간 통계와 달력은 현재 월을 넘지 않는다', async () => {
  vi.setSystemTime(new Date('2026-10-30T03:00:00Z'))
  mocks.getReadingLogs.mockResolvedValue([])
  mocks.getReadingStatistics.mockResolvedValue(monthlyStatistics)
  renderRecords()
  await screen.findByText('이 달에는 체크한 날이 없습니다.')
  for (let index = 0; index < 10; index += 1) {
    fireEvent.click(screen.getByRole('button', { name: '이전 달' }))
  }
  await screen.findByRole('heading', { name: '2025년 12월' })
  fireEvent.click(screen.getByRole('button', { name: '통계' }))
  await screen.findByText('3')
  fireEvent.click(screen.getByRole('button', { name: '연간' }))
  fireEvent.click(screen.getByRole('button', { name: '다음 해' }))
  await screen.findByRole('heading', { name: '2026년' })

  fireEvent.click(screen.getByRole('button', { name: '월간' }))
  await screen.findByRole('heading', { name: '2026년 10월' })
  expect(mocks.getReadingStatistics).toHaveBeenLastCalledWith('test-token', 2026, 10)
  expect(mocks.getReadingStatistics).not.toHaveBeenCalledWith('test-token', 2026, 12)
  expect(screen.getByRole('button', { name: '다음 달' })).toHaveProperty('disabled', true)

  fireEvent.click(screen.getByRole('button', { name: '달력' }))
  await screen.findByRole('heading', { name: '2026년 10월' })
  expect(mocks.getReadingLogs).toHaveBeenLastCalledWith('test-token', '2026-10-01', '2026-10-31')
  expect(screen.getByRole('button', { name: '2026년 10월 30일' })).toHaveProperty('disabled', false)
})

test('월을 바꾸면 늦게 온 이전 통계가 최신 통계를 덮지 않는다', async () => {
  let resolveOctober!: (data: typeof monthlyStatistics) => void
  mocks.getReadingLogs.mockResolvedValue([])
  mocks.getReadingStatistics
    .mockReturnValueOnce(new Promise((resolve) => { resolveOctober = resolve }))
    .mockResolvedValueOnce({
      ...monthlyStatistics,
      period: { ...monthlyStatistics.period, month: 9, reading_days: 4 },
    })
  renderRecords()
  fireEvent.click(screen.getByRole('button', { name: '통계' }))
  fireEvent.click(screen.getByRole('button', { name: '이전 달' }))
  await screen.findByText('4')

  await act(async () => { resolveOctober(monthlyStatistics) })

  expect(screen.getByRole('heading', { name: '2026년 9월' })).toBeTruthy()
  expect(screen.getByText('4')).toBeTruthy()
  expect(screen.queryByText('3')).toBeNull()
})

test('통계 오류는 빈 기록과 구분하고 재시도 후 실제 0일을 표시한다', async () => {
  mocks.getReadingLogs.mockResolvedValue([])
  mocks.getReadingStatistics
    .mockRejectedValueOnce(new ApiError(503))
    .mockResolvedValueOnce({
      ...monthlyStatistics,
      period: { ...monthlyStatistics.period, reading_days: 0 },
    })
  renderRecords()
  fireEvent.click(screen.getByRole('button', { name: '통계' }))

  expect((await screen.findByRole('alert')).textContent).toContain('잠시 응답할 수 없습니다')
  expect(screen.queryByText('이 기간에는 체크한 날이 없습니다.')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  await screen.findByText('이 기간에는 체크한 날이 없습니다.')
  expect(screen.getByText('0')).toBeTruthy()
})
