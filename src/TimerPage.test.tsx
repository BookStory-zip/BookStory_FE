// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError } from './lib/api'
import type { LibraryBookItem } from './lib/api'
import { readTimer, startTimer, writeTimer } from './lib/timer'
import TimerPage from './TimerPage'

const mocks = vi.hoisted(() => ({ getAllLibraryBooks: vi.fn(), getLibraryBook: vi.fn(), getReadingSessions: vi.fn(), deleteReadingSession: vi.fn(), saveReadingSession: vi.fn() }))
vi.mock('./lib/api', async (original) => ({ ...await original<typeof import('./lib/api')>(), ...mocks }))
vi.mock('./lib/supabase', () => ({ supabase: { auth: {} } }))
vi.mock('./lib/auth', async (original) => ({ ...await original<typeof import('./lib/auth')>(), withAccessToken: (request: (token: string) => Promise<unknown>) => request('token') }))

function book(id: string, status: LibraryBookItem['status'] = 'reading'): LibraryBookItem {
  return { id, book_id: `catalog-${id}`, isbn13: '9788936433598', title: `책 ${id}`, authors: [], thumbnail_url: null, status, created_at: '2026-11-01T00:00:00Z' }
}

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  mocks.getReadingSessions.mockResolvedValue([])
})
afterEach(cleanup)
const show = () => render(<MemoryRouter><TimerPage userId="user-a" /></MemoryRouter>)

test('읽는 중인 책을 100권 이후까지 조회하고 선택한 서재 id로만 측정을 시작한다', async () => {
  const books = Array.from({ length: 101 }, (_, index) => book(String(index)))
  mocks.getAllLibraryBooks.mockResolvedValueOnce(books)
  show()
  const select = await screen.findByLabelText('어떤 책을 읽으시나요?')
  expect(mocks.getAllLibraryBooks.mock.calls).toEqual([['token', { status: 'reading' }]])
  expect(screen.queryByRole('button', { name: '타이머 시작' })).toBeNull()
  fireEvent.change(select, { target: { value: '100' } })
  fireEvent.click(screen.getByRole('button', { name: '타이머 시작' }))
  expect(readTimer('user-a')?.userBookId).toBe('100')
  expect(select).toHaveProperty('disabled', true)
  expect(mocks.getReadingSessions).not.toHaveBeenCalled()
})

test.each(['completed', 'paused', 'abandoned'] as const)('읽는 중인 책이 없어도 %s 책의 기록을 조회한다', async (status) => {
  mocks.getAllLibraryBooks.mockResolvedValueOnce([]).mockResolvedValueOnce([book('done', status)])
  show()
  await screen.findByText(/읽는 중인 책이 없습니다/)
  expect(screen.getByRole('link', { name: '서재로 가기' }).getAttribute('href')).toBe('/')
  fireEvent.click(screen.getByRole('button', { name: '시간 기록 보기' }))
  const select = await screen.findByLabelText('시간 기록을 확인할 책')
  fireEvent.change(select, { target: { value: 'done' } })
  await screen.findByRole('heading', { name: '독서 시간 기록' })
  expect(mocks.getAllLibraryBooks).toHaveBeenLastCalledWith('token', {})
  expect(mocks.getReadingSessions).toHaveBeenCalledWith('token', 'done', 20, 0)
  expect(screen.queryByRole('button', { name: '타이머 시작' })).toBeNull()
})

