// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError, ApiResponseError } from './lib/api'
import type { ReadingNote } from './lib/api'
import ReadingNotes from './ReadingNotes'
import { SessionMissingError } from './lib/auth'

const mocks = vi.hoisted(() => ({ getReadingNotes: vi.fn(), createReadingNote: vi.fn(), updateReadingNote: vi.fn(), deleteReadingNote: vi.fn(), createReadingPhotoNote: vi.fn(), updateNotePhoto: vi.fn(), deleteNotePhoto: vi.fn() }))
const authState = vi.hoisted(() => ({ failure: null as unknown }))
const photoEditorState = vi.hoisted(() => ({ automatic: true }))
vi.mock('./NotePhotoEditor', async () => {
  const { useEffect } = await import('react')
  return { default: function Editor({ file, onConfirm, onCancel }: { file: File; onConfirm: (file: File) => void; onCancel: () => void }) {
    useEffect(() => { if (photoEditorState.automatic) onConfirm(file) }, [file, onConfirm])
    return photoEditorState.automatic ? null : <div role="dialog" aria-label="사진 편집">
      <button onClick={() => onConfirm(new File(['edited'], 'edited.jpg', { type: 'image/jpeg' }))}>이 사진 사용</button>
      <button onClick={onCancel}>편집 취소</button>
    </div>
  } }
})
vi.mock('./lib/api', async (importOriginal) => ({ ...await importOriginal<typeof import('./lib/api')>(), ...mocks }))
vi.mock('./lib/supabase', () => ({ supabase: { auth: {} } }))
vi.mock('./lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/auth')>(),
  withAccessToken: async (request: (token: string) => Promise<unknown>) => { if (authState.failure) throw authState.failure; return request('test-token') },
}))

const note = (id: string, patch: Partial<ReadingNote> = {}): ReadingNote => ({
  id, user_book_id: 'ub-1', note_date: '2026-11-01', quote: `문구 ${id}`, thought: null, page: null,
  created_at: '2026-11-01T01:00:00Z', updated_at: '2026-11-01T01:00:00Z', has_photo: false, photo_url: null, ...patch,
})
const onBusyChange = vi.fn()
const renderNotes = (blocked = false) => render(<ReadingNotes userBookId="ub-1" today="2026-11-04" blocked={blocked} onBusyChange={onBusyChange} />)

beforeEach(() => {
  vi.resetAllMocks()
  authState.failure = null
  photoEditorState.automatic = true
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})
afterEach(cleanup)

test('새 노트 사진은 편집 확정 결과만 선택하고 편집 취소 시 글과 이전 선택을 보존한다', async () => {
  photoEditorState.automatic = false
  mocks.getReadingNotes.mockResolvedValue([])
  mocks.createReadingPhotoNote.mockResolvedValue(note('edited', { has_photo: true }))
  renderNotes()
  await screen.findByText('아직 남긴 노트가 없습니다.')
  fireEvent.click(screen.getByRole('button', { name: '노트 쓰기' }))
  fireEvent.change(screen.getByLabelText('생각'), { target: { value: '유지할 생각' } })
  fireEvent.change(screen.getByLabelText('사진 선택'), { target: { files: [new File(['x'], 'source.jpg', { type: 'image/jpeg' })] } })
  expect(screen.getByRole('dialog', { name: '사진 편집' })).toBeTruthy()
  expect(mocks.createReadingPhotoNote).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '이 사진 사용' }))
  fireEvent.change(screen.getByLabelText('사진 선택'), { target: { files: [new File(['y'], 'other.jpg', { type: 'image/jpeg' })] } })
  fireEvent.click(screen.getByRole('button', { name: '편집 취소' }))
  expect(screen.getByLabelText('생각')).toHaveProperty('value', '유지할 생각')
  fireEvent.click(screen.getByRole('button', { name: '노트 저장' }))
  await screen.findByText('노트를 저장했습니다.')
  expect(mocks.createReadingPhotoNote.mock.calls[0][3].name).toBe('edited.jpg')
})

