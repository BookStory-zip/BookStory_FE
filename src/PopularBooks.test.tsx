// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError } from './lib/api'
import type { PopularBooksSnapshot } from './lib/discovery'
import PopularBooks from './PopularBooks'
import { StrictMode } from 'react'

const mocks = vi.hoisted(() => ({ getPopularBooks: vi.fn() }))
vi.mock('./lib/discovery', async (original) => ({ ...await original<typeof import('./lib/discovery')>(), ...mocks }))
vi.mock('./lib/supabase', () => ({ supabase: { auth: {} } }))
const snapshot = (count = 10, title = '인기'): PopularBooksSnapshot => ({ source: 'yes24', collected_at: '2026-11-12T21:00:00Z', basis_date: '2026-11-12', monthly_basis: '2026-10', items: Array.from({ length: count }, (_, index) => ({ rank: index + 1, daily_rank: null, monthly_rank: index + 2, isbn13: `978893643${String(index).padStart(4, '0')}`, title: `${title} ${index + 1}`, author: '작가 저/번역가 역', publisher: null, thumbnail_url: null, source_url: `https://www.yes24.com/product/goods/${index + 1}` })) })
const open = () => render(<MemoryRouter><PopularBooks /></MemoryRouter>)
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-13T03:00:00Z')) })
afterEach(() => { cleanup(); vi.useRealTimers() })

test('10권과 출처·일간/월간 기준·항목별 YES24 링크를 보여준다', async () => {
  mocks.getPopularBooks.mockResolvedValue(snapshot())
  open()
  await screen.findByText('인기 10')
  expect(screen.getByText(/YES24 일간·월간 베스트셀러 종합/)).toBeTruthy()
  expect(screen.getByText(/2026년 10월/)).toBeTruthy()
  expect(screen.getAllByRole('link', { name: /YES24에서 보기/ })).toHaveLength(10)
  expect(screen.getByRole('link', { name: '인기 1' }).getAttribute('href')).toBe('/catalog/9788936430000')
  expect(mocks.getPopularBooks).toHaveBeenCalledWith(10)
})

test('전체 보기는 다른 수집본·30권 미만 응답도 이어 붙이지 않고 교체한다', async () => {
  mocks.getPopularBooks.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce({ ...snapshot(12, '새 목록'), collected_at: '2026-11-13T02:00:00Z' })
  open()
  fireEvent.click(await screen.findByRole('button', { name: '전체 보기' }))
  await screen.findByText('새 목록 12')
  expect(screen.queryByText('인기 1')).toBeNull()
  expect(screen.getAllByRole('listitem')).toHaveLength(12)
  expect(mocks.getPopularBooks).toHaveBeenLastCalledWith(30)
  fireEvent.click(screen.getByRole('button', { name: '접기' }))
  expect(screen.queryByText('새 목록 12')).toBeNull()
})

test.each([null, '2026-11-09T00:00:00Z'])('빈 목록이나 72시간 지난 데이터는 숨긴다: %s', async (collected_at) => {
  const response = { ...snapshot(collected_at ? 2 : 0), collected_at }
  mocks.getPopularBooks.mockResolvedValue(response)
  const { container } = open()
  await waitFor(() => expect(container.textContent).toBe(''))
})

test('전체 보기 429는 기존 목록을 보존하고 대기 시간 뒤 수동 재시도한다', async () => {
  vi.useFakeTimers()
  mocks.getPopularBooks.mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new ApiError(429, '', 'rate_limited', 5))
  open()
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: '전체 보기' }))
  await act(async () => {})
  expect(screen.getByRole('alert').textContent).toContain('5초')
  expect(screen.getByText('인기 1')).toBeTruthy()
  const retry = within(screen.getByRole('alert')).getByRole('button', { name: '다시 시도' })
  expect(retry).toHaveProperty('disabled', true)
  await act(async () => { vi.advanceTimersByTime(5000) })
  expect(retry).toHaveProperty('disabled', false)
  expect(mocks.getPopularBooks).toHaveBeenCalledTimes(2)
})

test('화면을 떠난 뒤 온 응답은 새 화면을 바꾸지 않는다', async () => {
  let resolve!: (value: PopularBooksSnapshot) => void
  mocks.getPopularBooks.mockReturnValue(new Promise((done) => { resolve = done }))
  const { unmount } = open()
  unmount()
  await act(async () => resolve(snapshot()))
  expect(screen.queryByText('인기 1')).toBeNull()
})

test('화면을 켜 둔 동안 72시간이 지나도 오래된 목록을 숨긴다', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(Date.parse(snapshot().collected_at!) + 72 * 60 * 60 * 1000 - 1000))
  mocks.getPopularBooks.mockResolvedValue(snapshot())
  open()
  await act(async () => {})
  expect(screen.getByText('인기 1')).toBeTruthy()
  await act(async () => { vi.advanceTimersByTime(1001) })
  expect(screen.queryByRole('region', { name: '요즘 인기 있는 책' })).toBeNull()
})

test('StrictMode에서 이전 조회가 나중에 끝나도 최신 수집본을 덮지 않는다', async () => {
  let finish!: (value: PopularBooksSnapshot) => void
  mocks.getPopularBooks.mockReturnValueOnce(new Promise((resolve) => { finish = resolve })).mockResolvedValueOnce(snapshot(2, '최신'))
  render(<StrictMode><MemoryRouter><PopularBooks /></MemoryRouter></StrictMode>)
  await screen.findByText('최신 1')
  await act(async () => finish(snapshot(2, '이전')))
  expect(screen.queryByText('이전 1')).toBeNull()
  expect(screen.getByText('최신 1')).toBeTruthy()
})
