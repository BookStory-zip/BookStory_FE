import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createReadingNote, deleteReadingNote, getNoteTimeline, getReadingNotes, updateReadingNote } from './api'

const note = {
  id: 'note-1', user_book_id: 'ub-1', note_date: '2026-11-01', quote: '문구', thought: null, page: null,
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
