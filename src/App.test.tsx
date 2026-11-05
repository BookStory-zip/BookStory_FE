// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { AuthState } from './lib/auth'
import { readTimer, startTimer, writeTimer } from './lib/timer'
import App from './App'

const mocks = vi.hoisted(() => ({ subscribeAuthState: vi.fn(), signOut: vi.fn() }))
vi.mock('./lib/auth', () => ({ ...mocks, signIn: vi.fn(), signUp: vi.fn() }))
vi.mock('./lib/push', () => ({ releaseReminder: vi.fn().mockResolvedValue(undefined), syncReminder: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./Library', () => ({ default: () => <p>테스트 서재</p> }))
vi.mock('./AccountSettings', () => ({ default: ({ onDeleted }: { onDeleted: () => void }) => <button onClick={onDeleted}>테스트 탈퇴 완료</button> }))
let notify: (state: AuthState) => void
const signedIn = (id: string): AuthState => ({ authUserId: id, user: { user_id: id }, isChecking: false, error: null })

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  mocks.subscribeAuthState.mockImplementation(callback => { notify = callback; return () => {} })
})
afterEach(cleanup)

async function open() {
  render(<MemoryRouter initialEntries={['/settings']}><App /></MemoryRouter>)
  act(() => notify(signedIn('user-a')))
  await screen.findByRole('button', { name: '테스트 탈퇴 완료' })
  writeTimer(startTimer('user-a', 'book-a', Date.now(), crypto.randomUUID()))
}

test('계정이 바뀌면 이전 계정의 진행 측정을 정리한다', async () => {
  await open()
  act(() => notify(signedIn('user-b')))
  expect(readTimer('user-a')).toBeNull()
})

test('상단 로고로 서재에 이동하고 독립 타이머 메뉴를 제공한다', async () => {
  await open()
  expect(screen.getByRole('link', { name: '타이머' }).getAttribute('href')).toBe('/timer')
  fireEvent.click(screen.getByRole('link', { name: 'BookStory' }))
  await screen.findByText('테스트 서재')
})

test('탈퇴 완료 후 로그아웃이 실패해도 측정은 정리한다', async () => {
  mocks.signOut.mockRejectedValue(new TypeError('network'))
  await open()
  fireEvent.click(screen.getByRole('button', { name: '테스트 탈퇴 완료' }))
  await waitFor(() => expect(mocks.signOut).toHaveBeenCalled())
  expect(readTimer('user-a')).toBeNull()
})