test('기록은 기본 접고 기록용 책 선택과 접기가 측정 책과 일시정지 값을 바꾸지 않는다', async () => {
  const reading = book('a')
  mocks.getAllLibraryBooks.mockImplementation((_token: string, filter: { status?: string }) =>
    Promise.resolve(filter.status ? [reading] : [reading, book('done', 'completed')]))
  mocks.getLibraryBook.mockResolvedValue(reading)
  mocks.getReadingSessions.mockResolvedValue([{ id: 'saved', read_date: '2026-11-04', duration_seconds: 90 }])
  writeTimer(startTimer('user-a', 'a', Date.now() - 90_000, crypto.randomUUID()))
  show()
  await screen.findByRole('timer')
  fireEvent.click(screen.getByRole('button', { name: '일시정지' }))
  const paused = readTimer('user-a')
  expect(screen.queryByText('저장한 시간')).toBeNull()
  expect(mocks.getReadingSessions).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '시간 기록 보기' }))
  fireEvent.change(await screen.findByLabelText('시간 기록을 확인할 책'), { target: { value: 'done' } })
  await screen.findByRole('button', { name: /시간 기록 삭제/ })
  expect(screen.getByLabelText('어떤 책을 읽으시나요?')).toHaveProperty('value', 'a')
  expect(readTimer('user-a')).toEqual(paused)
  fireEvent.click(screen.getByRole('button', { name: '시간 기록 접기' }))
  expect(screen.queryByLabelText('시간 기록을 확인할 책')).toBeNull()
  expect(screen.getByLabelText('어떤 책을 읽으시나요?')).toHaveProperty('value', 'a')
  expect(screen.getByRole('button', { name: '다시 읽기' })).toHaveProperty('disabled', false)
  expect(readTimer('user-a')).toEqual(paused)
  fireEvent.click(screen.getByRole('button', { name: '시간 기록 보기' }))
  expect(await screen.findByLabelText('시간 기록을 확인할 책')).toHaveProperty('value', 'done')
})

test('기록용 책 목록 조회가 실패해도 현재 측정을 조작하고 기록만 재시도할 수 있다', async () => {
  const reading = book('a')
  mocks.getAllLibraryBooks.mockResolvedValueOnce([reading]).mockRejectedValueOnce(new ApiError(503)).mockResolvedValueOnce([reading])
  show()
  fireEvent.change(await screen.findByLabelText('어떤 책을 읽으시나요?'), { target: { value: 'a' } })
  fireEvent.click(screen.getByRole('button', { name: '타이머 시작' }))
  const draft = readTimer('user-a')
  fireEvent.click(screen.getByRole('button', { name: '시간 기록 보기' }))
  await screen.findByRole('alert')
  expect(screen.getByRole('button', { name: '일시정지' })).toHaveProperty('disabled', false)
  expect(readTimer('user-a')?.clientSessionId).toBe(draft?.clientSessionId)
  fireEvent.click(screen.getByRole('button', { name: '기록용 책 목록 다시 확인' }))
  await screen.findByLabelText('시간 기록을 확인할 책')
  expect(screen.getByLabelText('어떤 책을 읽으시나요?')).toHaveProperty('value', 'a')
})

test.each(['closed', 'other'])('저장 요청 중 %s 기록에서 측정 책으로 바꿔도 저장 완료 뒤 최신 기록을 표시한다', async (initial) => {
  const reading = book('a')
  let finishSave!: () => void
  mocks.getAllLibraryBooks.mockResolvedValue([reading, book('b', 'completed')])
  mocks.getLibraryBook.mockResolvedValue(reading)
  mocks.saveReadingSession.mockReturnValue(new Promise<void>((resolve) => { finishSave = resolve }))
  writeTimer(startTimer('user-a', 'a', Date.now() - 90_000, crypto.randomUUID()))
  show()
  await screen.findByRole('timer')
  if (initial === 'other') {
    fireEvent.click(screen.getByRole('button', { name: '시간 기록 보기' }))
    fireEvent.change(await screen.findByLabelText('시간 기록을 확인할 책'), { target: { value: 'b' } })
    await screen.findByText('아직 저장한 시간 기록이 없습니다.')
  }
  fireEvent.click(screen.getByRole('button', { name: '종료·저장' }))
  await waitFor(() => expect(mocks.saveReadingSession).toHaveBeenCalledTimes(1))
  if (initial === 'closed') fireEvent.click(screen.getByRole('button', { name: '시간 기록 보기' }))
  fireEvent.change(await screen.findByLabelText('시간 기록을 확인할 책'), { target: { value: 'a' } })
  await screen.findByText('아직 저장한 시간 기록이 없습니다.')
  mocks.getReadingSessions.mockResolvedValue([{ id: 'new', read_date: '2026-11-04', duration_seconds: 90 }])
  await act(async () => finishSave())
  await screen.findByRole('button', { name: /시간 기록 삭제/ })
  expect(screen.getByLabelText('시간 기록을 확인할 책')).toHaveProperty('value', 'a')
  expect(readTimer('user-a')).toBeNull()
})

