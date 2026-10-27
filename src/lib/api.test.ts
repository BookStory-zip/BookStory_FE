import { afterEach, expect, test, vi } from 'vitest'
import { getLibraryBooks, getMe } from './api'

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

test.each([
  [{ detail: '도서를 찾을 수 없습니다.' }, '도서를 찾을 수 없습니다.'],
  [{ detail: [{ msg: 'limit 범위 오류' }, { msg: 'offset 범위 오류' }] }, 'limit 범위 오류 offset 범위 오류'],
])('오류 detail 문자열과 검증 배열을 메시지로 읽는다: %j', async (body, message) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body, { status: 422 })))
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')

  await expect(getLibraryBooks('test-access-token', 20, 0)).rejects.toMatchObject({
    status: 422,
    message,
  })
})

test('서재 목록은 limit·offset을 보내고 표지 null을 허용한다', async () => {
  const item = {
    id: 'user-book-1',
    book_id: 'book-1',
    isbn13: '9788936433598',
    title: '소년이 온다',
    authors: ['한강'],
    thumbnail_url: null,
    status: 'want_to_read',
    created_at: '2026-10-27T00:00:00Z',
  }
  const fetchMock = vi.fn().mockResolvedValue(Response.json([item]))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')

  await expect(getLibraryBooks('test-access-token', 20, 40)).resolves.toEqual([item])
  expect(fetchMock.mock.calls[0][0]).toBe(
    'https://api.example.test/library/books?limit=20&offset=40',
  )
})

test.each([{ total: 1 }, [{ id: 'x', title: '제목' }], [{ status: 'unknown' }]])(
  '서재 응답 형식이 다르면 거부한다: %j',
  async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)))
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')

    await expect(getLibraryBooks('test-access-token', 20, 0)).rejects.toThrow(
      '서재 응답 형식이 올바르지 않습니다.',
    )
  },
)
