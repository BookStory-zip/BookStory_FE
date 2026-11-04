import { afterEach, expect, test, vi } from 'vitest'
import { deleteGoal, getReadingStatistics, updateGoal } from './api'

const statistics = {
  library: {
    total_books: 5,
    status_counts: { want_to_read: 1, reading: 1, completed: 1, paused: 1, abandoned: 1 },
    completed_books: 2,
  },
  period: {
    year: 2026, month: 10, start_date: '2026-10-01', end_date: '2026-10-31', reading_days: 3, reading_minutes: 42,
    goals: [{ metric: 'reading_days', target: 12, current: 3, source: 'inherited' }],
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
      // 연 자동 합계는 직접 입력 상한(9999)을 넘을 수 있다.
      goals: month ? statistics.period.goals : [{ metric: 'completed_books', target: 119988, current: 4, source: 'sum' }],
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
  { ...statistics, period: { ...statistics.period, goals: undefined } },
  { ...statistics, period: { ...statistics.period, goals: [{ metric: 'pages', target: 1, current: 0, source: 'set' }] } },
  { ...statistics, period: { ...statistics.period, goals: [{ metric: 'reading_days', target: 1.5, current: 0, source: 'set' }] } },
  // 월 응답에는 연 합계 출처가 나오지 않는다.
  { ...statistics, period: { ...statistics.period, goals: [{ metric: 'reading_days', target: 24, current: 0, source: 'sum' }] } },
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

test.each([
  ['PUT', () => updateGoal('test-token', { metric: 'reading_days', year: 2026, month: 11, target: 12 }), { metric: 'reading_days', year: 2026, month: 11, target: 12 }],
  ['PUT', () => updateGoal('test-token', { metric: 'completed_books', year: 2026, month: null, target: 0 }), { metric: 'completed_books', year: 2026, month: null, target: 0 }],
  ['DELETE', () => deleteGoal('test-token', { metric: 'reading_minutes', year: 2026, month: null }), { metric: 'reading_minutes', year: 2026, month: null }],
] as const)('목표 %s는 연 목표에도 month를 명시한 JSON 본문을 보내고 204를 읽지 않는다', async (method, request, body) => {
  const response = new Response(null, { status: 204 })
  const json = vi.spyOn(response, 'json')
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')

  await expect(request()).resolves.toBeUndefined()
  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('https://api.example.test/me/goals')
  expect(init.method).toBe(method)
  expect(init.headers).toEqual({ Authorization: 'Bearer test-token', 'Content-Type': 'application/json' })
  expect(JSON.parse(init.body)).toEqual(body)
  expect(json).not.toHaveBeenCalled()
})