test('기존 사진 교체는 편집 취소 시 요청하지 않고 확정 후에만 업로드한다', async () => {
  photoEditorState.automatic = false
  mocks.getReadingNotes.mockResolvedValue([note('n1', { has_photo: true, photo_url: 'https://example.com/old.jpg' })])
  mocks.updateNotePhoto.mockResolvedValue(note('n1', { has_photo: true }))
  renderNotes()
  const input = await screen.findByLabelText('2026년 11월 1일 사진 바꾸기')
  const file = new File(['x'], 'source.jpg', { type: 'image/jpeg' })
  fireEvent.change(input, { target: { files: [file] } })
  expect(mocks.updateNotePhoto).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '편집 취소' }))
  expect(screen.getByAltText('독서 노트 첨부 사진')).toHaveProperty('src', 'https://example.com/old.jpg')
  fireEvent.change(input, { target: { files: [file] } })
  fireEvent.click(screen.getByRole('button', { name: '이 사진 사용' }))
  await waitFor(() => expect(mocks.updateNotePhoto).toHaveBeenCalledTimes(1))
  expect(mocks.updateNotePhoto.mock.calls[0][2].name).toBe('edited.jpg')
})

test('사진 생성 429는 대기 시간을 알리고 입력·파일을 보존해 수동 재시도한다', async () => {
  mocks.getReadingNotes.mockResolvedValue([])
  mocks.createReadingPhotoNote.mockRejectedValueOnce(new ApiError(429, '', 'rate_limited', 30))
    .mockResolvedValueOnce(note('photo', { has_photo: true }))
  renderNotes()
  await screen.findByText('아직 남긴 노트가 없습니다.')
  fireEvent.click(screen.getByRole('button', { name: '노트 쓰기' }))
  fireEvent.change(screen.getByLabelText('생각'), { target: { value: '남길 생각' } })
  const file = new File(['x'], 'x.jpg', { type: 'image/jpeg' })
  fireEvent.change(screen.getByLabelText('사진 선택'), { target: { files: [file] } })
  fireEvent.click(screen.getByRole('button', { name: '노트 저장' }))
  expect((await screen.findByRole('alert')).textContent).toContain('30초 후')
  expect(screen.getByLabelText('생각')).toHaveProperty('value', '남길 생각')
  expect(screen.getByAltText('저장할 사진 미리보기')).toBeTruthy()
  expect(mocks.createReadingPhotoNote).toHaveBeenCalledTimes(1)
  expect(mocks.getReadingNotes).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false))
  fireEvent.click(screen.getByRole('button', { name: '노트 저장' }))
  await screen.findByText('노트를 저장했습니다.')
  expect(mocks.createReadingPhotoNote.mock.calls[1][3]).toBe(file)
})

test('인증 단계 연결 실패는 사진 요청을 보내거나 상세 전체를 잠그지 않는다', async () => {
  mocks.getReadingNotes.mockResolvedValue([])
  renderNotes()
  await screen.findByText('아직 남긴 노트가 없습니다.')
  fireEvent.click(screen.getByRole('button', { name: '노트 쓰기' }))
  fireEvent.change(screen.getByLabelText('사진 선택'), { target: { files: [new File(['x'], 'x.jpg', { type: 'image/jpeg' })] } })
  authState.failure = new TypeError('session fetch failed')
  fireEvent.click(screen.getByRole('button', { name: '노트 저장' }))
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false))
  expect(mocks.createReadingPhotoNote).not.toHaveBeenCalled()
  expect(mocks.getReadingNotes).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('button', { name: '같은 내용으로 다시 확인' })).toBeNull()
})

