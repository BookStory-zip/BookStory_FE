// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError } from './lib/api'
import type { LibraryBookItem } from './lib/api'
import { clearTimer, readTimer, startTimer, writeTimer } from './lib/timer'
import TimerPage from './TimerPage'

const mocks = vi.hoisted(() => ({ getAllLibraryBooks: vi.fn(), getLibraryBook: vi.fn(), getReadingSessions: vi.fn(), saveReadingSession: vi.fn() }))
vi.mock('./lib/api', async (original) => ({ ...await original<typeof import('./lib/api')>(), ...mocks }))
vi.mock('./lib/supabase', () => ({ supabase: { auth: {} } }))
vi.mock('./lib/auth', async (original) => ({ ...await original<typeof import('./lib/auth')>(), withAccessToken: (request: (token: string) => Promise<unknown>) => request('token') }))

function book(id: string, status: LibraryBookItem['status'] = 'reading'): LibraryBookItem {
  return { id, book_id: `catalog-${id}`, isbn13: '9788936433598', title: `책 ${id}`, authors: [], thumbnail_url: null, status, created_at: '2026-11-01T00:00:00Z', page_count: null, total_pages: null, current_page: null, progress_percent: null }
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
  expect(screen.queryByRole('button', { name: '시작' })).toBeNull()
  fireEvent.change(select, { target: { value: '100' } })
  fireEvent.click(screen.getByRole('button', { name: '선택 완료' }))
  fireEvent.click(screen.getByRole('button', { name: '시작' }))
  expect(readTimer('user-a')?.userBookId).toBe('100')
  expect(screen.queryByLabelText('어떤 책을 읽으시나요?')).toBeNull()
  expect(mocks.getReadingSessions).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: '시간 기록 보기' })).toBeNull()
  expect(screen.queryByLabelText('시간 기록을 확인할 책')).toBeNull()
  expect(document.querySelector('.timer-history-toggle')).toBeNull()
  expect(document.querySelector('#timer-history-panel')).toBeNull()
})

test('책 선택 뒤에는 제목·시간·조작만 남기고 측정 전 제목에서 책 선택으로 돌아간다', async () => {
  mocks.getAllLibraryBooks.mockResolvedValue([book('one'), book('two')])
  show()
  const select = await screen.findByLabelText('어떤 책을 읽으시나요?')
  select.focus()
  fireEvent.change(select, { target: { value: 'one' } })
  expect(document.activeElement).toBe(select)
  fireEvent.change(select, { target: { value: 'two' } })
  expect(select).toHaveProperty('value', 'two')
  fireEvent.change(select, { target: { value: 'one' } })
  fireEvent.click(screen.getByRole('button', { name: '선택 완료' }))
  expect(screen.queryByLabelText('어떤 책을 읽으시나요?')).toBeNull()
  expect(screen.getByRole('heading', { name: '책 one', level: 1 })).toBeTruthy()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '시작' }))
  expect(screen.getByRole('button', { name: '시작' }).textContent).toBe('시작')
  expect(screen.queryByText('타이머 사용법')).toBeNull()
  expect(screen.queryByRole('progressbar')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '책 one, 읽을 책 변경' }))
  expect(document.activeElement).toBe(screen.getByLabelText('어떤 책을 읽으시나요?'))
})

test('주소로 선택한 책을 해제하면 재조회해도 주소의 책을 복원하지 않는다', async () => {
  mocks.getAllLibraryBooks.mockResolvedValue([book('a'), book('b')])
  mocks.getLibraryBook.mockResolvedValue(book('a'))
  render(<MemoryRouter initialEntries={['/timer?book=a']}><TimerPage userId="user-a" /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: '책 a, 읽을 책 변경' }))
  mocks.getAllLibraryBooks.mockRejectedValueOnce(new TypeError('network'))
  act(() => writeTimer(startTimer('user-a', 'b', Date.now(), crypto.randomUUID())))
  await screen.findByRole('alert')
  act(() => clearTimer('user-a'))
  mocks.getLibraryBook.mockClear()
  fireEvent.click(screen.getByRole('button', { name: '책 목록 다시 확인' }))
  await screen.findByLabelText('어떤 책을 읽으시나요?')
  expect(mocks.getLibraryBook).not.toHaveBeenCalled()
  expect(screen.queryByRole('timer')).toBeNull()
})

