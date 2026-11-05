import { afterEach, expect, test, vi } from 'vitest'
import {
  addLibraryBook,
  cancelReadingToday,
  cancelReadingDate,
  checkReadingToday,
  checkReadingDate,
  deleteLibraryBook,
  getAllLibraryBooks,
  getLibraryBooks,
  getMe,
  getProfile,
  getReminderSettings,
  getReadingCompletions,
  getReadingLogs,
  moveLibraryBook,
  searchBooks,
  updateLibraryRecord,
  updateNickname,
  updateReminderSettings,
} from './api'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

test('계정 알림은 boolean을 읽고 설정 PUT의 빈 204를 처리한다', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ enabled: false })).mockResolvedValueOnce(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')
  await expect(getReminderSettings('token')).resolves.toBe(false)
  await expect(updateReminderSettings('token', true)).resolves.toBeUndefined()
  expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual([
    ['https://api.example.test/me/reminder-settings', undefined, undefined],
    ['https://api.example.test/me/reminder-settings', 'PUT', '{"enabled":true}'],
  ])
})

test.each([null, {}, { enabled: null }, { enabled: 'false' }])('알림 설정 응답 %j를 꺼짐으로 해석하지 않는다', async (body) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)))
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')
  await expect(getReminderSettings('token')).rejects.toThrow('알림 설정 응답 형식')
})

test('지난 날짜 체크·취소는 개인 id와 날짜를 경로로 보내고 본문을 생략한다', async () => {
  const log = { id: 'log-1', user_book_id: 'own/1', read_date: '2026-10-28', created_at: '2026-11-03T00:00:00Z' }
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(log)).mockResolvedValueOnce(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')
  await expect(checkReadingDate('token', 'own/1', '2026-10-28')).resolves.toEqual(log)
  await expect(cancelReadingDate('token', 'own/1', '2026-10-28')).resolves.toBeUndefined()
  expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual([
    ['https://api.example.test/library/books/own%2F1/reading-logs/2026-10-28', 'PUT', undefined],
    ['https://api.example.test/library/books/own%2F1/reading-logs/2026-10-28', 'DELETE', undefined],
  ])
})

test('다른 날짜나 다른 개인 항목의 체크 응답을 성공으로 받아들이지 않는다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ id: '1', user_book_id: 'other', read_date: '2026-11-03', created_at: 'now' })))
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')
  await expect(checkReadingDate('token', 'own', '2026-11-02')).rejects.toThrow('독서 체크 응답 형식')
})

test.each([null, 'anchor-user-book'])('순서 변경은 개인 id와 필수 기준 %j를 보내고 빈 204를 읽는다', async (anchor) => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')
  await expect(moveLibraryBook('test-token', 'moved-user-book', anchor)).resolves.toBeUndefined()
  expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/library/books/moved-user-book/position', {
    method: 'PATCH',
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ after_user_book_id: anchor }),
    signal: expect.any(AbortSignal),
  })
})

test.each([
  ['42', 42],
  [null, undefined],
  ['', undefined],
  ['soon', undefined],
])('429의 Retry-After %j를 초 단위 %j로 읽고 rate_limited 코드를 유지한다', async (header, seconds) => {
  const headers: Record<string, string> = header === null ? {} : { 'Retry-After': header }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ detail: 'Too many requests', code: 'rate_limited' }, { status: 429, headers })))
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')
  const error = await moveLibraryBook('test-token', 'book', null).catch((failure: unknown) => failure)
  expect(error).toMatchObject({ status: 429, code: 'rate_limited', retryAfter: seconds })
})

test('닉네임은 null(삭제)을 그대로 보내고 서버가 정규화한 값을 돌려준다', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json({ nickname: null }))
    .mockResolvedValueOnce(Response.json({ nickname: '책벌레' }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')
  await expect(updateNickname('test-token', null)).resolves.toBeNull()
  await expect(getProfile('test-token')).resolves.toBe('책벌레')
  expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual([
    ['https://api.example.test/me/profile', 'PATCH', JSON.stringify({ nickname: null })],
    ['https://api.example.test/me/profile', undefined, undefined],
  ])
})

test.each([{}, { nickname: 3 }, null])('닉네임 응답 %j는 형식 오류로 처리한다', async (body) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)))
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')
  await expect(getProfile('test-token')).rejects.toThrow('프로필 응답 형식')
})

test('순서 변경의 invalid_position 코드를 유지한다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ code: 'invalid_position' }, { status: 422 })))
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')
  await expect(moveLibraryBook('test-token', 'book', 'book')).rejects.toMatchObject({ status: 422, code: 'invalid_position' })
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
  const fetchMock = vi.fn().mockImplementation(async () => Response.json([item]))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')

  await expect(getLibraryBooks('test-access-token', 20, 40)).resolves.toEqual([item])
  expect(fetchMock.mock.calls[0][0]).toBe(
    'https://api.example.test/library/books?limit=20&offset=40',
  )
  await getLibraryBooks('test-access-token', 100, 0, { status: 'reading' })
  expect(fetchMock.mock.calls[1][0]).toBe('https://api.example.test/library/books?limit=100&offset=0&status=reading')
  await getLibraryBooks('test-access-token', 20, 0, { q: '소년 100%', field: 'author', status: 'completed' })
  expect(fetchMock.mock.calls[2][0]).toBe('https://api.example.test/library/books?limit=20&offset=0&q=%EC%86%8C%EB%85%84+100%25&field=author&status=completed')
  // 검색어 없이 기준만 보내지 않는다.
  await getLibraryBooks('test-access-token', 20, 0, { field: 'author' })
  expect(fetchMock.mock.calls[3][0]).toBe('https://api.example.test/library/books?limit=20&offset=0')
})

