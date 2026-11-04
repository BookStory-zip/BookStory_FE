// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError } from './lib/api'
import type { Shelf } from './lib/api'
import ShelfManager from './ShelfManager'

const mocks = vi.hoisted(() => ({ createShelf: vi.fn(), renameShelf: vi.fn(), moveShelf: vi.fn(), deleteShelf: vi.fn() }))
vi.mock('./lib/api', async (importOriginal) => ({ ...await importOriginal<typeof import('./lib/api')>(), ...mocks }))
vi.mock('./lib/supabase', () => ({ supabase: { auth: {} } }))
vi.mock('./lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/auth')>(),
  withAccessToken: (request: (token: string) => Promise<unknown>) => request('test-token'),
}))

const shelves: Shelf[] = [
  { id: 's1', name: 'SF', book_count: 3, position: 0 },
  { id: 's2', name: '에세이', book_count: 1, position: 1 },
  { id: 's3', name: '시', book_count: 0, position: 2 },
]
const refresh = vi.fn()
const onBusyChange = vi.fn()
const renderManager = () => render(<ShelfManager shelves={shelves} refresh={refresh} onBusyChange={onBusyChange} />)

beforeEach(() => {
  vi.resetAllMocks()
  refresh.mockResolvedValue(true)
})
afterEach(cleanup)

test('새 책장은 이름을 정리해 한 번만 만들고 서버 목록을 다시 받는다', async () => {
  let finish!: (shelf: Shelf) => void
  mocks.createShelf.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
  renderManager()
  fireEvent.click(screen.getByRole('button', { name: '만들기' }))
  expect(screen.getByRole('alert').textContent).toBe('책장 이름을 입력해주세요.')
  fireEvent.change(screen.getByLabelText('새 책장 이름'), { target: { value: '  소설  ' } })
  fireEvent.click(screen.getByRole('button', { name: '만들기' }))
  fireEvent.click(screen.getByRole('button', { name: '만들기' }))
  expect(mocks.createShelf).toHaveBeenCalledTimes(1)
  expect(mocks.createShelf).toHaveBeenCalledWith('test-token', '소설')
  await act(async () => { finish({ id: 's4', name: '소설', book_count: 0, position: 3 }) })
  expect(refresh).toHaveBeenCalledTimes(1)
  expect(screen.getByLabelText('새 책장 이름')).toHaveProperty('value', '')
  expect(screen.getByText('‘소설’ 책장을 만들었습니다.')).toBeTruthy()
})

test.each([
  ['shelf_name_conflict', '같은 이름의 책장이 이미 있어요. 다른 이름을 입력해주세요.'],
  ['shelf_limit_exceeded', '책장은 30개까지 만들 수 있어요.'],
])('책장 만들기 409 %s는 입력을 남기고 안내한다', async (code, message) => {
  mocks.createShelf.mockRejectedValueOnce(new ApiError(409, 'conflict', code))
  renderManager()
  fireEvent.change(screen.getByLabelText('새 책장 이름'), { target: { value: 'sf' } })
  fireEvent.click(screen.getByRole('button', { name: '만들기' }))
  expect((await screen.findByRole('alert')).textContent).toBe(message)
  expect(screen.getByLabelText('새 책장 이름')).toHaveProperty('value', 'sf')
  expect(refresh).not.toHaveBeenCalled()
})

