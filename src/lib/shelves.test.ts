import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { addBookToShelf, createShelf, deleteShelf, getLibraryBook, getLibraryBooks, getShelves, moveShelf, removeBookFromShelf, renameShelf } from './api'
import { shelfName } from './shelves'

const shelf = { id: 'shelf-1', name: 'SF', book_count: 3, position: 1 }
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
const call = (index: number) => {
  const [url, init] = fetchMock.mock.calls[index]
  return { url: url.replace('https://api.example.test', ''), method: init.method, body: init.body === undefined ? undefined : JSON.parse(init.body) }
}

test('책장 목록·생성·이름 변경은 책장 응답을 검사해 돌려준다', async () => {
  fetchMock
    .mockResolvedValueOnce(Response.json([shelf]))
    .mockResolvedValueOnce(Response.json(shelf, { status: 201 }))
    .mockResolvedValueOnce(Response.json({ ...shelf, name: 'sf' }))
  await expect(getShelves('t')).resolves.toEqual([shelf])
  await expect(createShelf('t', 'SF')).resolves.toEqual(shelf)
  await expect(renameShelf('t', 'shelf-1', 'sf')).resolves.toEqual({ ...shelf, name: 'sf' })
  expect([call(0), call(1), call(2)]).toEqual([
    { url: '/shelves', method: undefined, body: undefined },
    { url: '/shelves', method: 'POST', body: { name: 'SF' } },
    { url: '/shelves/shelf-1', method: 'PATCH', body: { name: 'sf' } },
  ])
})

test('순서 이동은 after_shelf_id를 항상 보내고, 삭제·책 넣기·빼기는 204를 읽지 않는다', async () => {
  fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })))
  await moveShelf('t', 'shelf-2', null)
  await moveShelf('t', 'shelf-2', 'shelf-1')
  await deleteShelf('t', 'shelf-1')
  await addBookToShelf('t', 'shelf-1', 'ub-1')
  await removeBookFromShelf('t', 'shelf-1', 'ub-1')
  expect([0, 1, 2, 3, 4].map(call)).toEqual([
    { url: '/shelves/shelf-2/position', method: 'PATCH', body: { after_shelf_id: null } },
    { url: '/shelves/shelf-2/position', method: 'PATCH', body: { after_shelf_id: 'shelf-1' } },
    { url: '/shelves/shelf-1', method: 'DELETE', body: undefined },
    { url: '/shelves/shelf-1/books/ub-1', method: 'PUT', body: undefined },
    { url: '/shelves/shelf-1/books/ub-1', method: 'DELETE', body: undefined },
  ])
})

test.each([
  [{ ...shelf, book_count: -1 }],
  [{ ...shelf, name: 1 }],
  [{ id: 'shelf-1', name: 'SF' }],
])('형식이 다른 책장 응답을 거부한다: %j', async (body) => {
  fetchMock.mockResolvedValue(Response.json([body]))
  await expect(getShelves('t')).rejects.toThrow('책장 응답 형식이 올바르지 않습니다.')
})

test('서재 조회에 책장 조건을 검색·상태와 함께 보낸다', async () => {
  fetchMock.mockResolvedValue(Response.json([]))
  await getLibraryBooks('t', 20, 0, { q: '숲', field: 'title', status: 'reading', shelf_id: 'shelf-1' })
  expect(call(0).url).toBe('/library/books?limit=20&offset=0&q=%EC%88%B2&field=title&status=reading&shelf_id=shelf-1')
})

test('상세의 shelves는 필수이며 {id, name} 배열이어야 한다', async () => {
  const detail = {
    id: 'ub-1', book_id: 'b-1', isbn13: '9788936433598', title: '책', authors: [], thumbnail_url: null, status: 'reading', created_at: '2026-11-01T00:00:00Z',
    publisher: null, published_date: null, description: null, source_url: 'https://example.test', started_at: null, last_read_at: null, last_read_date: null, past_log_range: null,
    completed_at: null, stopped_at: null, stop_reason: null, rating: null, memo: null, is_review_public: false, review_published_at: null, review_updated_at: null,
    has_completed: false, updated_at: '2026-11-01T00:00:00Z', allowed_statuses: ['reading'],
  }
  fetchMock
    .mockResolvedValueOnce(Response.json({ ...detail, shelves: [{ id: 'shelf-1', name: 'SF' }] }))
    .mockResolvedValueOnce(Response.json(detail))
    .mockResolvedValueOnce(Response.json({ ...detail, shelves: [{ id: 'shelf-1' }] }))
  await expect(getLibraryBook('t', 'ub-1')).resolves.toHaveProperty('shelves', [{ id: 'shelf-1', name: 'SF' }])
  await expect(getLibraryBook('t', 'ub-1')).rejects.toThrow('책 상세 응답 형식이 올바르지 않습니다.')
  await expect(getLibraryBook('t', 'ub-1')).rejects.toThrow('책 상세 응답 형식이 올바르지 않습니다.')
})

test.each([
  ['  숲속 책장  ', { name: '숲속 책장' }],
  ['   ', { error: '책장 이름을 입력해주세요.' }],
  ['가'.repeat(30), { name: '가'.repeat(30) }],
  ['📚'.repeat(31), { error: '책장 이름은 30자까지 정할 수 있어요.' }],
  ['한́', { name: '한́'.normalize('NFC') }],
])('책장 이름 %j를 앞뒤 공백 제거·NFC 뒤 코드 포인트로 검사한다', (input, expected) => {
  expect(shelfName(input)).toEqual(expected)
})
