import { afterEach, expect, test, vi } from 'vitest'
import {
  addLibraryBook,
  cancelReadingToday,
  checkReadingToday,
  deleteLibraryBook,
  getLibraryBooks,
  getMe,
  getReadingLogs,
  pickIsbn13,
  searchBooks,
  updateLibraryRecord,
} from './api'

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
    signal: expect.any(AbortSignal),
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

test.each([
  ['8936433598 9788936433598', '9788936433598'],
  ['9788936433598', '9788936433598'],
  ['8936433598', null],
  ['', null],
  [null, null],
  ['1234567890123', null],
])('공급자 isbn %j에서 ISBN13만 고른다', (isbn, expected) => {
  expect(pickIsbn13(isbn)).toBe(expected)
})

test('검색은 인증 헤더 없이 요청하고 누락·null·빈 문자열을 정리한다', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({
    documents: [
      { title: ' 소년이 온다 ', authors: ['한강', '', null], publisher: null, thumbnail: '', isbn: '8936433598 9788936433598' },
      { isbn: '8936433598' },
      null,
    ],
    meta: { total_count: 2 },
  }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')

  await expect(searchBooks('소년이 온다')).resolves.toEqual([
    { title: '소년이 온다', authors: ['한강'], publisher: '', thumbnail: null, isbn13: '9788936433598' },
    { title: '', authors: [], publisher: '', thumbnail: null, isbn13: null },
  ])
  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('https://api.example.test/books/search?query=%EC%86%8C%EB%85%84%EC%9D%B4+%EC%98%A8%EB%8B%A4')
  expect(init.headers).toEqual({})
})

test('서재 등록은 isbn13만 JSON으로 보내고 응답 id·상태를 돌려준다', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: 'user-book-1', book_id: 'book-1', status: 'reading' }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')

  await expect(addLibraryBook('test-access-token', '9788936433598')).resolves.toEqual({
    id: 'user-book-1',
    status: 'reading',
  })
  expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/library/books', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-access-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ isbn13: '9788936433598' }),
    signal: expect.any(AbortSignal),
  })
})

test('서재 삭제 204는 본문을 읽지 않고 성공으로 처리한다', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')

  await expect(deleteLibraryBook('test-access-token', 'user-book-1')).resolves.toBeUndefined()
  expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/library/books/user-book-1', {
    method: 'DELETE',
    headers: { Authorization: 'Bearer test-access-token' },
    signal: expect.any(AbortSignal),
  })
})

test('기록 PATCH는 명시적 null을 그대로 보낸다', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: 'user-book-1' }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')

  await updateLibraryRecord('test-access-token', 'user-book-1', { rating: null })
  expect(fetchMock.mock.calls[0][1].body).toBe('{"rating":null}')
})

function logEntry(index: number) {
  return {
    id: `log-${index}`, user_book_id: 'user-book-1', read_date: '2026-10-01', created_at: '2026-10-01T00:00:00Z',
    book_id: 'book-1', title: '책', authors: [], thumbnail_url: null,
  }
}

test('독서 기록은 100건을 넘으면 다음 페이지까지 모두 가져온다', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json(Array.from({ length: 100 }, (_, i) => logEntry(i))))
    .mockResolvedValueOnce(Response.json(Array.from({ length: 30 }, (_, i) => logEntry(100 + i))))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')

  const logs = await getReadingLogs('test-access-token', '2026-10-01', '2026-10-31')

  expect(logs).toHaveLength(130)
  expect(fetchMock.mock.calls.map(([url]) => new URL(url).searchParams.get('offset'))).toEqual(['0', '100'])
  expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('end_date')).toBe('2026-10-31')
})

test('오늘 체크는 본문 없이 PUT, 취소는 DELETE 204로 처리한다', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json({ id: 'log-1', user_book_id: 'user-book-1', read_date: '2026-10-28', created_at: '2026-10-28T00:00:00Z' }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')

  await expect(checkReadingToday('test-access-token', 'user-book-1')).resolves.toMatchObject({ read_date: '2026-10-28' })
  await expect(cancelReadingToday('test-access-token', 'user-book-1')).resolves.toBeUndefined()
  expect(fetchMock.mock.calls[0]).toEqual([
    'https://api.example.test/library/books/user-book-1/reading-logs/today',
    { headers: { Authorization: 'Bearer test-access-token' }, method: 'PUT', signal: expect.any(AbortSignal) },
  ])
  expect(fetchMock.mock.calls[1][1].method).toBe('DELETE')
})

test('응답이 끝나지 않는 요청은 시간 제한으로 끊는다', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ user_id: 'user-1' }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')

  await getMe('test-access-token')
  const signal: AbortSignal = fetchMock.mock.calls[0][1].signal
  expect(signal).toBeInstanceOf(AbortSignal)
  expect(signal.aborted).toBe(false)
})
