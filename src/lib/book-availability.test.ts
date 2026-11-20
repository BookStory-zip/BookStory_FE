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
  { online: null, district, libraries: [] },
  { online, district: { ...district, code: 'other' }, libraries: [] },
  { online, district, libraries: {} },
])('허용되지 않는 링크·잘못된 지역/도서관 응답은 표시하지 않는다: %j', async data => {
  fetchMock.mockResolvedValue(Response.json(data))
  await expect(getBookAvailability(isbn, district.code)).rejects.toThrow('응답')
})

test('잘못된 온라인 행과 중복은 제외하고 안전한 HTTPS 링크와 도서관은 유지한다', async () => {
  fetchMock.mockResolvedValue(Response.json({ online: [null, { ...online[0], url: 'javascript:alert(1)' }, { ...online[0], url: 'http://example.test' }, online[0], online[0], { store: 'bad', url: 'https://example.test' }], district, libraries: [library] }))
  await expect(getBookAvailability(isbn, district.code)).resolves.toEqual({ online, district, libraries: [library] })
})

test.each(['javascript:alert(1)', '', null, undefined])('잘못되거나 없는 홈페이지만 비우고 정상 도서관과 중복 없는 목록을 유지한다: %j', async homepage => {
  fetchMock.mockResolvedValue(Response.json({ online, district, libraries: [{ ...library, homepage }, library, { ...library, lib_code: 'other' }, null, { name: '이름만' }, { lib_code: 'code' }] }))
  await expect(getBookAvailability(isbn, district.code)).resolves.toEqual({ online, district, libraries: [{ ...library, homepage: null }, { ...library, lib_code: 'other' }] })
})

test.each([undefined, null, '', '  ', 123])('선택 정보의 누락과 비정상 값은 null로 처리한다: %j', async value => {
  const row = { ...library, address: value, tel: value, operating_time: value, closed: value, homepage: value, loan_available: 'false' }
  fetchMock.mockResolvedValue(Response.json({ online, district, libraries: [row] }))
  await expect(getBookAvailability(isbn, district.code)).resolves.toEqual({ online, district, libraries: [{ ...library, address: null, tel: null, operating_time: null, closed: null, homepage: null, loan_available: null }] })
})

test('모든 도서관 행이 잘못되면 소장 없음 대신 미확인으로 반환한다', async () => {
  fetchMock.mockResolvedValue(Response.json({ online, district, libraries: [null, {}, { ...library, name: '' }] }))
  await expect(getBookAvailability(isbn, district.code)).resolves.toEqual({ online, district, libraries: null })
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

test('BE가 주소를 제공하지 않은 도서관도 정상 결과로 받아들인다', async () => {
  const data = { online, district, libraries: [{ ...library, address: null }] }
  fetchMock.mockResolvedValue(Response.json(data))
  await expect(getBookAvailability(isbn, district.code)).resolves.toEqual(data)
})
