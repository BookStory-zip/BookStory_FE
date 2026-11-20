// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError } from './lib/api'
import BookAvailability from './BookAvailability'

const api = vi.hoisted(() => ({ getBookAvailability: vi.fn(), getRegions: vi.fn() }))
vi.mock('./lib/book-availability', () => api)
vi.mock('./lib/supabase', () => ({ supabase: { auth: {} } }))
const isbn = '9788936434120'
const regions = [{ code: '11', name: '서울특별시', districts: [{ code: '11190', name: '영등포구' }] }, { code: '41', name: '경기도', districts: [{ code: '41001', name: '수원시 장안구' }] }]
const online = [{ store: 'yes24', name: 'YES24', url: 'https://www.yes24.com/search' }]
const library = { lib_code: '1', name: '가온도서관', address: '서울 영등포구 도서관로', tel: '02-123-4567', homepage: 'http://library.example.test', operating_time: '09:00~22:00', closed: '매주 월요일', loan_available: false }
const result = { online, district: { code: '11190', name: '서울특별시 영등포구' }, libraries: [library] }
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); api.getRegions.mockResolvedValue(regions); api.getBookAvailability.mockResolvedValue({ online, district: null, libraries: [] }) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })
const show = () => render(<BookAvailability isbn13={isbn} />)
async function choose() {
  fireEvent.click(screen.getByRole('tab', { name: '도서관' }))
  await screen.findByRole('option', { name: '서울특별시' })
  fireEvent.change(screen.getByLabelText('시·도'), { target: { value: '11' } })
  fireEvent.change(screen.getByLabelText('시·군·구'), { target: { value: '11190' } })
}

test('온라인은 링크로 표시하고 도서관 지역 조회는 탭 진입, 소장 조회는 버튼으로만 실행한다', async () => {
  show()
  expect((await screen.findByRole('link', { name: 'YES24에서 검색' })).getAttribute('target')).toBe('_blank')
  expect(api.getRegions).not.toHaveBeenCalled()
  await choose()
  expect(api.getBookAvailability.mock.calls).toEqual([[isbn]])
  api.getBookAvailability.mockResolvedValue(result)
  fireEvent.click(screen.getByRole('button', { name: '도서관 찾기' }))
  await screen.findByText('가온도서관')
  expect(screen.getByText('대출 불가')).toBeTruthy()
  expect(screen.queryByText('대출 중')).toBeNull()
  fireEvent.click(screen.getByText('운영 정보'))
  expect(screen.getByRole('link', { name: /홈페이지.*가온도서관/ }).getAttribute('href')).toBe(library.homepage)
  fireEvent.click(screen.getByRole('tab', { name: '온라인' }))
  fireEvent.click(screen.getByRole('tab', { name: '도서관' }))
  expect(screen.getByText('가온도서관')).toBeTruthy()
  expect(api.getBookAvailability).toHaveBeenCalledTimes(2)
  expect(document.querySelector('details#get-book')).toBeNull()
})

test.each([null, []])('조회 장애와 소장 도서관 없음은 구분하며 온라인은 유지한다: %j', async libraries => {
  show(); await screen.findByRole('link', { name: 'YES24에서 검색' }); await choose()
  api.getBookAvailability.mockResolvedValue({ ...result, libraries })
  fireEvent.click(screen.getByRole('button', { name: '도서관 찾기' }))
  await screen.findByText(libraries === null ? /도서관 정보를 불러오지 못/ : /소장한 도서관이 없/)
  fireEvent.click(screen.getByRole('tab', { name: '온라인' }))
  expect(screen.getByRole('link', { name: 'YES24에서 검색' })).toBeTruthy()
})

test('성공한 지역을 다음 책에 미리 선택하지만 자동 소장 조회는 하지 않는다', async () => {
  const first = show(); await choose(); api.getBookAvailability.mockResolvedValue(result)
  fireEvent.click(screen.getByRole('button', { name: '도서관 찾기' })); await screen.findByText('가온도서관'); first.unmount()
  api.getBookAvailability.mockResolvedValue({ online, district: null, libraries: [] }); api.getBookAvailability.mockClear()
  show(); fireEvent.click(screen.getByRole('tab', { name: '도서관' }))
  await waitFor(() => expect(screen.getByLabelText('시·군·구')).toHaveProperty('value', '11190'))
  expect(api.getBookAvailability.mock.calls).toEqual([[isbn]])
})

test('폐지된 지역 오류는 저장값과 선택을 지우고 온라인을 보존한다', async () => {
  show(); await screen.findByRole('link', { name: 'YES24에서 검색' }); await choose()
  api.getBookAvailability.mockRejectedValue(new ApiError(422, '', 'region_not_found'))
  fireEvent.click(screen.getByRole('button', { name: '도서관 찾기' }))
  await screen.findByText(/지역을 다시 선택/)
  expect(screen.getByLabelText('시·군·구')).toHaveProperty('value', '')
  fireEvent.click(screen.getByRole('tab', { name: '온라인' }))
  expect(screen.getByRole('link', { name: 'YES24에서 검색' })).toBeTruthy()
})

