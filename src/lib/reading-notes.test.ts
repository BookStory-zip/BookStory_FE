import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError, createReadingPhotoNote, updateNotePhoto, deleteNotePhoto, createReadingNote, deleteReadingNote, getNoteTimeline, getReadingNotes, updateReadingNote } from './api'

const note = {
  id: 'note-1', user_book_id: 'ub-1', note_date: '2026-11-01', quote: '문구', thought: null, page: null,
  has_photo: false, photo_url: null,
  created_at: '2026-11-01T01:00:00Z', updated_at: '2026-11-01T01:00:00Z',
}
const entry = { ...note, title: '소년이 온다', authors: ['한강'], thumbnail_url: null }

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

test('사진 multipart 업로드에는 일반 JSON보다 긴 제한 시간을 사용한다', async () => {
  const timeout = vi.spyOn(AbortSignal, 'timeout')
  fetchMock.mockResolvedValue(Response.json({ ...note, has_photo: true }))
  await updateNotePhoto('t', note.id, new File(['x'], 'x.jpg', { type: 'image/jpeg' }))
  expect(timeout).toHaveBeenLastCalledWith(300_000)
  timeout.mockRestore()
})
const sent = () => {
  const [url, init] = fetchMock.mock.calls[0]
  return { url, method: init.method, body: init.body === undefined ? undefined : JSON.parse(init.body) }
}

test('노트 작성은 서재 id 경로로 note_date를 포함해 보내고 201 응답을 돌려준다', async () => {
  fetchMock.mockResolvedValue(Response.json(note, { status: 201 }))
  const input = { note_date: '2026-11-01', quote: '문구', thought: null, page: null }
  await expect(createReadingNote('t', 'ub-1', input)).resolves.toEqual(note)
  expect(sent()).toEqual({ url: 'https://api.example.test/library/books/ub-1/notes', method: 'POST', body: input })
})

test('책별 노트 목록과 기간 타임라인을 limit/offset으로 조회한다', async () => {
  fetchMock.mockResolvedValueOnce(Response.json([note])).mockResolvedValueOnce(Response.json([entry]))
  await expect(getReadingNotes('t', 'ub-1', 20, 40)).resolves.toEqual([note])
  await expect(getNoteTimeline('t', '2026-11-01', '2026-11-30', 20, 0)).resolves.toEqual([entry])
  expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/library/books/ub-1/notes?limit=20&offset=40')
  expect(fetchMock.mock.calls[1][0]).toBe('https://api.example.test/notes?start_date=2026-11-01&end_date=2026-11-30&limit=20&offset=0')
})

test('수정은 보낸 항목만 PATCH하고 삭제 204는 본문을 읽지 않는다', async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ ...note, thought: null })).mockResolvedValueOnce(new Response(null, { status: 204 }))
  await updateReadingNote('t', 'note-1', { thought: null })
  expect(sent()).toEqual({ url: 'https://api.example.test/notes/note-1', method: 'PATCH', body: { thought: null } })
  await expect(deleteReadingNote('t', 'note-1')).resolves.toBeUndefined()
  expect(fetchMock.mock.calls[1][1].method).toBe('DELETE')
})

test.each([
  { ...note, quote: null, thought: null },
  { ...note, page: 0 },
  { ...note, note_date: '2026-11-1' },
  { ...note, user_book_id: 'other' },
])('형식이 다르거나 다른 책의 노트 응답을 거부한다: %j', async (body) => {
  fetchMock.mockResolvedValue(Response.json([body]))
  await expect(getReadingNotes('t', 'ub-1', 20, 0)).rejects.toThrow('노트 응답 형식이 올바르지 않습니다.')
})

test('책 정보가 빠진 타임라인 항목을 거부한다', async () => {
  fetchMock.mockResolvedValue(Response.json([note]))
  await expect(getNoteTimeline('t', '2026-11-01', '2026-11-30', 20, 0)).rejects.toThrow('노트 응답 형식이 올바르지 않습니다.')
})

const photo = new File(['image'], 'note.jpg', { type: 'image/jpeg' })
const photoOnly = { ...note, quote: null, has_photo: true, photo_url: null }

test.each([200, 201])('multipart creation accepts success and idempotent statuses %i', async (status) => {
  fetchMock.mockResolvedValue(Response.json(photoOnly, { status }))
  await expect(createReadingPhotoNote('token', 'ub-1', { note_date: note.note_date, quote: null, thought: null, page: null }, photo, 'client-1')).resolves.toEqual(photoOnly)
  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('https://api.example.test/library/books/ub-1/notes/photo')
  expect(init.method).toBe('POST')
  expect(init.headers).toEqual({ Authorization: 'Bearer token' })
  expect(init.body).toBeInstanceOf(FormData)
  expect([...init.body.keys()]).toEqual(['photo', 'note_date', 'client_note_id'])
  expect(init.body.get('photo').name).toBe('note.jpg')
  expect(init.body.get('note_date')).toBe(note.note_date)
  expect(init.body.get('client_note_id')).toBe('client-1')
})

