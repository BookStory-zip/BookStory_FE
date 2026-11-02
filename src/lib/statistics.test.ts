import { afterEach, expect, test, vi } from 'vitest'
import { getReadingStatistics } from './api'

const statistics = {
  library: {
    total_books: 5,
    status_counts: { want_to_read: 1, reading: 1, completed: 1, paused: 1, abandoned: 1 },
    completed_books: 2,
  },
  period: {
    year: 2026, month: 10, start_date: '2026-10-01', end_date: '2026-10-31', reading_days: 3,
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

test.each([
  [10, '/me/statistics?year=2026&month=10'],
  [undefined, '/me/statistics?year=2026'],
])('통계에 현재 토큰과 연간·월간 조회 조건을 전달한다: %s', async (month, path) => {
  const body = {
    ...statistics,
    period: {
      ...statistics.period,
      month: month ?? null,
      start_date: month ? '2026-10-01' : '2026-01-01',
      end_date: month ? '2026-10-31' : '2026-12-31',
    },
  }
  const fetchMock = vi.fn().mockResolvedValue(Response.json(body))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')

  await expect(getReadingStatistics('test-token', 2026, month)).resolves.toEqual(body)
  expect(fetchMock).toHaveBeenCalledWith(`https://api.example.test${path}`, {
    headers: { Authorization: 'Bearer test-token' },
    signal: expect.any(AbortSignal),
  })
})

test.each([
  { ...statistics, library: { ...statistics.library, status_counts: { reading: 1 } } },
  { ...statistics, period: { ...statistics.period, reading_days: -1 } },
  { ...statistics, period: { ...statistics.period, year: 2025 } },
])('불완전하거나 요청 기간과 다른 통계를 거부한다: %j', async (body) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)))
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')

  await expect(getReadingStatistics('test-token', 2026, 10)).rejects.toThrow(
    '통계 응답 형식이 올바르지 않습니다.',
  )
})

test('통계 조회 실패를 0건으로 바꾸지 않는다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })))
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')

  await expect(getReadingStatistics('test-token', 2026)).rejects.toMatchObject({ status: 503 })
})
