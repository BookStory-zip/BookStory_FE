// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError } from './lib/api'
import BookShelves from './BookShelves'

const mocks = vi.hoisted(() => ({ getShelves: vi.fn(), addBookToShelf: vi.fn(), removeBookFromShelf: vi.fn() }))
vi.mock('./lib/api', async (importOriginal) => ({ ...await importOriginal<typeof import('./lib/api')>(), ...mocks }))
vi.mock('./lib/supabase', () => ({ supabase: { auth: {} } }))
vi.mock('./lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/auth')>(),
  withAccessToken: (request: (token: string) => Promise<unknown>) => request('test-token'),
}))

const all = [
  { id: 's1', name: 'SF', book_count: 1, position: 0 },
  { id: 's2', name: '에세이', book_count: 0, position: 1 },
]
const onChanged = vi.fn()
const onBusyChange = vi.fn()
const renderShelves = (current = [{ id: 's1', name: 'SF' }]) =>
  render(<MemoryRouter><BookShelves userBookId="ub-1" current={current} blocked={false} onChanged={onChanged} onBusyChange={onBusyChange} /></MemoryRouter>)

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getShelves.mockResolvedValue(all)
  onChanged.mockResolvedValue(true)
})
afterEach(cleanup)

test('상세의 소속을 체크로 보이고, 넣기·빼기는 서재 id로 보낸 뒤 상세와 책장을 다시 받는다', async () => {
  mocks.addBookToShelf.mockResolvedValue(undefined)
  mocks.removeBookFromShelf.mockResolvedValue(undefined)
  renderShelves()
  const essay = await screen.findByRole('checkbox', { name: '에세이' })
  expect(screen.getByRole('checkbox', { name: 'SF' })).toHaveProperty('checked', true)
  expect(essay).toHaveProperty('checked', false)

  fireEvent.click(essay)
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
  expect(mocks.addBookToShelf).toHaveBeenCalledWith('test-token', 's2', 'ub-1')
  // 성공 뒤에는 상세만 다시 받는다.
  expect(mocks.getShelves).toHaveBeenCalledTimes(1)
  // 서버 상세가 바뀌기 전에는 체크된 것으로 보이지 않는다.
  expect(essay).toHaveProperty('checked', false)

  fireEvent.click(screen.getByRole('checkbox', { name: 'SF' }))
  await waitFor(() => expect(mocks.removeBookFromShelf).toHaveBeenCalledWith('test-token', 's1', 'ub-1'))
})

test('넣기 실패는 안내하고, 404면 다시 보내지 않고 상세와 책장을 다시 받는다', async () => {
  mocks.addBookToShelf.mockRejectedValueOnce(new ApiError(503)).mockRejectedValueOnce(new ApiError(404, 'Shelf not found'))
  renderShelves([])
  fireEvent.click(await screen.findByRole('checkbox', { name: 'SF' }))
  expect((await screen.findByRole('alert')).textContent).toContain('잠시 응답할 수 없습니다')
  expect(onChanged).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('checkbox', { name: 'SF' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('최신 정보를 불러왔어요'))
  expect(onChanged).toHaveBeenCalledTimes(1)
  expect(mocks.addBookToShelf).toHaveBeenCalledTimes(2)
})

test('책장이 없으면 서재의 책장 관리로 안내한다', async () => {
  mocks.getShelves.mockResolvedValue([])
  renderShelves([])
  await screen.findByText(/아직 만든 책장이 없습니다/)
  expect(screen.getByRole('link', { name: '서재의 책장 관리' }).getAttribute('href')).toBe('/')
})
