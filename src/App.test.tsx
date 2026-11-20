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

test.each(['account-change', 'logout'])('%s 시 이전 계정의 저장 지역도 지운다', async kind => {
  await open()
  localStorage.setItem('bookstory:last-library-district:user-a', '11190')
  localStorage.setItem('bookstory:last-library-district', '11190')
  act(() => notify(kind === 'logout' ? { authUserId: null, user: null, isChecking: false, error: null } : signedIn('user-b')))
  expect(localStorage.getItem('bookstory:last-library-district:user-a')).toBeNull()
  expect(localStorage.getItem('bookstory:last-library-district')).toBeNull()
})

test('상단 로고로 서재에 이동하고 타이머는 메뉴 대신 공통 버튼으로 제공한다', async () => {
  await open()
  expect(screen.queryByRole('link', { name: '타이머' })).toBeNull()
  expect(screen.getByRole('button', { name: /타이머 열기/ })).toBeTruthy()
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