test('다른 지역을 고르면 이전 결과를 숨기며 요청 중 이중 조회를 막는다', async () => {
  let finish!: (value: unknown) => void
  show(); await choose()
  api.getBookAvailability.mockReturnValue(new Promise(resolve => { finish = resolve }))
  const button = screen.getByRole('button', { name: '도서관 찾기' })
  fireEvent.click(button); fireEvent.click(button)
  expect(api.getBookAvailability).toHaveBeenCalledTimes(2)
  await act(async () => finish(result))
  await screen.findByText('가온도서관')
  fireEvent.change(screen.getByLabelText('시·도'), { target: { value: '41' } })
  expect(screen.queryByText('가온도서관')).toBeNull()
})

test('429는 Retry-After 동안 재조회를 막고 자동 재전송하지 않는다', async () => {
  show(); await choose()
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  api.getBookAvailability.mockRejectedValue(new ApiError(429, '', 'rate_limited', 3))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '도서관 찾기' })))
  expect(screen.getByRole('button', { name: '도서관 찾기' })).toHaveProperty('disabled', true)
  await act(async () => vi.advanceTimersByTime(3000))
  expect(screen.getByRole('button', { name: '도서관 찾기' })).toHaveProperty('disabled', false)
  expect(api.getBookAvailability).toHaveBeenCalledTimes(2)
})

test('키보드로 탭을 이동할 수 있다', async () => {
  show(); await screen.findByRole('link', { name: 'YES24에서 검색' })
  const onlineTab = screen.getByRole('tab', { name: '온라인' }); onlineTab.focus()
  fireEvent.keyDown(onlineTab, { key: 'ArrowRight' })
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: '도서관' }))
  await screen.findByRole('option', { name: '서울특별시' })
})

test('화면 이동 뒤 도착한 조회 성공으로 지역을 저장하지 않는다', async () => {
  let finish!: (value: unknown) => void
  const view = show(); await choose()
  api.getBookAvailability.mockReturnValue(new Promise(resolve => { finish = resolve }))
  fireEvent.click(screen.getByRole('button', { name: '도서관 찾기' }))
  view.unmount()
  await act(async () => finish(result))
  expect(localStorage.length).toBe(0)
})

test('온라인 429 중 도서관 탭에 가도 지역 목록 재시도 경로를 유지한다', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  api.getBookAvailability.mockRejectedValue(new ApiError(429, '', 'rate_limited', 3))
  await act(async () => show())
  fireEvent.click(screen.getByRole('tab', { name: '도서관' }))
  expect(screen.getByRole('button', { name: '지역 목록 다시 확인' })).toHaveProperty('disabled', true)
  expect(api.getRegions).not.toHaveBeenCalled()
  await act(async () => vi.advanceTimersByTime(3000))
})

test('429 대기는 다른 책을 열어도 유지되며 만료 후 직접 재시도한다', async () => {
  const first = show(); await choose()
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  api.getBookAvailability.mockRejectedValue(new ApiError(429, '', 'rate_limited', 3))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '도서관 찾기' })))
  first.unmount()
  api.getBookAvailability.mockClear().mockResolvedValue({ online, district: null, libraries: [] })
  render(<BookAvailability isbn13="9788936433598" />)
  expect(api.getBookAvailability).not.toHaveBeenCalled()
  await act(async () => vi.advanceTimersByTime(3000))
  expect(api.getBookAvailability).not.toHaveBeenCalled()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '온라인 서점 다시 확인' })))
  expect(api.getBookAvailability).toHaveBeenCalledWith('9788936433598')
})

test('이전 책에서 늦게 도착한 429도 현재 화면의 조회 한도를 지킨다', async () => {
  let reject!: (error: unknown) => void
  const first = show(); await choose()
  api.getBookAvailability.mockReturnValue(new Promise((_, fail) => { reject = fail }))
  fireEvent.click(screen.getByRole('button', { name: '도서관 찾기' })); first.unmount()
  api.getBookAvailability.mockResolvedValue({ online, district: null, libraries: [] })
  show(); await screen.findByRole('link', { name: 'YES24에서 검색' })
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  await act(async () => reject(new ApiError(429, '', 'rate_limited', 3)))
  fireEvent.click(screen.getByRole('tab', { name: '도서관' }))
  expect(screen.getByRole('button', { name: '지역 목록 다시 확인' })).toHaveProperty('disabled', true)
  await act(async () => vi.advanceTimersByTime(3000))
})

test('저장소가 막혀 있어도 조회와 지역 선택을 사용할 수 있다', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
  show(); await choose(); api.getBookAvailability.mockResolvedValue(result)
  fireEvent.click(screen.getByRole('button', { name: '도서관 찾기' }))
  await screen.findByText('가온도서관')
})

test('지역 목록에서 사라진 저장 코드는 지우고 다시 고르도록 한다', async () => {
  const first = show(); await choose(); api.getBookAvailability.mockResolvedValue(result)
  fireEvent.click(screen.getByRole('button', { name: '도서관 찾기' })); await screen.findByText('가온도서관'); first.unmount()
  api.getRegions.mockResolvedValue([regions[1]])
  show(); fireEvent.click(screen.getByRole('tab', { name: '도서관' }))
  await screen.findByText(/지역을 다시 선택/)
  expect(screen.getByLabelText('시·도')).toHaveProperty('value', '')
  expect(localStorage.length).toBe(0)
})
