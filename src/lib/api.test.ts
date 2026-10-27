import { afterEach, expect, test, vi } from 'vitest'
import { getMe } from './api'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

test('토큰으로 /me를 요청하고 사용자 정보를 반환한다', async () => {
  const expectedUser = {
    user_id: '11111111-1111-4111-8111-111111111111',
  }

  const fetchMock = vi.fn().mockResolvedValue(Response.json(expectedUser))

  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')

  const user = await getMe('test-access-token')

  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/me', {
    headers: {
      Authorization: 'Bearer test-access-token',
    },
  })
  expect(user).toEqual(expectedUser)
})

test.each([401, 503])('HTTP %i 오류의 상태 코드를 유지한다', async (status) => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status }))

  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')

  await expect(getMe('test-access-token')).rejects.toMatchObject({
    status,
  })
})

test.each([null, {}, { user_id: 123 }, { user_id: '' }])(
  '잘못된 사용자 응답을 거부한다: %j',
  async (body) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(body))

    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')

    await expect(getMe('test-access-token')).rejects.toThrow(
      '사용자 확인 응답 형식이 올바르지 않습니다.',
    )
  },
)