test.each([new SessionMissingError(), new ApiError(503, '', 'photo_storage_unavailable')])('확정된 사진 저장 실패는 재조회 잠금을 걸지 않는다: %s', async (failure) => {
  mocks.getReadingNotes.mockResolvedValueOnce([]).mockRejectedValue(new TypeError('offline'))
  mocks.createReadingPhotoNote.mockRejectedValueOnce(failure)
  renderNotes()
  await screen.findByText('아직 남긴 노트가 없습니다.')
  fireEvent.click(screen.getByRole('button', { name: '노트 쓰기' }))
  fireEvent.change(screen.getByLabelText('사진 선택'), { target: { files: [new File(['x'], 'x.jpg', { type: 'image/jpeg' })] } })
  fireEvent.click(screen.getByRole('button', { name: '노트 저장' }))
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false))
  expect(mocks.getReadingNotes).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('button', { name: '같은 내용으로 다시 확인' })).toBeNull()
  expect(screen.getByRole('alert').textContent).toContain(failure instanceof SessionMissingError ? '다시 로그인' : '사진 저장소')
})

test('사진 삭제 422는 최신 노트를 조회하고 삭제 안내를 표시한다', async () => {
  mocks.getReadingNotes.mockResolvedValueOnce([note('n1', { has_photo: true, photo_url: 'https://example.com/p.jpg' })])
    .mockResolvedValueOnce([note('n1')])
  mocks.deleteNotePhoto.mockRejectedValue(new ApiError(422, '', 'validation_error'))
  renderNotes()
  fireEvent.click(await screen.findByRole('button', { name: '사진 삭제' }))
  await waitFor(() => expect(mocks.getReadingNotes).toHaveBeenCalledTimes(2))
  expect(screen.queryByRole('button', { name: '사진 삭제' })).toBeNull()
  expect(screen.getByRole('alert').textContent).toContain('삭제')
})

test('같은 이벤트 묶음의 사진 삭제 중복 요청을 막는다', async () => {
  mocks.getReadingNotes.mockResolvedValue([note('n1', { has_photo: true, photo_url: 'https://example.com/p.jpg' })])
  mocks.deleteNotePhoto.mockReturnValue(new Promise(() => {}))
  renderNotes()
  const button = await screen.findByRole('button', { name: '사진 삭제' })
  act(() => { button.click(); button.click() })
  expect(mocks.deleteNotePhoto).toHaveBeenCalledTimes(1)
})

test('여러 사진이 동시에 만료돼도 목록을 한 번만 조회해 함께 갱신한다', async () => {
  const notes = ['a', 'b'].map((id) => note(id, { has_photo: true, photo_url: `https://example.com/${id}.jpg` }))
  let finish!: (notes: ReadingNote[]) => void
  mocks.getReadingNotes.mockResolvedValueOnce(notes).mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
  renderNotes()
  await screen.findByText('문구 b')
  act(() => screen.getAllByAltText('독서 노트 첨부 사진').forEach((img) => fireEvent.error(img)))
  expect(mocks.getReadingNotes).toHaveBeenCalledTimes(2)
  await act(async () => finish(notes.map((item) => ({ ...item, photo_url: `${item.photo_url}?new` }))))
  expect(screen.getAllByAltText('독서 노트 첨부 사진').every((img) => (img as HTMLImageElement).src.endsWith('?new'))).toBe(true)
})

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
  expect((await screen.findByRole('alert')).textContent).toContain('새 노트로 저장할 수 있어요')
  expect(screen.getByLabelText('인상 깊은 문구')).toHaveProperty('value', '고친 문구')
  await screen.findByText('아직 남긴 노트가 없습니다.')

  // 같은 id로 다시 PATCH하지 않고 새 노트로 저장한다.
  mocks.createReadingNote.mockResolvedValueOnce(note('n2', { quote: '고친 문구' }))
  mocks.getReadingNotes.mockResolvedValueOnce([note('n2', { quote: '고친 문구' })])
  fireEvent.click(screen.getByRole('button', { name: '노트 저장' }))
  await screen.findByText('노트를 저장했습니다.')
  expect(mocks.updateReadingNote).toHaveBeenCalledTimes(1)
  expect(mocks.createReadingNote).toHaveBeenCalledWith('test-token', 'ub-1', { note_date: '2026-11-01', quote: '고친 문구', thought: null, page: null })
})