test('저장하는 동안 책 선택을 잠그고 완료하면 기록 조회 없이 다시 측정한다', async () => {
  let finishSave!: () => void
  mocks.getAllLibraryBooks.mockResolvedValue([book('a'), book('b')])
  mocks.getLibraryBook.mockResolvedValue(book('a'))
  mocks.saveReadingSession.mockReturnValue(new Promise<void>((resolve) => { finishSave = resolve }))
  writeTimer(startTimer('user-a', 'a', Date.now() - 90_000, crypto.randomUUID()))
  show()
  fireEvent.click(await screen.findByRole('button', { name: '완료' }))
  await waitFor(() => expect(mocks.saveReadingSession).toHaveBeenCalledTimes(1))
  expect(screen.queryByLabelText('어떤 책을 읽으시나요?')).toBeNull()
  await act(async () => finishSave())
  await waitFor(() => expect(screen.getByRole('button', { name: '책 a, 읽을 책 변경' })).toHaveProperty('disabled', false))
  expect(readTimer('user-a')).toBeNull()
  expect(screen.getByRole('button', { name: '시작' })).toHaveProperty('disabled', false)
  expect(mocks.getLibraryBook).toHaveBeenCalledTimes(2)
  expect(mocks.getReadingSessions).not.toHaveBeenCalled()
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
  await waitFor(() => expect(screen.getByRole('button', { name: /읽을 책 변경/ })).toHaveProperty('disabled', false))
  expect(readTimer('user-a')).toBeNull()
})

test('저장 중 측정한 책이 서재에서 지워져도 화면을 잠그지 않고 측정을 버릴 수 있다', async () => {
  writeTimer(startTimer('user-a', 'old', Date.now() - 90_000, crypto.randomUUID()))
  mocks.getAllLibraryBooks.mockResolvedValue([book('old')])
  mocks.getLibraryBook.mockResolvedValueOnce(book('old')).mockRejectedValue(new ApiError(404))
  mocks.saveReadingSession.mockRejectedValue(new ApiError(404))
  show()
  fireEvent.click(await screen.findByRole('button', { name: '완료' }))
  await waitFor(() => expect(mocks.getLibraryBook).toHaveBeenCalledTimes(2))
  expect(screen.queryByRole('button', { name: '책 목록 다시 확인' })).toBeNull()
  fireEvent.click(await screen.findByRole('button', { name: '측정 버리기' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '측정 버리기' }))
  await waitFor(() => expect(readTimer('user-a')).toBeNull())
})

test('책 상태 재확인 실패 뒤 다시 확인해도 고른 책을 유지한다', async () => {
  let finishReload!: (value: LibraryBookItem) => void
  mocks.getAllLibraryBooks.mockResolvedValue([book('a'), book('b')])
  mocks.getLibraryBook.mockRejectedValueOnce(new TypeError('network')).mockReturnValueOnce(new Promise((resolve) => { finishReload = resolve }))
  mocks.saveReadingSession.mockResolvedValue({ id: 'saved' })
  show()
  fireEvent.change(await screen.findByLabelText('어떤 책을 읽으시나요?'), { target: { value: 'b' } })
  fireEvent.click(screen.getByRole('button', { name: '선택 완료' }))
  writeTimer(startTimer('user-a', 'b', Date.now() - 90_000, crypto.randomUUID()))
  act(() => writeTimer(readTimer('user-a')!))
  fireEvent.click(await screen.findByRole('button', { name: '완료' }))
  fireEvent.click(await screen.findByRole('button', { name: '책 목록 다시 확인' }))
  expect(screen.getByRole('button', { name: '책 b, 읽을 책 변경' })).toHaveProperty('disabled', true)
  await act(async () => finishReload(book('b')))
  await waitFor(() => expect(screen.getByRole('heading', { name: '책 b' })).toBeTruthy())
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

test('다른 탭에서 시작한 측정을 복원해 저장·버리기가 막히지 않는다', async () => {
  mocks.getAllLibraryBooks.mockResolvedValue([book('other')])
  mocks.getLibraryBook.mockResolvedValue(book('other'))
  show()
  await screen.findByLabelText('어떤 책을 읽으시나요?')
  act(() => writeTimer(startTimer('user-a', 'other', Date.now() - 90_000, crypto.randomUUID())))
  fireEvent.click(await screen.findByRole('button', { name: '일시정지' }))
  expect(screen.getByRole('button', { name: '측정 버리기' })).toBeTruthy()
  expect(screen.getByRole('timer').textContent).toBe('00:01:30')
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
