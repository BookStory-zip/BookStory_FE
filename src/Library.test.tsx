// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError } from './lib/api'
import type { LibraryBookItem } from './lib/api'
import Library, { PAGE_SIZE } from './Library'

const mocks = vi.hoisted(() => ({
  getLibraryBooks: vi.fn(),
}))

vi.mock('./lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/api')>(),
  getLibraryBooks: mocks.getLibraryBooks,
}))
// 환경변수 없는 CI에서도 실제 Supabase 클라이언트를 만들지 않는다.
vi.mock('./lib/supabase', () => ({ supabase: { auth: {} } }))
vi.mock('./lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/auth')>(),
  withAccessToken: (request: (token: string) => Promise<unknown>) => request('test-token'),
}))

function makeBooks(count: number, prefix: string): LibraryBookItem[] {
  return Array.from({ length: count }, (_, index) => ({
    // 서재 id와 공통 책 id를 다르게 두어 혼동을 드러낸다.
    id: `${prefix}-user-book-${index}`,
    book_id: `${prefix}-book-${index}`,
    isbn13: '9788936433598',
    title: `${prefix} 책 ${index}`,
    authors: [],
    thumbnail_url: null,
    status: 'reading',
    created_at: '2026-10-27T00:00:00Z',
  }))
}

// 표지가 상세 링크이므로 라우터 안에서 그린다.
const renderInRouter = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

beforeEach(() => vi.resetAllMocks())
afterEach(cleanup)

test('더 보기는 받은 개수만큼 offset을 넘겨 다음 페이지를 이어 붙인다', async () => {
  mocks.getLibraryBooks
    .mockResolvedValueOnce(makeBooks(PAGE_SIZE, 'A'))
    .mockResolvedValueOnce(makeBooks(3, 'B'))
  renderInRouter(<Library />)

  fireEvent.click(await screen.findByRole('button', { name: '더 보기' }))

  await screen.findByText('B 책 2')
  expect(mocks.getLibraryBooks).toHaveBeenLastCalledWith('test-token', PAGE_SIZE, PAGE_SIZE)
  expect(screen.getAllByRole('listitem')).toHaveLength(PAGE_SIZE + 3)
  // 마지막 페이지가 PAGE_SIZE보다 적으면 더 보기를 숨긴다.
  expect(screen.queryByRole('button', { name: '더 보기' })).toBeNull()
})

test('조회 실패를 빈 서재로 표시하지 않고 재시도할 수 있다', async () => {
  mocks.getLibraryBooks
    .mockRejectedValueOnce(new ApiError(503))
    .mockResolvedValueOnce(makeBooks(1, 'A'))
  renderInRouter(<Library />)

  expect((await screen.findByRole('alert')).textContent).toContain('잠시 응답할 수 없습니다')
  expect(screen.queryByText(/아직 서재에 담은 책이 없습니다/)).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  await screen.findByText('A 책 0')
})

test('빈 배열이면 빈 서재 안내를 표시한다', async () => {
  mocks.getLibraryBooks.mockResolvedValueOnce([])
  renderInRouter(<Library />)
  await screen.findByText(/아직 서재에 담은 책이 없습니다/)
  expect(screen.getByRole('link', { name: '책 찾으러 가기' }).getAttribute('href')).toBe('/search')
})

test('계정이 바뀐 뒤 도착한 이전 계정 응답은 표시하지 않는다', async () => {
  let resolveA!: (books: LibraryBookItem[]) => void
  mocks.getLibraryBooks
    .mockReturnValueOnce(new Promise((resolve) => { resolveA = resolve }))
    .mockResolvedValueOnce(makeBooks(1, 'B'))
  const { rerender } = renderInRouter(<Library key="user-A" />)

  rerender(<MemoryRouter><Library key="user-B" /></MemoryRouter>)
  await screen.findByText('B 책 0')
  resolveA(makeBooks(1, 'A'))

  await waitFor(() => expect(screen.queryByText('A 책 0')).toBeNull())
  expect(screen.getAllByRole('listitem')).toHaveLength(1)
})