test('저장 뒤 이미 불러온 범위를 한 번에 다시 받아 뒤쪽 노트를 잃지 않는다', async () => {
  const many = Array.from({ length: 45 }, (_, index) => note(`n${index}`))
  mocks.getReadingNotes
    .mockResolvedValueOnce(many.slice(0, 20))
    .mockResolvedValueOnce(many.slice(20, 40))
    .mockResolvedValueOnce(many.slice(0, 40))
  mocks.updateReadingNote.mockResolvedValueOnce(many[30])
  renderNotes()
  await screen.findByText('문구 n19')
  fireEvent.click(screen.getByRole('button', { name: '노트 더 보기' }))
  await screen.findByText('문구 n39')
  fireEvent.click(screen.getAllByRole('button', { name: '2026년 11월 1일 노트 수정' })[30])
  fireEvent.change(screen.getByLabelText('생각'), { target: { value: '추가' } })
  fireEvent.click(screen.getByRole('button', { name: '노트 저장' }))
  await screen.findByText('노트를 수정했습니다.')
  expect(mocks.getReadingNotes).toHaveBeenLastCalledWith('test-token', 'ub-1', 40, 0)
  expect(screen.getByText('문구 n39')).toBeTruthy()
  expect(screen.getByRole('button', { name: '노트 더 보기' })).toBeTruthy()
})

test('책 상세의 다른 저장 중에는 노트를 쓰거나 고치지 않는다', async () => {
  mocks.getReadingNotes.mockResolvedValueOnce([note('n1')])
  renderNotes(true)
  await screen.findByText('문구 n1')
  expect(screen.getByRole('button', { name: '노트 쓰기' })).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: '2026년 11월 1일 노트 수정' })).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: '2026년 11월 1일 노트 삭제' })).toHaveProperty('disabled', true)
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
  expect(onBusyChange).toHaveBeenLastCalledWith(false)
  await act(async () => { finish(note('late')) })
  expect(mocks.getReadingNotes).toHaveBeenCalledTimes(1)
})

test.each([new TypeError('Failed to fetch'), new SyntaxError('Invalid JSON'), new ApiResponseError('Invalid photo metadata'), new ApiError(500)])('사진 저장 결과 불명확 시 같은 파일·내용·UUID로만 명시적으로 재시도한다: %s', async (failure) => {
  mocks.getReadingNotes.mockResolvedValue([])
  mocks.createReadingPhotoNote.mockRejectedValueOnce(failure).mockResolvedValueOnce(note('photo', { quote: null, has_photo: true }))
  renderNotes()
  await screen.findByText('아직 남긴 노트가 없습니다.')
  fireEvent.click(screen.getByRole('button', { name: '노트 쓰기' }))
  const file = new File(['photo'], 'book.jpg', { type: 'image/jpeg' })
  fireEvent.change(screen.getByLabelText('사진 선택'), { target: { files: [file] } })
  fireEvent.click(screen.getByRole('button', { name: '노트 저장' }))
  await screen.findByText(/저장 결과를 확인하지 못했습니다/)
  await waitFor(() => expect(screen.getByRole('button', { name: '같은 내용으로 다시 확인' })).toHaveProperty('disabled', false))
  expect(screen.getByLabelText('생각')).toHaveProperty('disabled', true)
  expect(screen.getByLabelText('사진 선택')).toHaveProperty('disabled', true)
  expect(mocks.createReadingPhotoNote).toHaveBeenCalledTimes(1)
  const first = mocks.createReadingPhotoNote.mock.calls[0]
  expect(first.slice(0, 4)).toEqual(['test-token', 'ub-1', { note_date: '2026-11-04', quote: null, thought: null, page: null }, file])
  expect(first[4]).toMatch(/^[0-9a-f-]{36}$/)
  const retry = screen.getByRole('button', { name: '같은 내용으로 다시 확인' })
  act(() => { retry.click(); retry.click() })
  await screen.findByText('노트를 저장했습니다.')
  expect(mocks.createReadingPhotoNote).toHaveBeenCalledTimes(2)
  expect(mocks.createReadingPhotoNote.mock.calls[1]).toEqual(first)
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
})

