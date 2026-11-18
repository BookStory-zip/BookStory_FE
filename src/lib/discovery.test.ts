import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getPopularBooks, isPopularFresh, discoverySource } from './discovery'

const item = { rank: 1, daily_rank: 2, monthly_rank: null, isbn13: '9788936433598', title: '인기 도서', author: '작가 저/번역가 역', publisher: null, thumbnail_url: null, source_url: 'https://www.yes24.com/product/goods/123' }
const snapshot = { sources: ['yes24'] as ('yes24' | 'data4library')[], collected_at: '2026-11-12T21:00:00Z', basis_date: '2026-11-12', monthly_basis: '2026-11', items: [item] }
const fetchMock = vi.fn()
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); vi.stubEnv('VITE_API_BASE_URL', 'https://api.test'); fetchMock.mockReset() })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

test('공개 API로 조회하며 원본 author와 nullable 순위를 유지한다', async () => {
  fetchMock.mockImplementation(async () => Response.json(snapshot))
  await expect(getPopularBooks()).resolves.toEqual(snapshot)
  expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/discovery/popular?limit=10')
  expect(fetchMock.mock.calls[0][1].headers).toEqual({})
  await getPopularBooks(30)
  expect(fetchMock.mock.calls[1][0]).toContain('limit=30')
})

test('첫 수집 전에는 세 날짜가 null인 빈 목록을 허용한다', async () => {
  fetchMock.mockResolvedValue(Response.json({ source: 'yes24', collected_at: null, basis_date: null, monthly_basis: null, items: [] }))
  await expect(getPopularBooks()).resolves.toHaveProperty('items', [])
})

test.each([
  { ...snapshot, sources: [] }, { ...snapshot, sources: ['other'] }, { ...snapshot, sources: ['yes24', 'yes24'] }, { ...snapshot, sources: null }, { ...snapshot, collected_at: '2026-11-13T06:00:00' },
  { ...snapshot, sources: undefined, source: 'other' }, { ...snapshot, sources: undefined },
  { ...snapshot, monthly_basis: '2026-13' }, { ...snapshot, basis_date: null },
  { ...snapshot, basis_date: '2026-02-31' },
  { ...snapshot, collected_at: null },
  ...[
    { author: [] }, { daily_rank: 0 }, { monthly_rank: -1 }, { rank: 2 },
    { isbn13: '978' }, { thumbnail_url: 'http://example.test/a.jpg' },
    { source_url: 'https://www.yes24.com.evil.test/product/goods/1' }, { source_url: 'javascript:alert(1)' },
  ].map((patch) => ({ ...snapshot, items: [{ ...item, ...patch }] })),
])('계약이 잘못된 응답은 표시하지 않는다: %j', async (value) => {
  fetchMock.mockResolvedValue(Response.json(value))
  await expect(getPopularBooks()).rejects.toThrow('인기 도서 응답')
})

test('최신성은 기준일이 아닌 마지막 성공 수집 시각으로 72시간까지 판단한다', () => {
  const end = Date.parse(snapshot.collected_at) + 72 * 60 * 60 * 1000
  expect(isPopularFresh(snapshot, end)).toBe(true)
  expect(isPopularFresh(snapshot, end + 1)).toBe(false)
})

test('상세 대체 링크는 이동한 ISBN과 지원 출처를 확인한다', () => {
  const state = { discoverySource: { isbn13: item.isbn13, source_url: item.source_url } }
  expect(discoverySource(state, item.isbn13)).toBe(item.source_url)
  expect(discoverySource(state, '9788936433581')).toBeNull()
  expect(discoverySource({ discoverySource: { ...state.discoverySource, source_url: 'https://evil.test' } }, item.isbn13)).toBeNull()
})


test.each([{ sources: ['yes24'] }, { sources: ['yes24', 'data4library'] }])('sources works without deprecated source: %j', async ({ sources }) => {
  fetchMock.mockResolvedValue(Response.json({ ...snapshot, sources }))
  await expect(getPopularBooks()).resolves.toHaveProperty('sources', sources)
})

test('legacy source normalizes to sources', async () => {
  fetchMock.mockResolvedValue(Response.json({ ...snapshot, sources: undefined, source: 'yes24' }))
  await expect(getPopularBooks()).resolves.toHaveProperty('sources', ['yes24'])
})

test('loan-only Daum book allows both ranks to be null', async () => {
  const source_url = 'https://search.daum.net/search?q=9788936433598'
  fetchMock.mockResolvedValue(Response.json({ ...snapshot, sources: ['yes24', 'data4library'], items: [{ ...item, daily_rank: null, monthly_rank: null, source_url }] }))
  await expect(getPopularBooks()).resolves.toHaveProperty('items.0.source_url', source_url)
  expect(discoverySource({ discoverySource: { isbn13: item.isbn13, source_url } }, item.isbn13)).toBe(source_url)
})

test.each(['https://search.daum.net/other', 'https://search.daum.net/', 'https://search.daum.net.evil.test/search', 'https://evil.test', 'http://search.daum.net/search', 'https://user:secret@search.daum.net/search', 'https://search.daum.net:8443/search', 'https://www.yes24.com:8443/product/goods/1'])('reject unsupported source in response and router state: %s', async (source_url) => {
  fetchMock.mockResolvedValue(Response.json({ ...snapshot, items: [{ ...item, source_url }] }))
  await expect(getPopularBooks()).rejects.toThrow('인기 도서 응답')
  expect(discoverySource({ discoverySource: { isbn13: item.isbn13, source_url } }, item.isbn13)).toBeNull()
})

test('카카오 책 식별자가 있는 다음 책 페이지도 허용한다', () => {
  const source_url = 'https://search.daum.net/search?w=bookpage&bookId=123456'
  expect(discoverySource({ discoverySource: { isbn13: item.isbn13, source_url } }, item.isbn13)).toBe(source_url)
})
