// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError } from './lib/api'
import type { ReadingNote } from './lib/api'
import ReadingNotes from './ReadingNotes'

const mocks = vi.hoisted(() => ({ getReadingNotes: vi.fn(), createReadingNote: vi.fn(), updateReadingNote: vi.fn(), deleteReadingNote: vi.fn() }))
vi.mock('./lib/api', async (importOriginal) => ({ ...await importOriginal<typeof import('./lib/api')>(), ...mocks }))
vi.mock('./lib/supabase', () => ({ supabase: { auth: {} } }))
vi.mock('./lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/auth')>(),
  withAccessToken: (request: (token: string) => Promise<unknown>) => request('test-token'),
}))

const note = (id: string, patch: Partial<ReadingNote> = {}): ReadingNote => ({
  id, user_book_id: 'ub-1', note_date: '2026-11-01', quote: `문구 ${id}`, thought: null, page: null,
  created_at: '2026-11-01T01:00:00Z', updated_at: '2026-11-01T01:00:00Z', ...patch,
})
const onBusyChange = vi.fn()
const renderNotes = () => render(<ReadingNotes userBookId="ub-1" today="2026-11-04" onBusyChange={onBusyChange} />)

beforeEach(() => vi.resetAllMocks())
afterEach(cleanup)

test('노트를 20개씩 불러오고 더 보기 실패 시 기존 목록과 다음 위치를 유지한다', async () => {
  mocks.getReadingNotes
    .mockResolvedValueOnce(Array.from({ length: 20 }, (_, index) => note(`n${index}`, { page: index === 0 ? 12 : null, thought: index === 0 ? '생각 한 줄' : null })))
    .mockRejectedValueOnce(new ApiError(503))
    .mockResolvedValueOnce([note('n20')])
  renderNotes()
  await screen.findByText('문구 n0')
  expect(screen.getByText('생각 한 줄')).toBeTruthy()
  expect(screen.getByText('12쪽')).toBeTruthy()
  expect(mocks.getReadingNotes).toHaveBeenLastCalledWith('test-token', 'ub-1', 20, 0)

  fireEvent.click(screen.getByRole('button', { name: '노트 더 보기' }))
  expect((await screen.findByRole('alert')).textContent).toContain('잠시 응답할 수 없습니다')
  expect(screen.getByText('문구 n19')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '노트 다시 불러오기' }))
  await screen.findByText('문구 n20')
  expect(mocks.getReadingNotes).toHaveBeenLastCalledWith('test-token', 'ub-1', 20, 20)
  expect(screen.getByText('문구 n0')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '노트 더 보기' })).toBeNull()
})

test('빈 목록과 불러오기 오류를 구분한다', async () => {
  mocks.getReadingNotes.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce([])
  renderNotes()
  expect((await screen.findByRole('alert')).textContent).toContain('서버에 연결하지 못했습니다')
  expect(screen.queryByText('아직 남긴 노트가 없습니다.')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '노트 다시 불러오기' }))
  await screen.findByText('아직 남긴 노트가 없습니다.')
})

test('작성은 앞뒤 공백을 지워 오늘 날짜로 한 번만 보내고 목록을 다시 조회한다', async () => {
  let finish!: (value: ReadingNote) => void
  mocks.getReadingNotes.mockResolvedValueOnce([])
  mocks.createReadingNote.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
  renderNotes()
  await screen.findByText('아직 남긴 노트가 없습니다.')
  fireEvent.click(screen.getByRole('button', { name: '노트 쓰기' }))
  fireEvent.click(screen.getByRole('button', { name: '노트 저장' }))
  expect(screen.getByRole('alert').textContent).toBe('문구나 생각 중 하나는 남겨주세요.')
  expect(mocks.createReadingNote).not.toHaveBeenCalled()

  fireEvent.change(screen.getByLabelText('인상 깊은 문구'), { target: { value: '  밑줄  ' } })
  fireEvent.change(screen.getByLabelText('페이지(선택)'), { target: { value: '7' } })
  fireEvent.click(screen.getByRole('button', { name: '노트 저장' }))
  fireEvent.click(screen.getByRole('button', { name: '저장하는 중…' }))
  expect(mocks.createReadingNote).toHaveBeenCalledTimes(1)
  expect(mocks.createReadingNote).toHaveBeenCalledWith('test-token', 'ub-1', { note_date: '2026-11-04', quote: '밑줄', thought: null, page: 7 })
  expect(onBusyChange).toHaveBeenLastCalledWith(true)

  mocks.getReadingNotes.mockResolvedValueOnce([note('new', { quote: '밑줄', page: 7, note_date: '2026-11-04' })])
  await act(async () => { finish(note('new')) })
  await screen.findByText('밑줄')
  expect(screen.queryByLabelText('인상 깊은 문구')).toBeNull()
  expect(screen.getByText('노트를 저장했습니다.')).toBeTruthy()
  expect(onBusyChange).toHaveBeenLastCalledWith(false)
})

