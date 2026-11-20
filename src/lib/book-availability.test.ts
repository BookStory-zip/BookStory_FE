import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getBookAvailability, getRegions } from './book-availability'

const isbn = '9788936434120'
const online = [{ store: 'yes24', name: 'YES24', url: `https://www.yes24.com/Product/Search?query=${isbn}` }]
const district = { code: '11190', name: '서울특별시 영등포구' }
const library = { lib_code: '111234', name: '도서관', address: '서울 영등포구', tel: null, homepage: 'http://library.example.test', operating_time: null, closed: null, loan_available: false }
const fetchMock = vi.fn()
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); vi.stubEnv('VITE_API_BASE_URL', 'https://api.test'); fetchMock.mockReset() })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

test('지역 목록을 공개 API로 조회하고 코드는 문자열 그대로 유지한다', async () => {
  const regions = [{ code: '11', name: '서울특별시', districts: [{ code: '11190', name: '영등포구' }] }]
  fetchMock.mockResolvedValue(Response.json(regions))
  await expect(getRegions()).resolves.toEqual(regions)
  expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/regions')
  expect(fetchMock.mock.calls[0][1].headers).toEqual({})
})

test('지역 없이 온라인 링크만 조회한다', async () => {
  const data = { online, district: null, libraries: [] }
  fetchMock.mockResolvedValue(Response.json(data))
  await expect(getBookAvailability(isbn)).resolves.toEqual(data)
  expect(fetchMock.mock.calls[0][0]).toBe(`https://api.test/books/${isbn}/where`)
})

test.each([null, [], [library], [{ ...library, loan_available: true }], [{ ...library, loan_available: null }]])('전체 실패·빈 결과·대출 상태와 HTTP 홈페이지를 보존한다: %j', async libraries => {
  const data = { online, district, libraries }
  fetchMock.mockResolvedValue(Response.json(data))
  await expect(getBookAvailability(isbn, district.code)).resolves.toEqual(data)
  expect(fetchMock.mock.calls[0][0]).toBe(`https://api.test/books/${isbn}/where?district=11190`)
})

test.each([
  { online: [{ ...online[0], url: 'javascript:alert(1)' }], district, libraries: [] },
  { online, district: { ...district, code: 'other' }, libraries: [] },
  { online, district, libraries: [{ ...library, loan_available: 'false' }] },
  { online, district, libraries: [{ ...library, homepage: 'javascript:alert(1)' }] },
  { online, district, libraries: [library, library] },
])('허용되지 않는 링크·잘못된 지역/도서관 응답은 표시하지 않는다: %j', async data => {
  fetchMock.mockResolvedValue(Response.json(data))
  await expect(getBookAvailability(isbn, district.code)).rejects.toThrow('응답')
})

test('중복 지역 코드 응답은 거부한다', async () => {
  fetchMock.mockResolvedValue(Response.json([{ code: '11', name: '서울', districts: [{ code: '1', name: '구' }, { code: '1', name: '구' }] }]))
  await expect(getRegions()).rejects.toThrow('응답')
})

test('온라인 목록이 비어도 정상 도서관 결과를 버리지 않는다', async () => {
  const data = { online: [], district, libraries: [library] }
  fetchMock.mockResolvedValue(Response.json(data))
  await expect(getBookAvailability(isbn, district.code)).resolves.toEqual(data)
})