test.each(['completed', 'deleted'])('이전에 측정한 책이 %s이어도 측정을 복원하고 직접 버릴 수 있다', async (state) => {
  writeTimer(startTimer('user-a', 'old', Date.now() - 90_000, crypto.randomUUID()))
  mocks.getAllLibraryBooks.mockResolvedValue([book('other')])
  if (state === 'deleted') mocks.getLibraryBook.mockRejectedValue(new ApiError(404))
  else mocks.getLibraryBook.mockResolvedValue(book('old', 'completed'))
  show()
  await screen.findByRole('timer')
  expect(readTimer('user-a')?.userBookId).toBe('old')
  fireEvent.click(screen.getByRole('button', { name: '측정 버리기' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '측정 버리기' }))
  await waitFor(() => expect(screen.getByLabelText('어떤 책을 읽으시나요?')).toHaveProperty('disabled', false))
  expect(readTimer('user-a')).toBeNull()
})

test('저장 중 측정한 책이 서재에서 지워져도 화면을 잠그지 않고 측정을 버릴 수 있다', async () => {
  writeTimer(startTimer('user-a', 'old', Date.now() - 90_000, crypto.randomUUID()))
  mocks.getAllLibraryBooks.mockResolvedValue([book('old')])
  mocks.getLibraryBook.mockResolvedValueOnce(book('old')).mockRejectedValue(new ApiError(404))
  mocks.saveReadingSession.mockRejectedValue(new ApiError(404))
  show()
  fireEvent.click(await screen.findByRole('button', { name: '종료·저장' }))
  await waitFor(() => expect(mocks.getLibraryBook).toHaveBeenCalledTimes(2))
  expect(screen.queryByRole('button', { name: '책 목록 다시 확인' })).toBeNull()
  fireEvent.click(await screen.findByRole('button', { name: '측정 버리기' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '측정 버리기' }))
  await waitFor(() => expect(readTimer('user-a')).toBeNull())
})

test('책 상태 재확인 실패 뒤 다시 확인해도 고른 책을 유지한다', async () => {
  mocks.getAllLibraryBooks.mockResolvedValue([book('a'), book('b')])
  mocks.getLibraryBook.mockRejectedValueOnce(new TypeError('network')).mockResolvedValue(book('b'))
  mocks.saveReadingSession.mockResolvedValue({ id: 'saved' })
  show()
  fireEvent.change(await screen.findByLabelText('어떤 책을 읽으시나요?'), { target: { value: 'b' } })
  writeTimer(startTimer('user-a', 'b', Date.now() - 90_000, crypto.randomUUID()))
  act(() => writeTimer(readTimer('user-a')!))
  fireEvent.click(await screen.findByRole('button', { name: '종료·저장' }))
  fireEvent.click(await screen.findByRole('button', { name: '책 목록 다시 확인' }))
  await waitFor(() => expect(screen.getByLabelText('어떤 책을 읽으시나요?')).toHaveProperty('value', 'b'))
})

test.each([new ApiError(404), new ApiError(422), new ApiError(503)])('주소의 책 조회 실패 %s는 목록을 막지 않고 선택하지 않는다', async (failure) => {
  mocks.getAllLibraryBooks.mockResolvedValue([book('other')])
  mocks.getLibraryBook.mockRejectedValue(failure)
  render(<MemoryRouter initialEntries={['/timer?book=stale']}><TimerPage userId="user-a" /></MemoryRouter>)
  expect(await screen.findByLabelText('어떤 책을 읽으시나요?')).toHaveProperty('value', '')
  expect(mocks.getLibraryBook).toHaveBeenCalledWith('token', 'stale')
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByText('서재에서 찾을 수 없는 책')).toBeNull()
})

