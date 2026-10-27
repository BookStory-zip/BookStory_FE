// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError } from './lib/api'
import type { SearchBook } from './lib/api'
import BookSearch from './BookSearch'

const mocks = vi.hoisted(() => ({
  searchBooks: vi.fn(),
  addLibraryBook: vi.fn(),
}))

vi.mock('./lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/api')>(),
  searchBooks: mocks.searchBooks,
  addLibraryBook: mocks.addLibraryBook,
}))
vi.mock('./lib/auth', () => ({
  withAccessToken: (request: (token: string) => Promise<unknown>) => request('test-token'),
}))

function book(title: string, isbn13: string | null): SearchBook {
  return { title, authors: ['저자'], publisher: '출판사', thumbnail: null, isbn13 }
}

function search(query: string) {
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } })
  fireEvent.submit(screen.getByRole('search'))
}

beforeEach(() => {
  vi.resetAllMocks()
  render(<MemoryRouter><BookSearch /></MemoryRouter>)
})
afterEach(cleanup)

test('공백만 입력하면 요청하지 않는다', () => {
  search('   ')
  expect(mocks.searchBooks).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toContain('검색어를 입력')
})

test('먼저 보낸 검색의 늦은 응답이 최신 결과를 덮지 않는다', async () => {
  let resolveFirst!: (books: SearchBook[]) => void
  mocks.searchBooks
    .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve }))
    .mockResolvedValueOnce([book('두 번째 결과', '9788936433598')])

  search('첫 검색')
  search('두 번째 검색')
  await screen.findByText('두 번째 결과')
  resolveFirst([book('첫 번째 결과', '9788936433581')])

  await waitFor(() => expect(screen.queryByText('첫 번째 결과')).toBeNull())
})

test('ISBN13이 없는 결과는 담기 버튼 대신 이유를 보여 준다', async () => {
  mocks.searchBooks.mockResolvedValueOnce([book('ISBN10만 있는 책', null)])
  search('책')

  await screen.findByText('13자리 ISBN이 없어 서재에 담을 수 없습니다.')
  expect(screen.queryByRole('button', { name: '서재에 담기' })).toBeNull()
})

test('담는 중에는 다시 누를 수 없고, 이미 있던 책이면 기존 상태를 알린다', async () => {
  let resolveAdd!: (value: { id: string; status: string }) => void
  mocks.searchBooks.mockResolvedValueOnce([book('읽던 책', '9788936433598')])
  mocks.addLibraryBook.mockReturnValueOnce(new Promise((resolve) => { resolveAdd = resolve }))
  search('책')

  fireEvent.click(await screen.findByRole('button', { name: '서재에 담기' }))
  const saving = screen.getByRole('button', { name: '담는 중…' }) as HTMLButtonElement
  expect(saving.disabled).toBe(true)
  fireEvent.click(saving)
  expect(mocks.addLibraryBook).toHaveBeenCalledTimes(1)
  expect(mocks.addLibraryBook).toHaveBeenCalledWith('test-token', '9788936433598')

  resolveAdd({ id: 'user-book-1', status: 'reading' })
  expect((await screen.findByRole('status')).textContent).toContain('이미 서재에 있는 책입니다. (읽는 중)')
})

test('검색 오류는 빈 결과로 바꾸지 않고 원인을 구분한다', async () => {
  mocks.searchBooks.mockRejectedValueOnce(new ApiError(504))
  search('책')

  expect((await screen.findByRole('alert')).textContent).toContain('응답이 늦습니다')
  expect(screen.queryByText(/검색 결과가 없습니다/)).toBeNull()
})

test('등록 중 네트워크 오류는 자동 재전송하지 않고 서재 확인을 안내한다', async () => {
  mocks.searchBooks.mockResolvedValueOnce([book('책', '9788936433598')])
  mocks.addLibraryBook.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  search('책')

  fireEvent.click(await screen.findByRole('button', { name: '서재에 담기' }))
  expect((await screen.findByRole('status')).textContent).toContain('서재에서 담겼는지 확인')
  expect(mocks.addLibraryBook).toHaveBeenCalledTimes(1)
})
