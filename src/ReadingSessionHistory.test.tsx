// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError } from './lib/api'
import type { ReadingSessionEntry } from './lib/api'
import ReadingSessionHistory from './ReadingSessionHistory'

const mocks = vi.hoisted(() => ({ getPeriodReadingSessions: vi.fn(), deleteReadingSession: vi.fn() }))
vi.mock('./lib/api', async (original) => ({ ...await original<typeof import('./lib/api')>(), ...mocks }))
vi.mock('./lib/supabase', () => ({ supabase: { auth: {} } }))
vi.mock('./lib/auth', () => ({ withAccessToken: (request: (token: string) => Promise<unknown>) => request('token') }))
const changed = vi.fn<() => Promise<boolean>>()
const busy = vi.fn()
const session = (id = '1'): ReadingSessionEntry => ({ id, user_book_id: `book-${id}`, client_session_id: `client-${id}`,
  started_at: '2026-11-04T12:00:00Z', read_date: '2026-11-04', duration_seconds: 90, created_at: '2026-11-04T12:02:00Z',
  title: `책 ${id}`, authors: ['작가'], thumbnail_url: null })
const show = (month: number | null = 11) => render(<MemoryRouter><ReadingSessionHistory year={2026} month={month ?? undefined} blocked={false} onBusyChange={busy} onChanged={changed} /></MemoryRouter>)
beforeEach(() => { vi.resetAllMocks(); changed.mockResolvedValue(true); mocks.getPeriodReadingSessions.mockResolvedValue([]); mocks.deleteReadingSession.mockResolvedValue(undefined) })
afterEach(cleanup)

test('선택한 기간의 책·날짜·시간을 표시하고 원본 offset으로 다음 페이지를 조회한다', async () => {
  mocks.getPeriodReadingSessions.mockResolvedValueOnce(Array.from({ length: 20 }, (_, index) => session(String(index))))
    .mockResolvedValueOnce([session('20')])
  show()
  await screen.findByRole('link', { name: '책 0' })
  expect(mocks.getPeriodReadingSessions).toHaveBeenCalledWith('token', 2026, 11, 20, 0)
  fireEvent.click(screen.getByRole('button', { name: '시간 기록 더 보기' }))
  await screen.findByRole('link', { name: '책 20' })
  expect(mocks.getPeriodReadingSessions).toHaveBeenLastCalledWith('token', 2026, 11, 20, 20)
  expect(screen.getAllByText('00:01:30')).toHaveLength(21)
  expect(screen.queryByRole('button', { name: '시간 기록 더 보기' })).toBeNull()
})

test('연간 조회가 실패해도 빈 기록으로 바꾸지 않고 같은 기간으로 재시도한다', async () => {
  mocks.getPeriodReadingSessions.mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce([])
  show(null)
  await screen.findByRole('button', { name: '시간 기록 다시 확인' })
  expect(screen.queryByText('아직 저장한 시간 기록이 없습니다.')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '시간 기록 다시 확인' }))
  await screen.findByText('아직 저장한 시간 기록이 없습니다.')
  expect(mocks.getPeriodReadingSessions).toHaveBeenLastCalledWith('token', 2026, undefined, 20, 0)
})

test('삭제는 한 번 보내고 목록과 서버 통계 확인을 끝낼 때까지 변경을 잠근다', async () => {
  let finish!: () => void
  mocks.deleteReadingSession.mockReturnValue(new Promise<void>((resolve) => { finish = resolve }))
  mocks.getPeriodReadingSessions.mockResolvedValueOnce([session()]).mockResolvedValueOnce([])
  show()
  fireEvent.click(await screen.findByRole('button', { name: /책 1 .*시간 기록 삭제/ }))
  const confirm = screen.getByRole('button', { name: '시간 기록 삭제' })
  fireEvent.click(confirm); fireEvent.click(confirm)
  expect(mocks.deleteReadingSession).toHaveBeenCalledTimes(1)
  expect(busy).toHaveBeenCalledWith(true)
  await act(async () => finish())
  await screen.findByText('아직 저장한 시간 기록이 없습니다.')
  expect(changed).toHaveBeenCalledTimes(1)
  expect(mocks.deleteReadingSession).toHaveBeenCalledWith('token', '1')
  await waitFor(() => expect(busy).toHaveBeenLastCalledWith(false))
})

test('삭제 결과가 불명확하고 목록 확인이 실패하면 재삭제를 막고 조회만 다시 한다', async () => {
  mocks.getPeriodReadingSessions.mockResolvedValueOnce([session()]).mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce([])
  mocks.deleteReadingSession.mockRejectedValueOnce(new ApiError(504, 'timeout'))
  show()
  fireEvent.click(await screen.findByRole('button', { name: /책 1 .*시간 기록 삭제/ }))
  fireEvent.click(screen.getByRole('button', { name: '시간 기록 삭제' }))
  const retry = await screen.findByRole('button', { name: '시간 기록과 통계 다시 확인' })
  await waitFor(() => expect(retry).toHaveProperty('disabled', false))
  expect(screen.getByRole('button', { name: /책 1 .*시간 기록 삭제/ })).toHaveProperty('disabled', true)
  fireEvent.click(retry)
  await screen.findByText('아직 저장한 시간 기록이 없습니다.')
  expect(mocks.deleteReadingSession).toHaveBeenCalledTimes(1)
  expect(changed).toHaveBeenCalledTimes(2)
})

test('삭제 후 통계를 확인하는 동안 저장된 타이머 기록도 다시 목록에 반영한다', async () => {
  let finishStatistics!: (value: boolean) => void
  changed.mockReturnValueOnce(new Promise((resolve) => { finishStatistics = resolve }))
  mocks.getPeriodReadingSessions.mockResolvedValueOnce([session()]).mockResolvedValueOnce([]).mockResolvedValueOnce([session('new')])
  show()
  fireEvent.click(await screen.findByRole('button', { name: /책 1 .*시간 기록 삭제/ }))
  fireEvent.click(screen.getByRole('button', { name: '시간 기록 삭제' }))
  await screen.findByText('아직 저장한 시간 기록이 없습니다.')
  act(() => window.dispatchEvent(new Event('reading-sessions-changed')))
  await act(async () => finishStatistics(true))
  await screen.findByRole('link', { name: '책 new' })
  expect(changed).toHaveBeenCalledTimes(2)
  await waitFor(() => expect(busy).toHaveBeenLastCalledWith(false))
})

test('기간을 바꾼 뒤 이전 기간 응답이 도착해도 새 목록을 덮지 않는다', async () => {
  let finish!: (items: ReadingSessionEntry[]) => void
  mocks.getPeriodReadingSessions.mockReturnValueOnce(new Promise((resolve) => { finish = resolve })).mockResolvedValueOnce([session('new')])
  const view = show()
  view.rerender(<MemoryRouter><ReadingSessionHistory key="year" year={2026} blocked={false} onBusyChange={busy} onChanged={changed} /></MemoryRouter>)
  await screen.findByRole('link', { name: '책 new' })
  await act(async () => finish([session('old')]))
  expect(screen.queryByRole('link', { name: '책 old' })).toBeNull()
})