test('서재 전체 조회는 100권씩 이어 받고 짧은 페이지에서 멈춘다', async () => {
  const item = { id: 'user-book', book_id: 'book', isbn13: '9788936433598', title: '책', authors: [], thumbnail_url: null, status: 'reading', created_at: '2026-10-27T00:00:00Z' }
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json(Array.from({ length: 100 }, (_, index) => ({ ...item, id: `a-${index}` }))))
    .mockResolvedValueOnce(Response.json([item]))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')

  await expect(getAllLibraryBooks('test-access-token', { status: 'reading' })).resolves.toHaveLength(101)
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    'https://api.example.test/library/books?limit=100&offset=0&status=reading',
    'https://api.example.test/library/books?limit=100&offset=100&status=reading',
  ])
})

test('서재 정렬은 검색·상태·책장 조건과 함께 보내며 기본 조회는 기존 주소를 유지한다', async () => {
  const fetchMock = vi.fn().mockImplementation(async () => Response.json([]))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')
  await getLibraryBooks('test-access-token', 20, 40, { q: '책', field: 'author', status: 'reading', shelf_id: 's1', sort: 'started' })
  const url = new URL(fetchMock.mock.calls[0][0])
  expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '20', offset: '40', q: '책', field: 'author', status: 'reading', shelf_id: 's1', sort: 'started' })
  await getLibraryBooks('test-access-token', 20, 0, { sort: 'created' })
  expect(fetchMock.mock.calls[1][0]).toContain('sort=created')
  await getLibraryBooks('test-access-token', 20, 0)
  expect(fetchMock.mock.calls[2][0]).toBe('https://api.example.test/library/books?limit=20&offset=0')
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

test('검색은 인증 없이 page를 보내고, BE가 고른 isbn13과 is_end를 쓴다', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({
    documents: [
      { title: ' 소년이 온다 ', authors: ['한강', '', null], publisher: null, thumbnail: '', isbn: '8936433598 9788936433598', isbn13: '9788936433598' },
      { isbn: '8936433598', isbn13: null },
      { title: '형식이 다른 값', isbn13: '8936433598' },
      null,
    ],
    meta: { total_count: 3, is_end: false },
  }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')

  await expect(searchBooks('소년이 온다', 2)).resolves.toEqual({
    books: [
      { title: '소년이 온다', authors: ['한강'], publisher: '', thumbnail: null, isbn13: '9788936433598' },
      { title: '', authors: [], publisher: '', thumbnail: null, isbn13: null },
      { title: '형식이 다른 값', authors: [], publisher: '', thumbnail: null, isbn13: null },
    ],
    isEnd: false,
  })
  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('https://api.example.test/books/search?query=%EC%86%8C%EB%85%84%EC%9D%B4+%EC%98%A8%EB%8B%A4&page=2')
  expect(init.headers).toEqual({})
})

test('검색 meta에 is_end가 없으면 더 보기를 막는다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ documents: [], meta: {} })))
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')

  await expect(searchBooks('책')).resolves.toMatchObject({ isEnd: true })
})

test('서재 등록은 isbn13만 JSON으로 보내고, 201·200으로 신규·기존을 구분한다', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json({ id: 'user-book-1', book_id: 'book-1', status: 'want_to_read' }, { status: 201 }))
    .mockResolvedValueOnce(Response.json({ id: 'user-book-1', book_id: 'book-1', status: 'reading' }, { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')

  await expect(addLibraryBook('test-access-token', '9788936433598')).resolves.toEqual({
    id: 'user-book-1',
    status: 'want_to_read',
    created: true,
  })
  await expect(addLibraryBook('test-access-token', '9788936433598')).resolves.toEqual({
    id: 'user-book-1',
    status: 'reading',
    created: false,
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

test('409·422 응답의 code를 오류에 담는다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ detail: 'Invalid transition', code: 'invalid_transition' }, { status: 409 })))
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')

  await expect(getLibraryBooks('test-access-token', 20, 0)).rejects.toMatchObject({ status: 409, code: 'invalid_transition' })
})

test('완독 기록도 100건을 넘으면 다음 페이지까지 모두 가져온다', async () => {
  const done = (index: number) => ({
    user_book_id: `user-book-${index}`, book_id: 'book-1', title: '책', authors: [], thumbnail_url: null,
    status: 'completed', completed_at: '2026-10-15T05:00:00Z', completed_date: '2026-10-15',
  })
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json(Array.from({ length: 100 }, (_, i) => done(i))))
    .mockResolvedValueOnce(Response.json([done(100)]))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')

  await expect(getReadingCompletions('test-access-token', '2026-10-01', '2026-10-31')).resolves.toHaveLength(101)
  expect(fetchMock.mock.calls.map(([url]) => new URL(url).pathname + '?' + new URL(url).searchParams.get('offset')))
    .toEqual(['/reading-completions?0', '/reading-completions?100'])
})