test('photo creation optional fields, replacement and deletion', async () => {
  fetchMock.mockResolvedValueOnce(Response.json(note)).mockResolvedValueOnce(Response.json(photoOnly)).mockResolvedValueOnce(new Response(null, { status: 204 }))
  await createReadingPhotoNote('t', 'ub-1', { note_date: note.note_date, quote: 'quote', thought: 'thought', page: 12 }, photo, 'client-1')
  expect([...fetchMock.mock.calls[0][1].body.entries()].slice(3)).toEqual([['quote', 'quote'], ['thought', 'thought'], ['page', '12']])
  await expect(updateNotePhoto('t', 'note-1', photo)).resolves.toEqual(photoOnly)
  const [url, init] = fetchMock.mock.calls[1]
  expect(url).toBe('https://api.example.test/notes/note-1/photo')
  expect(init.method).toBe('PUT')
  expect([...init.body.keys()]).toEqual(['photo'])
  expect(init.headers).toEqual({ Authorization: 'Bearer t' })
  await expect(deleteNotePhoto('t', 'note-1')).resolves.toBeUndefined()
  expect(fetchMock.mock.calls[2][1].method).toBe('DELETE')
})

test('photo-only notes with null URLs work in lists, timeline and PATCH', async () => {
  fetchMock.mockResolvedValueOnce(Response.json([photoOnly])).mockResolvedValueOnce(Response.json([{ ...entry, ...photoOnly }])).mockResolvedValueOnce(Response.json(photoOnly))
  await expect(getReadingNotes('t', 'ub-1', 20, 0)).resolves.toEqual([photoOnly])
  await expect(getNoteTimeline('t', note.note_date, note.note_date, 20, 0)).resolves.toHaveLength(1)
  await expect(updateReadingNote('t', 'note-1', { quote: null })).resolves.toEqual(photoOnly)
})

test.each([
  { ...note, has_photo: undefined }, { ...note, has_photo: 'true' },
  { ...note, photo_url: undefined }, { ...note, photo_url: 42 },
  { ...note, photo_url: 'https://images.example.test/a.jpg' },
])('invalid photo metadata is rejected %j', async (invalid) => {
  fetchMock.mockResolvedValue(Response.json([invalid]))
  await expect(getReadingNotes('t', 'ub-1', 20, 0)).rejects.toThrow()
})

test('photo creation and replacement reject mismatched identifiers', async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ ...photoOnly, user_book_id: 'other' })).mockResolvedValueOnce(Response.json({ ...photoOnly, id: 'other' }))
  await expect(createReadingPhotoNote('t', 'ub-1', note, photo, 'client')).rejects.toThrow()
  await expect(updateNotePhoto('t', 'note-1', photo)).rejects.toThrow()
})

test('photo URLs survive creation, listing, timeline and metadata updates', async () => {
  const uploaded = { ...photoOnly, photo_url: 'https://images.example.test/signed.jpg?signature=example' }
  fetchMock.mockResolvedValueOnce(Response.json(uploaded, { status: 201 }))
    .mockResolvedValueOnce(Response.json([uploaded]))
    .mockResolvedValueOnce(Response.json([{ ...entry, ...uploaded }]))
    .mockResolvedValueOnce(Response.json(uploaded))
  await expect(createReadingPhotoNote('t', 'ub-1', note, photo, 'client')).resolves.toEqual(uploaded)
  await expect(getReadingNotes('t', 'ub-1', 20, 0)).resolves.toEqual([uploaded])
  await expect(getNoteTimeline('t', note.note_date, note.note_date, 20, 0)).resolves.toEqual([{ ...entry, ...uploaded }])
  await expect(updateReadingNote('t', 'note-1', { quote: null })).resolves.toEqual(uploaded)
})

test.each([
  [422, 'unsupported_image'], [413, 'image_too_large'], [503, 'photo_storage_unavailable'],
])('multipart preserves API failure status and code %i %s', async (status, code) => {
  fetchMock.mockResolvedValue(Response.json({ detail: 'Photo rejected', code }, { status }))
  const result = createReadingPhotoNote('t', 'ub-1', note, photo, 'client')
  await expect(result).rejects.toBeInstanceOf(ApiError)
  await expect(result).rejects.toMatchObject({ status, code, message: 'Photo rejected' })
  expect(fetchMock).toHaveBeenCalledTimes(1)
})