test('작성 결과가 불명확하면 다시 보내지 않고 입력을 남긴 채 목록을 확인한다', async () => {
  mocks.getReadingNotes.mockResolvedValue([])
  mocks.createReadingNote.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  renderNotes()
  await screen.findByText('아직 남긴 노트가 없습니다.')
  fireEvent.click(screen.getByRole('button', { name: '노트 쓰기' }))
  fireEvent.change(screen.getByLabelText('생각'), { target: { value: '오래 남을 생각' } })
  fireEvent.click(screen.getByRole('button', { name: '노트 저장' }))

  expect((await screen.findByRole('alert')).textContent).toContain('저장 결과를 확인하지 못했습니다')
  expect(mocks.createReadingNote).toHaveBeenCalledTimes(1)
  expect(screen.getByLabelText('생각')).toHaveProperty('value', '오래 남을 생각')
  await waitFor(() => expect(mocks.getReadingNotes).toHaveBeenCalledTimes(2))
})

test('서버가 미래 날짜를 거부하면 입력을 보존하고 안내한다', async () => {
  mocks.getReadingNotes.mockResolvedValue([])
  mocks.createReadingNote.mockRejectedValueOnce(new ApiError(422, 'future', 'future_date'))
  renderNotes()
  await screen.findByText('아직 남긴 노트가 없습니다.')
  fireEvent.click(screen.getByRole('button', { name: '노트 쓰기' }))
  fireEvent.change(screen.getByLabelText('인상 깊은 문구'), { target: { value: '문장' } })
  fireEvent.click(screen.getByRole('button', { name: '노트 저장' }))
  expect((await screen.findByRole('alert')).textContent).toBe('오늘 이후 날짜는 선택할 수 없어요.')
  expect(screen.getByLabelText('인상 깊은 문구')).toHaveProperty('value', '문장')
  expect(mocks.getReadingNotes).toHaveBeenCalledTimes(1)
})

test('수정은 바뀐 항목만 보내고 지운 생각·페이지는 null로 보낸다', async () => {
  mocks.getReadingNotes.mockResolvedValueOnce([note('n1', { thought: '생각', page: 3 })])
  mocks.updateReadingNote.mockResolvedValueOnce(note('n1'))
  renderNotes()
  await screen.findByText('문구 n1')
  fireEvent.click(screen.getByRole('button', { name: '2026년 11월 1일 노트 수정' }))
  // 바뀐 내용이 없으면 요청하지 않는다.
  fireEvent.click(screen.getByRole('button', { name: '노트 저장' }))
  expect(mocks.updateReadingNote).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '2026년 11월 1일 노트 수정' }))
  fireEvent.change(screen.getByLabelText('생각'), { target: { value: '  ' } })
  fireEvent.change(screen.getByLabelText('페이지(선택)'), { target: { value: '' } })
  mocks.getReadingNotes.mockResolvedValueOnce([note('n1')])
  fireEvent.click(screen.getByRole('button', { name: '노트 저장' }))
  await screen.findByText('노트를 수정했습니다.')
  expect(mocks.updateReadingNote).toHaveBeenCalledWith('test-token', 'n1', { thought: null, page: null })
  expect(mocks.getReadingNotes).toHaveBeenCalledTimes(2)
})

test('없는 노트를 수정하면 입력을 남기고 목록을 다시 불러온다', async () => {
  mocks.getReadingNotes.mockResolvedValueOnce([note('n1')]).mockResolvedValueOnce([])
  mocks.updateReadingNote.mockRejectedValueOnce(new ApiError(404))
  renderNotes()
  await screen.findByText('문구 n1')
  fireEvent.click(screen.getByRole('button', { name: '2026년 11월 1일 노트 수정' }))
  fireEvent.change(screen.getByLabelText('인상 깊은 문구'), { target: { value: '고친 문구' } })
  fireEvent.click(screen.getByRole('button', { name: '노트 저장' }))
  expect((await screen.findByRole('alert')).textContent).toContain('노트를 찾을 수 없습니다')
  expect(screen.getByLabelText('인상 깊은 문구')).toHaveProperty('value', '고친 문구')
  await screen.findByText('아직 남긴 노트가 없습니다.')
})

test('삭제는 확인 후 보내고 목록을 다시 조회한다', async () => {
  mocks.getReadingNotes.mockResolvedValueOnce([note('n1')]).mockResolvedValueOnce([])
  mocks.deleteReadingNote.mockResolvedValueOnce(undefined)
  renderNotes()
  await screen.findByText('문구 n1')
  fireEvent.click(screen.getByRole('button', { name: '2026년 11월 1일 노트 삭제' }))
  const dialog = screen.getByRole('dialog', { hidden: true })
  fireEvent.click(within(dialog).getByRole('button', { name: '노트 삭제', hidden: true }))
  await screen.findByText('아직 남긴 노트가 없습니다.')
  expect(mocks.deleteReadingNote).toHaveBeenCalledWith('test-token', 'n1')
})

test('화면을 떠난 뒤 늦게 끝난 저장은 목록을 다시 조회하지 않는다', async () => {
  let finish!: (value: ReadingNote) => void
  mocks.getReadingNotes.mockResolvedValueOnce([])
  mocks.createReadingNote.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
  renderNotes()
  await screen.findByText('아직 남긴 노트가 없습니다.')
  fireEvent.click(screen.getByRole('button', { name: '노트 쓰기' }))
  fireEvent.change(screen.getByLabelText('인상 깊은 문구'), { target: { value: '문장' } })
  fireEvent.click(screen.getByRole('button', { name: '노트 저장' }))
  cleanup()
  await act(async () => { finish(note('late')) })
  expect(mocks.getReadingNotes).toHaveBeenCalledTimes(1)
})
