// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError } from './lib/api'
import { clearTimer, readTimer, startTimer, writeTimer } from './lib/timer'
import ReadingTimer from './ReadingTimer'

const mocks = vi.hoisted(() => ({ getReadingSessions: vi.fn(), saveReadingSession: vi.fn(), deleteReadingSession: vi.fn() }))
vi.mock('./lib/api', async (original) => ({ ...await original<typeof import('./lib/api')>(), ...mocks }))
vi.mock('./lib/supabase', () => ({ supabase: { auth: {} } }))
vi.mock('./lib/auth', async (original) => ({ ...await original<typeof import('./lib/auth')>(), withAccessToken: (request: (token: string) => Promise<unknown>) => request('token') }))
const now = Date.parse('2026-11-04T10:00:00Z')
const onSaved = vi.fn()
const onBusyChange = vi.fn()
const props = { userId: 'user-a', userBookId: 'book-a', status: 'reading' as const, blocked: false, onSaved, onBusyChange }
function show(overrides = {}) { return render(<MemoryRouter><ReadingTimer {...props} {...overrides} /></MemoryRouter>) }
function later(ms: number) { act(() => { vi.setSystemTime(now + ms); window.dispatchEvent(new Event('focus')) }) }

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  mocks.getReadingSessions.mockResolvedValue([])
  mocks.saveReadingSession.mockResolvedValue({ id: 'saved' })
  onSaved.mockResolvedValue('reading')
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

test('방치한 구간은 1시간에 멈추고 확인 후에만 저장·새 구간을 시작한다', async () => {
  show()
  fireEvent.click(screen.getByRole('button', { name: '타이머 시작' }))
  const original = readTimer('user-a')!
  later(5 * 3600_000)
  expect(screen.getByRole('timer').textContent).toBe('01:00:00')
  expect(screen.getByText(/계속 읽고 계신가요/)).toBeTruthy()
  expect(mocks.saveReadingSession).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '계속 읽기' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(readTimer('user-a')?.clientSessionId).not.toBe(original.clientSessionId))
  expect(mocks.saveReadingSession).toHaveBeenCalledWith('token', 'book-a', { client_session_id: original.clientSessionId, started_at: '2026-11-04T10:00:00.000Z', duration_seconds: 3600 })
  expect(readTimer('user-a')?.startedAt).toBe('2026-11-04T15:00:00.000Z')
  expect(screen.getByRole('timer').textContent).toBe('00:00:00')
})

test('저장 결과가 불명확하면 시간을 고정하고 같은 식별자·같은 내용으로만 직접 재시도한다', async () => {
  mocks.saveReadingSession.mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce({ id: 'saved' })
  show()
  fireEvent.click(screen.getByRole('button', { name: '타이머 시작' }))
  later(90_000)
  fireEvent.click(screen.getByRole('button', { name: '종료·저장' }))
  await screen.findByText(/저장 결과를 확인하지 못했습니다/)
  const sent = mocks.saveReadingSession.mock.calls[0][2]
  later(5 * 3600_000)
  expect(screen.getByRole('timer').textContent).toBe('00:01:30')
  expect(mocks.saveReadingSession).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: '다시 저장' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
  expect(mocks.saveReadingSession.mock.calls[1][2]).toEqual(sent)
  expect(readTimer('user-a')).toBeNull()
})

test('다른 책의 측정을 덮어쓰지 않고 다른 계정에서는 보이지 않는다', async () => {
  writeTimer(startTimer('user-a', 'other-book', now, crypto.randomUUID()))
  show()
  expect(screen.getByRole('link', { name: '진행 중인 타이머로 이동' }).getAttribute('href')).toBe('/timer?book=other-book')
  expect(screen.queryByRole('button', { name: '타이머 시작' })).toBeNull()
  cleanup()
  show({ userId: 'user-b' })
  expect(screen.getByRole('button', { name: '타이머 시작' })).toHaveProperty('disabled', false)
  expect(screen.queryByRole('link', { name: '진행 중인 타이머로 이동' })).toBeNull()
})

test('다른 책이 삭제돼도 남은 측정을 버리고 새 타이머를 시작할 수 있다', async () => {
  writeTimer(startTimer('user-a', 'deleted-book', now, crypto.randomUUID()))
  show()
  fireEvent.click(screen.getByRole('button', { name: '측정 버리기' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '측정 버리기' }))
  fireEvent.click(await screen.findByRole('button', { name: '타이머 시작' }))
  expect(readTimer('user-a')?.userBookId).toBe('book-a')
})

test('저장 중 계정이 닫히면 늦은 성공으로 타이머를 되살리거나 다음 구간을 시작하지 않는다', async () => {
  let resolve!: (value: unknown) => void
  mocks.saveReadingSession.mockReturnValue(new Promise(r => { resolve = r }))
  show()
  fireEvent.click(screen.getByRole('button', { name: '타이머 시작' }))
  later(3600_000)
  fireEvent.click(screen.getByRole('button', { name: '계속 읽기' }))
  clearTimer('user-a')
  cleanup()
  await act(async () => { resolve({ id: 'saved' }) })
  expect(readTimer('user-a')).toBeNull()
  expect(onSaved).not.toHaveBeenCalled()
})