test('100개 뒤 사진 주소를 갱신해도 이미 불러온 노트와 더 보기 위치를 유지한다', async () => {
  const many = Array.from({ length: 120 }, (_, index) => note(`n${index}`, index === 110 ? { has_photo: true, photo_url: 'https://example.com/old.jpg' } : {}))
  for (let offset = 0; offset < many.length; offset += 20) mocks.getReadingNotes.mockResolvedValueOnce(many.slice(offset, offset + 20))
  mocks.getReadingNotes.mockResolvedValueOnce(many.slice(0, 100)).mockResolvedValueOnce(many.slice(100).map((item) => item.id === 'n110' ? { ...item, photo_url: 'https://example.com/fresh.jpg' } : item))
  renderNotes()
  await screen.findByText('문구 n19')
  for (let index = 1; index < 6; index += 1) {
    fireEvent.click(screen.getByRole('button', { name: '노트 더 보기' }))
    await screen.findByText(`문구 n${index * 20 + 19}`)
  }
  fireEvent.error(screen.getByAltText('독서 노트 첨부 사진'))
  await waitFor(() => expect(screen.getByAltText('독서 노트 첨부 사진')).toHaveProperty('src', 'https://example.com/fresh.jpg'))
  expect(screen.getByText('문구 n0')).toBeTruthy()
  expect(screen.getByText('문구 n119')).toBeTruthy()
  expect(mocks.getReadingNotes).toHaveBeenLastCalledWith('test-token', 'ub-1', 100, 100)
  mocks.getReadingNotes.mockResolvedValueOnce([])
  fireEvent.click(screen.getByRole('button', { name: '노트 더 보기' }))
  await waitFor(() => expect(mocks.getReadingNotes).toHaveBeenLastCalledWith('test-token', 'ub-1', 20, 120))
})

test('잘못된 파일과 10MiB 초과 파일은 요청하지 않고 사진 선택을 유지한다', async () => {
  mocks.getReadingNotes.mockResolvedValue([])
  renderNotes()
  await screen.findByText('아직 남긴 노트가 없습니다.')
  fireEvent.click(screen.getByRole('button', { name: '노트 쓰기' }))
  fireEvent.change(screen.getByLabelText('사진 선택'), { target: { files: [new File(['x'], 'x.txt', { type: 'text/plain' })] } })
  expect(screen.getByRole('alert')).toBeTruthy()
  const large = new File(['x'], 'large.jpg', { type: 'image/jpeg' })
  Object.defineProperty(large, 'size', { value: 10 * 1024 * 1024 + 1 })
  fireEvent.change(screen.getByLabelText('사진 선택'), { target: { files: [large] } })
  expect(screen.getByRole('alert').textContent).toContain('10')
  expect(mocks.createReadingPhotoNote).not.toHaveBeenCalled()
  expect(screen.queryByAltText('저장할 사진 미리보기')).toBeNull()
})

