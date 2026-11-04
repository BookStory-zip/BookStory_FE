import { afterEach, expect, test, vi } from 'vitest'
import * as api from './api'

const payload = { client_session_id: '00000000-0000-4000-8000-000000000001', started_at: '2026-11-04T20:00:00+09:00', duration_seconds: 90 }
const session = { id: 'session-1', user_book_id: 'own/1', ...payload, started_at: '2026-11-04T11:00:00Z', read_date: '2026-11-04', created_at: '2026-11-04T11:02:00Z' }

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
function mockFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')
  return fetchMock
}

test.each([201, 200])('시간 저장 %s는 재시도 식별자와 측정 값을 보내고 같은 구간 응답만 받는다', async (status) => {
  const fetchMock = mockFetch(Response.json(session, { status }))
  await expect(api.saveReadingSession('token', 'own/1', payload)).resolves.toEqual(session)
  expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/library/books/own%2F1/reading-sessions', expect.objectContaining({ method: 'POST', body: JSON.stringify(payload), headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' } }))
})

test.each([
  { user_book_id: 'other' }, { client_session_id: 'other' }, { duration_seconds: 120 },
  { started_at: '2026-11-04T12:00:00Z' }, { read_date: '2026-11-03' },
])('다른 구간이나 날짜가 돌아오면 성공으로 처리하지 않는다: %j', async (changed) => {
  mockFetch(Response.json({ ...session, ...changed }, { status: 201 }))
  await expect(api.saveReadingSession('token', 'own/1', payload)).rejects.toThrow('시간 기록 응답')
})

test('시간 기록 목록은 개인 서재 id와 limit·offset으로 조회한다', async () => {
  const fetchMock = mockFetch(Response.json([session]))
  await expect(api.getReadingSessions('token', 'own/1', 20, 40)).resolves.toEqual([session])
  expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/library/books/own%2F1/reading-sessions?limit=20&offset=40')
})

test('시간 기록 삭제는 세션 id를 쓰고 204 본문을 읽지 않는다', async () => {
  const fetchMock = mockFetch(new Response(null, { status: 204 }))
  await expect(api.deleteReadingSession('token', 'session/1')).resolves.toBeUndefined()
  expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/reading-sessions/session%2F1', expect.objectContaining({ method: 'DELETE' }))
})

test.each([undefined, -1, 1.5])('통계의 독서 시간 %j는 잘못된 응답으로 거부한다', async (minutes) => {
  mockFetch(Response.json({ library: { total_books: 0, completed_books: 0, status_counts: { want_to_read: 0, reading: 0, completed: 0, paused: 0, abandoned: 0 } }, period: { year: 2026, month: 11, start_date: '2026-11-01', end_date: '2026-11-30', reading_days: 0, reading_minutes: minutes } }))
  await expect(api.getReadingStatistics('token', 2026, 11)).rejects.toThrow('통계 응답')
})
