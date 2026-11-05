// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError } from './lib/api'
import PastReadingDays from './PastReadingDays'

const mocks = vi.hoisted(() => ({ getReadingLogs: vi.fn(), checkReadingDate: vi.fn(), cancelReadingDate: vi.fn(), checkReadingRange: vi.fn() }))
vi.mock('./lib/api', async (original) => ({ ...await original<typeof import('./lib/api')>(), ...mocks }))
vi.mock('./lib/supabase', () => ({ supabase: { auth: {} } }))
vi.mock('./lib/auth', async (original) => ({ ...await original<typeof import('./lib/auth')>(), withAccessToken: (request: (token: string) => Promise<unknown>) => request('token') }))

const range = { start: '2025-02-10', end: '2025-02-20' }
const log = (read_date: string, user_book_id = 'own-a') => ({ id: `log-${read_date}-${user_book_id}`, user_book_id, book_id: 'common-a', title: '채식주의자', authors: ['한강'], thumbnail_url: null, read_date, created_at: '2026-11-05T00:00:00Z' })
const changed = vi.fn()
const busyChanged = vi.fn()

function setup(span: { start: string | null; end: string } = range, blocked = false) {
  return render(<PastReadingDays userBookId="own-a" range={span} today="2026-11-05" blocked={blocked} onChanged={changed} onBusyChange={busyChanged} />)
}
const day = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}(,|$)`) })

async function pick(label: string, date: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }))
  fireEvent.click(within(screen.getByRole('group', { name: `${label} 달력` })).getByRole('button', { name: date }))
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getReadingLogs.mockResolvedValue([])
  changed.mockResolvedValue(true)
})
afterEach(cleanup)

test('완독일이 있는 달의 실제 기록만 이 책 기준으로 표시하고 범위 양 끝만 편집할 수 있다', async () => {
  mocks.getReadingLogs.mockResolvedValue([log('2025-02-12'), log('2025-02-13', 'other-book')])
  setup()
  await screen.findByRole('group', { name: '2025년 2월 읽은 날' })
  expect(mocks.getReadingLogs).toHaveBeenCalledWith('token', '2025-02-01', '2025-02-28')
  expect(day('2025년 2월 12일').getAttribute('aria-pressed')).toBe('true')
  expect(day('2025년 2월 13일').getAttribute('aria-pressed')).toBe('false')
  expect(day('2025년 2월 10일')).toHaveProperty('disabled', false)
  expect(day('2025년 2월 20일')).toHaveProperty('disabled', false)
  expect(day('2025년 2월 9일')).toHaveProperty('disabled', true)
  expect(day('2025년 2월 21일')).toHaveProperty('disabled', true)
})

test('시작일이 없으면 하한 없이 안내하고 이전 달로 이동할 수 있다', async () => {
  setup({ start: null, end: '2025-02-20' })
  await screen.findByText(/시작일이 없어 2025년 2월 20일\(완독일\)까지/)
  expect(day('2025년 2월 1일')).toHaveProperty('disabled', false)
  fireEvent.click(screen.getByRole('button', { name: '이전 달' }))
  await screen.findByRole('group', { name: '2025년 1월 읽은 날' })
  expect(mocks.getReadingLogs).toHaveBeenLastCalledWith('token', '2025-01-01', '2025-01-31')
})

test('범위 밖에 남은 기존 기록은 체크로 보이지만 고칠 수 없다', async () => {
  mocks.getReadingLogs.mockResolvedValue([log('2025-02-05')])
  setup()
  await screen.findByRole('group', { name: '2025년 2월 읽은 날' })
  const old = day('2025년 2월 5일')
  expect(old.getAttribute('aria-pressed')).toBe('true')
  expect(old).toHaveProperty('disabled', true)
})

test('하루 체크·취소는 개인 id로 보내고 서버 기록을 다시 조회한다', async () => {
  mocks.getReadingLogs.mockResolvedValueOnce([log('2025-02-12')]).mockResolvedValueOnce([log('2025-02-12'), log('2025-02-15')]).mockResolvedValueOnce([log('2025-02-15')])
  setup()
  await screen.findByRole('group', { name: '2025년 2월 읽은 날' })
  fireEvent.click(day('2025년 2월 15일'))
  fireEvent.click(day('2025년 2월 15일'))
  await screen.findByText('2025년 2월 15일을 읽은 날로 남겼습니다.')
  expect(mocks.checkReadingDate).toHaveBeenCalledTimes(1)
  expect(mocks.checkReadingDate).toHaveBeenCalledWith('token', 'own-a', '2025-02-15')
  expect(changed).toHaveBeenCalledTimes(1)
  fireEvent.click(day('2025년 2월 12일'))
  await screen.findByText('2025년 2월 12일 체크를 취소했습니다.')
  expect(mocks.cancelReadingDate).toHaveBeenCalledWith('token', 'own-a', '2025-02-12')
  expect(day('2025년 2월 12일').getAttribute('aria-pressed')).toBe('false')
})

test('기간은 일수와 취소 제한을 확인받은 뒤 한 번만 저장한다', async () => {
  setup()
  await screen.findByRole('group', { name: '2025년 2월 읽은 날' })
  await pick('기간 시작', '2025년 2월 10일')
  await pick('기간 끝', '2025년 2월 20일')
  fireEvent.click(screen.getByRole('button', { name: '기간 확인' }))
  const dialog = screen.getByRole('dialog', { name: '11일을 읽은 날로 남길까요?' })
  expect(dialog.textContent).toContain('2025년 2월 10일부터 2025년 2월 20일까지')
  expect(dialog.textContent).toContain('범위 밖이 된 기록은 남지만 고치거나 취소할 수 없어요')
  expect(mocks.checkReadingRange).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole('button', { name: '저장' }))
  await screen.findByText('2025년 2월 10일부터 2025년 2월 20일까지 11일을 남겼습니다.')
  expect(mocks.checkReadingRange).toHaveBeenCalledTimes(1)
  expect(mocks.checkReadingRange).toHaveBeenCalledWith('token', 'own-a', '2025-02-10', '2025-02-20')
  expect(changed).toHaveBeenCalledTimes(1)
})

test('잘못된 기간은 보내지 않고 이유를 안내한다', async () => {
  setup()
  await screen.findByRole('group', { name: '2025년 2월 읽은 날' })
  await pick('기간 시작', '2025년 2월 15일')
  await pick('기간 끝', '2025년 2월 12일')
  fireEvent.click(screen.getByRole('button', { name: '기간 확인' }))
  expect(screen.getByText('시작일이 종료일보다 늦을 수 없어요.')).toBeTruthy()
  expect(screen.queryByRole('dialog')).toBeNull()
})

test.each([
  [new ApiError(409, 'x', 'date_order'), '시작일부터 완독일 사이의 날짜만 남길 수 있어요. 최신 범위를 다시 확인합니다.'],
  [new ApiError(409, 'x', 'reading_check_not_allowed'), '이 책은 지금 과거 읽은 날을 남길 수 없어요. 최신 상태를 다시 확인합니다.'],
  [new ApiError(422, 'x', 'date_range'), '한 번에 366일까지, 시작일이 종료일보다 늦지 않게 골라주세요.'],
])('기간 저장 실패 %s는 성공으로 표시하지 않고 입력을 보존한다', async (failure, message) => {
  mocks.checkReadingRange.mockRejectedValue(failure)
  setup()
  await screen.findByRole('group', { name: '2025년 2월 읽은 날' })
  await pick('기간 시작', '2025년 2월 10일')
  await pick('기간 끝', '2025년 2월 11일')
  fireEvent.click(screen.getByRole('button', { name: '기간 확인' }))
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await screen.findByText(message)
  expect(screen.queryByText(/일을 남겼습니다/)).toBeNull()
  expect(screen.getByRole('button', { name: /^기간 시작/ }).textContent).toBe('2025년 2월 10일')
  expect(screen.getByRole('button', { name: /^기간 끝/ }).textContent).toBe('2025년 2월 11일')
})

test('응답을 잃으면 다시 보내지 않고 재조회하며, 재조회도 실패하면 확인 전까지 쓰기를 막는다', async () => {
  mocks.checkReadingRange.mockRejectedValue(new TypeError('network'))
  mocks.getReadingLogs.mockResolvedValueOnce([]).mockRejectedValueOnce(new ApiError(503)).mockResolvedValueOnce([log('2025-02-10'), log('2025-02-11')])
  setup()
  await screen.findByRole('group', { name: '2025년 2월 읽은 날' })
  await pick('기간 시작', '2025년 2월 10일')
  await pick('기간 끝', '2025년 2월 11일')
  fireEvent.click(screen.getByRole('button', { name: '기간 확인' }))
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  const retry = await screen.findByRole('button', { name: '최신 기록 다시 확인' })
  expect(screen.getByText(/저장 결과를 확인하지 못했습니다/)).toBeTruthy()
  expect(day('2025년 2월 12일')).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: '기간 확인' })).toHaveProperty('disabled', true)
  fireEvent.click(retry)
  await waitFor(() => expect(day('2025년 2월 10일').getAttribute('aria-pressed')).toBe('true'))
  expect(screen.getByRole('button', { name: '기간 확인' })).toHaveProperty('disabled', false)
  expect(mocks.checkReadingRange).toHaveBeenCalledTimes(1)
})

test('첫 조회 실패를 빈 기록으로 바꾸지 않는다', async () => {
  mocks.getReadingLogs.mockRejectedValue(new ApiError(503))
  setup()
  await screen.findByRole('button', { name: '최신 기록 다시 확인' })
  expect(screen.queryByRole('button', { name: /^2025년 2월 12일/ })).toBeNull()
})

test('부모가 바쁘면 쓰기를 막는다', async () => {
  setup(range, true)
  await screen.findByRole('group', { name: '2025년 2월 읽은 날' })
  expect(day('2025년 2월 12일')).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: '기간 확인' })).toHaveProperty('disabled', true)
})

test('달을 옮긴 뒤 이전 달의 늦은 응답을 반영하지 않는다', async () => {
  let resolveFirst!: (logs: unknown[]) => void
  mocks.getReadingLogs.mockReturnValueOnce(new Promise((r) => { resolveFirst = r })).mockResolvedValueOnce([])
  setup({ start: null, end: '2025-02-20' })
  fireEvent.click(screen.getByRole('button', { name: '이전 달' }))
  await screen.findByRole('group', { name: '2025년 1월 읽은 날' })
  await act(async () => resolveFirst([log('2025-01-15')]))
  expect(day('2025년 1월 15일').getAttribute('aria-pressed')).toBe('false')
})

test('날짜 수정으로 범위가 옮겨져 보던 달이 범위 밖이 되면 새 완독일의 달을 다시 조회한다', async () => {
  const view = setup()
  await screen.findByRole('group', { name: '2025년 2월 읽은 날' })
  view.rerender(<PastReadingDays userBookId="own-a" range={{ start: '2024-12-01', end: '2024-12-20' }} today="2026-11-05" blocked={false} onChanged={changed} onBusyChange={busyChanged} />)
  await screen.findByRole('group', { name: '2024년 12월 읽은 날' })
  expect(mocks.getReadingLogs).toHaveBeenLastCalledWith('token', '2024-12-01', '2024-12-31')
})

test('확인창을 연 사이 다른 작업이 시작되면 저장하지 않고 알린다', async () => {
  const view = setup()
  await screen.findByRole('group', { name: '2025년 2월 읽은 날' })
  await pick('기간 시작', '2025년 2월 10일')
  await pick('기간 끝', '2025년 2월 11일')
  fireEvent.click(screen.getByRole('button', { name: '기간 확인' }))
  view.rerender(<PastReadingDays userBookId="own-a" range={range} today="2026-11-05" blocked onChanged={changed} onBusyChange={busyChanged} />)
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  expect(screen.getByText('다른 저장이나 확인이 끝난 뒤 다시 저장해주세요. 고른 기간은 그대로 두었어요.')).toBeTruthy()
  expect(mocks.checkReadingRange).not.toHaveBeenCalled()
})

test('화면을 떠난 뒤 늦은 응답을 반영하지 않는다', async () => {
  let resolve!: (logs: unknown[]) => void
  mocks.getReadingLogs.mockReturnValue(new Promise((r) => { resolve = r }))
  const view = setup()
  view.unmount()
  await act(async () => resolve([log('2025-02-12')]))
  expect(screen.queryByRole('group', { name: '2025년 2월 읽은 날' })).toBeNull()
})