test('기존 사진 응답이 없으면 재조회 성공 전 다음 변경을 막고 재전송하지 않는다', async () => {
  mocks.getReadingNotes.mockResolvedValueOnce([note('n1')]).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce([])
  mocks.updateNotePhoto.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  renderNotes()
  await screen.findByText('문구 n1')
  fireEvent.change(screen.getByLabelText('2026년 11월 1일 사진 추가'), { target: { files: [new File(['x'], 'x.jpg', { type: 'image/jpeg' })] } })
  await screen.findByRole('button', { name: '노트 다시 불러오기' })
  expect(screen.getByRole('button', { name: '노트 쓰기' })).toHaveProperty('disabled', true)
  expect(onBusyChange).toHaveBeenLastCalledWith(true)
  fireEvent.click(screen.getByRole('button', { name: '노트 다시 불러오기' }))
  await screen.findByText('아직 남긴 노트가 없습니다.')
  expect(mocks.updateNotePhoto).toHaveBeenCalledTimes(1)
  expect(onBusyChange).toHaveBeenLastCalledWith(false)
})

test('URL이 없어도 사진 노트의 텍스트를 수정하며 사진만 있는 노트의 사진 삭제는 막는다', async () => {
  mocks.getReadingNotes.mockResolvedValue([note('n1', { quote: null, has_photo: true })])
  mocks.updateReadingNote.mockResolvedValue(note('n1', { quote: null, has_photo: true, page: 3 }))
  renderNotes()
  await screen.findByText(/사진만 있는 노트는/)
  expect(screen.queryByRole('button', { name: '사진 삭제' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '2026년 11월 1일 노트 수정' }))
  expect(screen.getByLabelText('2026년 11월 1일 사진 바꾸기')).toHaveProperty('disabled', true)
  fireEvent.change(screen.getByLabelText('페이지(선택)'), { target: { value: '3' } })
  fireEvent.click(screen.getByRole('button', { name: '노트 저장' }))
  await screen.findByText('노트를 수정했습니다.')
  expect(mocks.updateReadingNote).toHaveBeenCalledWith('test-token', 'n1', { page: 3 })
})

test('계정 화면을 떠나면 사진 요청의 늦은 응답은 새 계정의 목록과 상태를 바꾸지 않는다', async () => {
  let finish!: (value: ReadingNote) => void
  mocks.getReadingNotes.mockResolvedValue([])
  mocks.createReadingPhotoNote.mockReturnValue(new Promise((resolve) => { finish = resolve }))
  const old = renderNotes()
  await screen.findByText('아직 남긴 노트가 없습니다.')
  fireEvent.click(screen.getByRole('button', { name: '노트 쓰기' }))
  fireEvent.change(screen.getByLabelText('사진 선택'), { target: { files: [new File(['x'], 'private.jpg', { type: 'image/jpeg' })] } })
  fireEvent.click(screen.getByRole('button', { name: '노트 저장' }))
  old.unmount()
  expect(onBusyChange).toHaveBeenLastCalledWith(false)
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  renderNotes()
  await screen.findByText('아직 남긴 노트가 없습니다.')
  await act(async () => { finish(note('old-account', { has_photo: true })) })
  expect(mocks.getReadingNotes).toHaveBeenCalledTimes(2)
  expect(screen.queryByText('노트를 저장했습니다.')).toBeNull()
  expect(screen.queryByText('private.jpg')).toBeNull()
})

test('기존 텍스트 저장 오류는 입력을 남기고 사진 변경을 허용하지 않는다', async () => {
  mocks.getReadingNotes.mockResolvedValue([note('n1', { has_photo: true })])
  mocks.updateReadingNote.mockRejectedValue(new ApiError(503))
  renderNotes()
  await screen.findByText('문구 n1')
  fireEvent.click(screen.getByRole('button', { name: '2026년 11월 1일 노트 수정' }))
  fireEvent.change(screen.getByLabelText('생각'), { target: { value: '미저장 생각' } })
  fireEvent.click(screen.getByRole('button', { name: '노트 저장' }))
  await screen.findByRole('alert')
  expect(screen.getByLabelText('생각')).toHaveProperty('value', '미저장 생각')
  expect(screen.getByLabelText('2026년 11월 1일 사진 바꾸기')).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: '사진 삭제' })).toHaveProperty('disabled', true)
})