test('이름 바꾸기는 대소문자만 바뀌어도 보내고, 완전히 같으면 요청하지 않는다', async () => {
  mocks.renameShelf.mockResolvedValueOnce({ ...shelves[0], name: 'sf' })
  renderManager()
  fireEvent.click(screen.getByRole('button', { name: 'SF 이름 바꾸기' }))
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  expect(mocks.renameShelf).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'SF 이름 바꾸기' }))
  fireEvent.change(screen.getByLabelText('SF 새 이름'), { target: { value: ' sf ' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await screen.findByText('책장 이름을 바꿨습니다.')
  expect(mocks.renameShelf).toHaveBeenCalledWith('test-token', 's1', 'sf')
})

test('순서 이동은 기준 책장 뒤로 보내고, 맨 앞은 null이며 끝에서는 더 옮기지 않는다', async () => {
  mocks.moveShelf.mockResolvedValue(undefined)
  renderManager()
  expect(screen.getByRole('button', { name: 'SF 앞으로' })).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: '시 뒤로' })).toHaveProperty('disabled', true)
  fireEvent.click(screen.getByRole('button', { name: '에세이 앞으로' }))
  await screen.findByText('책장 순서를 바꿨습니다.')
  fireEvent.click(screen.getByRole('button', { name: 'SF 뒤로' }))
  await vi.waitFor(() => expect(mocks.moveShelf).toHaveBeenCalledTimes(2))
  expect(mocks.moveShelf.mock.calls.map((call) => call.slice(1))).toEqual([['s2', null], ['s1', 's2']])
})

test('순서 이동 404는 원인을 추정하지 않고 책장 목록만 다시 받는다', async () => {
  mocks.moveShelf.mockRejectedValueOnce(new ApiError(404, 'Shelf not found'))
  renderManager()
  fireEvent.click(screen.getByRole('button', { name: '시 앞으로' }))
  expect((await screen.findByRole('alert')).textContent).toContain('최신 책장 목록을 불러왔어요')
  expect(refresh).toHaveBeenCalledTimes(1)
  expect(mocks.moveShelf).toHaveBeenCalledTimes(1)
})

test('결과가 불명확한 쓰기는 다시 보내지 않고 목록만 확인한다', async () => {
  mocks.deleteShelf.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  renderManager()
  fireEvent.click(screen.getByRole('button', { name: '에세이 삭제' }))
  fireEvent.click(within(screen.getByRole('dialog', { hidden: true })).getByRole('button', { name: '책장 삭제', hidden: true }))
  expect((await screen.findByRole('alert')).textContent).toContain('저장 결과를 확인하지 못했습니다')
  expect(mocks.deleteShelf).toHaveBeenCalledTimes(1)
  expect(refresh).toHaveBeenCalledTimes(1)
})

test('책장 삭제는 책이 서재에 남는다고 안내하고, 성공하면 알린다', async () => {
  mocks.deleteShelf.mockResolvedValueOnce(undefined)
  renderManager()
  fireEvent.click(screen.getByRole('button', { name: 'SF 삭제' }))
  const dialog = screen.getByRole('dialog', { hidden: true })
  expect(dialog.textContent).toContain('책은 서재에 그대로 남습니다')
  fireEvent.click(within(dialog).getByRole('button', { name: '책장 삭제', hidden: true }))
  await screen.findByText('‘SF’ 책장을 삭제했습니다. 책은 서재에 그대로 있어요.')
  expect(refresh).toHaveBeenCalledTimes(1)
})

test('저장 중에 책장 관리가 사라지면 부모의 잠금을 푼다', async () => {
  mocks.createShelf.mockReturnValueOnce(new Promise(() => {}))
  const view = renderManager()
  fireEvent.change(screen.getByLabelText('새 책장 이름'), { target: { value: '소설' } })
  fireEvent.click(screen.getByRole('button', { name: '만들기' }))
  expect(onBusyChange).toHaveBeenLastCalledWith(true)
  view.unmount()
  expect(onBusyChange).toHaveBeenLastCalledWith(false)
})

test('이름을 고치던 책장이 사라지면(404) 편집을 버리고 다른 버튼을 다시 쓸 수 있다', async () => {
  mocks.renameShelf.mockRejectedValueOnce(new ApiError(404, 'Shelf not found'))
  const view = renderManager()
  fireEvent.click(screen.getByRole('button', { name: 'SF 이름 바꾸기' }))
  fireEvent.change(screen.getByLabelText('SF 새 이름'), { target: { value: '공상' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await screen.findByRole('alert')
  view.rerender(<ShelfManager shelves={shelves.slice(1)} refresh={refresh} onBusyChange={onBusyChange} />)
  expect(screen.getByRole('button', { name: '에세이 삭제' })).toHaveProperty('disabled', false)
  expect(screen.queryByLabelText('SF 새 이름')).toBeNull()
})