test('책 조회 실패를 빈 목록으로 표시하지 않고 재시도한다', async () => {
  mocks.getAllLibraryBooks.mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce([book('retry')])
  show()
  await screen.findByRole('alert')
  expect(screen.queryByText(/읽는 중인 책이 없습니다/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '책 목록 다시 확인' }))
  await screen.findByRole('option', { name: '책 retry' })
})

test.each(['reading', 'history'])('다른 탭에서 시작한 측정을 %s 화면에도 복원해 저장·버리기가 막히지 않는다', async (mode) => {
  mocks.getAllLibraryBooks.mockResolvedValue([book('other')])
  mocks.getLibraryBook.mockResolvedValue(book('other'))
  show()
  await screen.findByLabelText('어떤 책을 읽으시나요?')
  if (mode === 'history') {
    fireEvent.click(screen.getByRole('button', { name: '시간 기록 보기' }))
    await screen.findByLabelText('시간 기록을 확인할 책')
  }
  act(() => writeTimer(startTimer('user-a', 'other', Date.now() - 90_000, crypto.randomUUID())))
  await screen.findByRole('button', { name: '측정 버리기' })
  expect(screen.getByRole('timer').textContent).toBe('00:01:30')
})

test('기록 삭제 중 외부 측정으로 화면이 교체돼도 이전 작업의 잠금이 남지 않는다', async () => {
  let finishDelete!: () => void
  mocks.getAllLibraryBooks.mockResolvedValue([book('done', 'completed'), book('other')])
  mocks.getLibraryBook.mockResolvedValue(book('other'))
  mocks.getReadingSessions.mockResolvedValueOnce([{ id: 'session', read_date: '2026-11-04', duration_seconds: 90 }]).mockResolvedValue([])
  mocks.deleteReadingSession.mockReturnValueOnce(new Promise<void>((resolve) => { finishDelete = resolve }))
  show()
  await screen.findByLabelText('어떤 책을 읽으시나요?')
  fireEvent.click(screen.getByRole('button', { name: '시간 기록 보기' }))
  fireEvent.change(await screen.findByLabelText('시간 기록을 확인할 책'), { target: { value: 'done' } })
  fireEvent.click(await screen.findByRole('button', { name: /시간 기록 삭제/ }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '시간 기록 삭제' }))
  expect(screen.getByRole('button', { name: '시간 기록 접기' })).toHaveProperty('disabled', true)
  act(() => writeTimer(startTimer('user-a', 'other', Date.now() - 90_000, crypto.randomUUID())))
  await screen.findByRole('button', { name: '측정 버리기' })
  await act(async () => finishDelete())
  expect(screen.getByRole('button', { name: '시간 기록 접기' })).toHaveProperty('disabled', false)
  fireEvent.click(screen.getByRole('button', { name: '측정 버리기' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '측정 버리기' }))
  await waitFor(() => expect(screen.getByLabelText('어떤 책을 읽으시나요?')).toHaveProperty('disabled', false))
})

test('계정 화면이 닫힌 뒤 이전 목록 응답은 새 계정에 표시하지 않는다', async () => {
  let resolve!: (books: LibraryBookItem[]) => void
  mocks.getAllLibraryBooks.mockReturnValueOnce(new Promise((done) => { resolve = done })).mockResolvedValueOnce([book('B')])
  const view = show()
  view.rerender(<MemoryRouter><TimerPage key="b" userId="user-b" /></MemoryRouter>)
  await screen.findByRole('option', { name: '책 B' })
  await act(async () => resolve([book('A')]))
  expect(screen.queryByRole('option', { name: '책 A' })).toBeNull()
})
