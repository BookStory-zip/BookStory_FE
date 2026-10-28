// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError } from './lib/api'
import type { ReadingLogEntry } from './lib/api'
import ReadingRecords from './ReadingRecords'

const mocks = vi.hoisted(() => ({ getReadingLogs: vi.fn() }))

vi.mock('./lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/api')>(),
  getReadingLogs: mocks.getReadingLogs,
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