test('세션 저장 409는 측정 값을 보존하고 상태 재확인을 요청한다', async () => {
  mocks.saveReadingSession.mockRejectedValue(new ApiError(409, undefined, 'reading_check_not_allowed'))
  show()
  fireEvent.click(screen.getByRole('button', { name: '타이머 시작' }))
  later(90_000)
  fireEvent.click(screen.getByRole('button', { name: '종료·저장' }))
  await screen.findByText(/읽는 중인 책만 시간 기록을 저장/)
  expect(readTimer('user-a')?.elapsedMs).toBe(90_000)
  expect(onSaved).toHaveBeenCalledTimes(1)
})

test('겹치는 시간 409는 측정을 보존하고 재전송 없이 원인을 안내한다', async () => {
  mocks.saveReadingSession.mockRejectedValue(new ApiError(409, undefined, 'session_overlap'))
  show()
  fireEvent.click(screen.getByRole('button', { name: '타이머 시작' }))
  later(90_000)
  fireEvent.click(screen.getByRole('button', { name: '종료·저장' }))
  await screen.findByText(/이미 기록된 시간과 겹칩니다/)
  later(3600_000)
  expect(readTimer('user-a')?.elapsedMs).toBe(90_000)
  expect(mocks.saveReadingSession).toHaveBeenCalledTimes(1)
})

test('1분 전 저장은 막고 일시정지한 시간은 더하지 않는다', async () => {
  show()
  fireEvent.click(screen.getByRole('button', { name: '타이머 시작' }))
  later(59_000)
  expect(screen.getByRole('button', { name: '종료·저장' })).toHaveProperty('disabled', true)
  fireEvent.click(screen.getByRole('button', { name: '일시정지' }))
  later(600_000)
  expect(screen.getByRole('timer').textContent).toBe('00:00:59')
  fireEvent.click(screen.getByRole('button', { name: '다시 읽기' }))
  later(601_000)
  fireEvent.click(screen.getByRole('button', { name: '종료·저장' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalled())
  expect(mocks.saveReadingSession.mock.calls[0][2].duration_seconds).toBe(60)
})

test('시간 기록 삭제는 확인 후 요청하며 독서 체크가 남는다고 안내한다', async () => {
  mocks.getReadingSessions.mockResolvedValueOnce([{ id: 'saved-1', read_date: '2026-11-04', duration_seconds: 90 }])
  mocks.deleteReadingSession.mockResolvedValue(undefined)
  show()
  fireEvent.click(await screen.findByRole('button', { name: /시간 기록 삭제/ }))
  const dialog = screen.getByRole('dialog')
  expect(dialog.textContent).toContain('독서 체크는 그대로 남습니다')
  expect(mocks.deleteReadingSession).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole('button', { name: '시간 기록 삭제' }))
  await screen.findByText('시간 기록을 삭제했습니다. 독서 체크는 그대로 남습니다.')
  expect(mocks.deleteReadingSession).toHaveBeenCalledWith('token', 'saved-1')
  expect(onSaved).toHaveBeenCalledTimes(1)
})

test('로컬 저장소를 쓸 수 없으면 저장되지 않는 타이머를 시작하지 않는다', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  show()
  fireEvent.click(screen.getByRole('button', { name: '타이머 시작' }))
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(readTimer('user-a')).toBeNull()
  expect(mocks.saveReadingSession).not.toHaveBeenCalled()
})

test('더 보기 실패는 기존 기록을 유지하고 같은 offset에서 다시 받는다', async () => {
  const firstPage = Array.from({ length: 20 }, (_, id) => ({ id: String(id), read_date: '2026-11-04', duration_seconds: 60 }))
  mocks.getReadingSessions.mockResolvedValueOnce(firstPage).mockRejectedValueOnce(new ApiError(503)).mockResolvedValueOnce([{ ...firstPage[0], id: 'next' }])
  show()
  fireEvent.click(await screen.findByRole('button', { name: '시간 기록 더 보기' }))
  await screen.findByRole('alert')
  expect(screen.getAllByRole('listitem')).toHaveLength(20)
  fireEvent.click(screen.getByRole('button', { name: '시간 기록 더 보기' }))
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(21))
  expect(mocks.getReadingSessions.mock.calls.map(call => call[3])).toEqual([0, 20, 20])
})

test('서버가 미래 측정을 거부하면 기기 시계를 안내하고 값을 보존한다', async () => {
  mocks.saveReadingSession.mockRejectedValue(new ApiError(422, undefined, 'future_date'))
  show()
  fireEvent.click(screen.getByRole('button', { name: '타이머 시작' }))
  later(90_000)
  fireEvent.click(screen.getByRole('button', { name: '종료·저장' }))
  await screen.findByText(/측정 시작 시각이 서버 시각보다 앞섭니다/)
  expect(readTimer('user-a')?.elapsedMs).toBe(90_000)
})
