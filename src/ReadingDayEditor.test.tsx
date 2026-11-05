// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError } from './lib/api'
import ReadingDayEditor from './ReadingDayEditor'

const mocks = vi.hoisted(() => ({ getAllLibraryBooks: vi.fn(), getReadingLogs: vi.fn(), checkReadingDate: vi.fn(), cancelReadingDate: vi.fn() }))
vi.mock('./lib/api', async (original) => ({ ...await original<typeof import('./lib/api')>(), ...mocks }))
vi.mock('./lib/supabase', () => ({ supabase: { auth: {} } }))
vi.mock('./lib/auth', async (original) => ({ ...await original<typeof import('./lib/auth')>(), withAccessToken: (request: (token: string) => Promise<unknown>) => request('token') }))

const book = { id: 'own-a', book_id: 'common-a', isbn13: '9788936433598', title: '채식주의자', authors: ['한강'], thumbnail_url: null, status: 'reading', created_at: '2026-10-01T00:00:00Z' }
const log = { id: 'log-a', user_book_id: 'own-a', book_id: 'common-a', title: book.title, authors: book.authors, thumbnail_url: null, read_date: '2026-10-27', created_at: '2026-10-28T03:00:00Z' }
const changed = vi.fn()
const busyChanged = vi.fn()
function setup(date = '2026-10-27', today = '2026-10-28') {
  return render(<MemoryRouter><ReadingDayEditor date={date} today={today} onChanged={changed} onBusyChange={busyChanged} /></MemoryRouter>)
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.getAllLibraryBooks.mockResolvedValue([book])
  mocks.getReadingLogs.mockResolvedValue([])
  changed.mockResolvedValue(true)
})
afterEach(cleanup)

test('날짜별로 개인 id를 체크하고 재조회가 끝나야 취소할 수 있다', async () => {
  setup()
  fireEvent.click(await screen.findByRole('button', { name: '채식주의자 체크' }))
  expect(mocks.checkReadingDate).toHaveBeenCalledWith('token', 'own-a', '2026-10-27')
  expect(mocks.checkReadingDate).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1))
  expect(mocks.getReadingLogs).toHaveBeenCalledTimes(2)
})

test('완독한 책의 기존 체크도 취소할 수 있고 완독만 한 책을 체크로 취급하지 않는다', async () => {
  mocks.getAllLibraryBooks.mockResolvedValue([{ ...book, status: 'completed' }])
  mocks.getReadingLogs.mockResolvedValue([log])
  setup()
  fireEvent.click(await screen.findByRole('button', { name: '채식주의자 체크 취소' }))
  await waitFor(() => expect(changed).toHaveBeenCalled())
  expect(mocks.cancelReadingDate).toHaveBeenCalledWith('token', 'own-a', '2026-10-27')
  expect(screen.queryByRole('button', { name: '채식주의자 체크' })).toBeNull()
})

// 상태 필터를 모르는 서버가 전체를 돌려줘도 읽는 중인 책만 체크 대상으로 남긴다.
test('읽는 중 필터로 전체를 가져오고, 필터를 무시한 응답에서도 읽는 중만 체크 대상으로 둔다', async () => {
  mocks.getAllLibraryBooks.mockResolvedValueOnce([...Array.from({ length: 100 }, (_, i) => ({ ...book, id: `done-${i}`, status: 'completed' })), book])
  setup()
  await screen.findByRole('button', { name: '채식주의자 체크' })
  expect(screen.getAllByRole('button', { name: /체크$/ })).toHaveLength(1)
  expect(mocks.getAllLibraryBooks).toHaveBeenCalledWith('token', { status: 'reading' })
})

test.each(['2026-10-22', '2026-10-28'])('오늘 포함 최근 7일 경계 %s는 편집할 수 있다', async (date) => {
  setup(date)
  expect(await screen.findByRole('button', { name: '채식주의자 체크' })).toHaveProperty('disabled', false)
})

test.each(['2026-10-21', '2026-10-29'])('범위 밖 %s는 조회와 쓰기를 하지 않는다', (date) => {
  setup(date)
  expect(screen.getByText('오늘을 포함한 최근 7일만 체크하거나 취소할 수 있어요.')).toBeTruthy()
  expect(mocks.getAllLibraryBooks).not.toHaveBeenCalled()
})

test('시작일 이전 오류는 체크 문구로 안내하고 상태를 다시 조회한다', async () => {
  mocks.checkReadingDate.mockRejectedValue(new ApiError(409, 'english', 'date_order'))
  setup()
  fireEvent.click(await screen.findByRole('button', { name: '채식주의자 체크' }))
  await screen.findByText('현재 독서 시작일보다 이전 날짜에는 체크할 수 없어요.')
  await waitFor(() => expect(changed).toHaveBeenCalled())
  expect(mocks.checkReadingDate).toHaveBeenCalledTimes(1)
})

test('불명확한 쓰기는 자동 반복하지 않고 조회 실패 시 잠근 뒤 조회만 재시도한다', async () => {
  mocks.checkReadingDate.mockRejectedValue(new TypeError('network'))
  mocks.getReadingLogs.mockResolvedValueOnce([]).mockRejectedValueOnce(new ApiError(503)).mockResolvedValueOnce([log])
  setup()
  fireEvent.click(await screen.findByRole('button', { name: '채식주의자 체크' }))
  fireEvent.click(screen.getByRole('button', { name: '채식주의자 체크' }))
  const retry = await screen.findByRole('button', { name: '최신 체크 다시 확인' })
  expect(screen.getByRole('button', { name: '채식주의자 체크' })).toHaveProperty('disabled', true)
  fireEvent.click(retry)
  await screen.findByRole('button', { name: '채식주의자 체크 취소' })
  expect(mocks.checkReadingDate).toHaveBeenCalledTimes(1)
})

test('첫 조회 실패를 미체크로 바꾸지 않고 쓰기를 제공하지 않는다', async () => {
  mocks.getReadingLogs.mockRejectedValue(new ApiError(503))
  setup()
  await screen.findByRole('button', { name: '최신 체크 다시 확인' })
  expect(screen.queryByRole('button', { name: '채식주의자 체크' })).toBeNull()
})

test('떠난 날짜의 늦은 조회 응답을 표시하지 않는다', async () => {
  let resolve!: (logs: unknown[]) => void
  mocks.getReadingLogs.mockReturnValue(new Promise((r) => { resolve = r }))
  const view = setup()
  view.unmount()
  await act(async () => resolve([log]))
  expect(screen.queryByText(book.title)).toBeNull()
})

test('취소 후 행이 사라져도 결과 안내에 키보드 포커스가 남는다', async () => {
  mocks.getAllLibraryBooks.mockResolvedValue([])
  mocks.getReadingLogs.mockResolvedValueOnce([log]).mockResolvedValueOnce([])
  setup()
  const cancel = await screen.findByRole('button', { name: '채식주의자 체크 취소' })
  cancel.focus()
  fireEvent.click(cancel)
  await waitFor(() => expect(screen.queryByRole('button', { name: '채식주의자 체크 취소' })).toBeNull())
  expect(document.activeElement).toBe(screen.getByRole('status'))
})
