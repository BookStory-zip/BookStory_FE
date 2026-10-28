// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AuthApiError } from '@supabase/supabase-js'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import PasswordReset from './PasswordReset'

const mocks = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(),
  getPasswordResetUser: vi.fn(),
  updatePassword: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChange: vi.fn(),
}))

vi.mock('./lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/auth')>(),
  requestPasswordReset: mocks.requestPasswordReset,
  getPasswordResetUser: mocks.getPasswordResetUser,
  updatePassword: mocks.updatePassword,
  signOut: mocks.signOut,
}))
vi.mock('./lib/supabase', () => ({
  supabase: { auth: { onAuthStateChange: mocks.onAuthStateChange } },
}))

const session: Session = {
  access_token: 'test-token', refresh_token: 'test-refresh',
  token_type: 'bearer', expires_in: 3600,
  user: {
    id: 'user-A', email: 'reader@example.test', aud: 'authenticated',
    app_metadata: {}, user_metadata: {}, created_at: '2026-10-27T00:00:00Z',
  },
}
let notify: (event: AuthChangeEvent, session: Session | null) => void

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getPasswordResetUser.mockResolvedValue(session.user)
  mocks.requestPasswordReset.mockResolvedValue(undefined)
  mocks.updatePassword.mockResolvedValue(undefined)
  mocks.onAuthStateChange.mockImplementation((callback: typeof notify) => {
    notify = callback
    callback('INITIAL_SESSION', session)
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  })
})
afterEach(cleanup)

test('메일 응답을 기다리는 동안 중복 요청을 막고 계정 존재를 단정하지 않는다', async () => {
  let complete!: () => void
  mocks.requestPasswordReset.mockReturnValue(new Promise<void>((resolve) => { complete = resolve }))
  render(<PasswordReset />)
  fireEvent.change(screen.getByLabelText('이메일'), { target: { value: ' reader@example.test ' } })
  const form = screen.getByRole('form', { name: '재설정 메일 요청' })
  fireEvent.submit(form)
  fireEvent.submit(form)
  expect(mocks.requestPasswordReset).toHaveBeenCalledTimes(1)
  expect(mocks.requestPasswordReset).toHaveBeenCalledWith('reader@example.test')
  expect(screen.getByRole('status').textContent).not.toContain('가입된 주소라면')
  await act(async () => { complete() })
  expect(screen.getByRole('status').textContent).toContain('가입된 주소라면')
})

test('발송 실패 시 이메일을 보존하고 다시 제출할 수 있다', async () => {
  mocks.requestPasswordReset.mockRejectedValue(new Error('offline'))
  render(<PasswordReset />)
  const input = screen.getByLabelText('이메일') as HTMLInputElement
  fireEvent.change(input, { target: { value: 'reader@example.test' } })
  fireEvent.submit(screen.getByRole('form', { name: '재설정 메일 요청' }))
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('실패'))
  expect(input.value).toBe('reader@example.test')
  expect((screen.getByRole('button', { name: '재설정 메일 보내기' }) as HTMLButtonElement).disabled).toBe(false)
})

test('만료된 링크는 새 비밀번호 폼을 표시하지 않는다', async () => {
  mocks.getPasswordResetUser.mockRejectedValue(new AuthApiError('expired', 403, 'otp_expired'))
  render(<PasswordReset recovery />)
  await screen.findByText(/만료되었거나/)
  expect(screen.queryByLabelText('새 비밀번호', { selector: 'input' })).toBeNull()
  expect(screen.getByRole('link', { name: '새 재설정 메일 요청' }).getAttribute('href')).toBe('/reset-password')
})

test('링크 확인이 일시적으로 실패하면 만료로 단정하지 않는다', async () => {
  mocks.getPasswordResetUser.mockRejectedValue(new AuthApiError('unavailable', 503, undefined))
  render(<PasswordReset recovery />)
  await screen.findByText(/확인에 실패/)
  expect(screen.queryByText(/만료되었거나/)).toBeNull()
  expect(screen.queryByLabelText('새 비밀번호', { selector: 'input' })).toBeNull()
})

test('비밀번호 확인이 다르면 저장 요청을 보내지 않는다', async () => {
  render(<PasswordReset recovery />)
  fireEvent.change(await screen.findByLabelText('새 비밀번호', { selector: 'input' }), { target: { value: 'new-password-123' } })
  fireEvent.change(screen.getByLabelText('새 비밀번호 확인'), { target: { value: 'different' } })
  fireEvent.submit(screen.getByRole('form', { name: '새 비밀번호' }))
  expect(mocks.updatePassword).not.toHaveBeenCalled()
  expect(screen.getByRole('status').textContent).toContain('일치하지')
})

test('저장 실패 시 비밀번호 입력을 유지한다', async () => {
  mocks.updatePassword.mockRejectedValue(new AuthApiError('weak', 422, 'weak_password'))
  render(<PasswordReset recovery />)
  const password = await screen.findByLabelText('새 비밀번호', { selector: 'input' }) as HTMLInputElement
  fireEvent.change(password, { target: { value: 'new-password-123' } })
  fireEvent.change(screen.getByLabelText('새 비밀번호 확인'), { target: { value: 'new-password-123' } })
  fireEvent.submit(screen.getByRole('form', { name: '새 비밀번호' }))
  await screen.findByText(/길이와 문자 조합/)
  expect(password.value).toBe('new-password-123')
})

test('저장이 성공해야 완료 안내를 표시한다', async () => {
  let complete!: () => void
  mocks.updatePassword.mockReturnValue(new Promise<void>((resolve) => { complete = resolve }))
  render(<PasswordReset recovery />)
  fireEvent.change(await screen.findByLabelText('새 비밀번호', { selector: 'input' }), { target: { value: ' new password ' } })
  fireEvent.change(screen.getByLabelText('새 비밀번호 확인'), { target: { value: ' new password ' } })
  const form = screen.getByRole('form', { name: '새 비밀번호' })
  fireEvent.submit(form)
  fireEvent.submit(form)
  expect(mocks.updatePassword).toHaveBeenCalledTimes(1)
  expect(mocks.updatePassword).toHaveBeenCalledWith(' new password ', 'user-A', expect.any(AbortSignal))
  expect(screen.getByRole('status').textContent).not.toContain('변경되었습니다')
  await act(async () => { complete() })
  expect(screen.getByRole('status').textContent).toContain('변경되었습니다')
  expect(screen.queryByLabelText('새 비밀번호', { selector: 'input' })).toBeNull()
})

test('다른 계정으로 변경되면 늦은 저장 결과를 무시한다', async () => {
  let complete!: () => void
  mocks.updatePassword.mockReturnValue(new Promise<void>((resolve) => { complete = resolve }))
  render(<PasswordReset recovery />)
  fireEvent.change(await screen.findByLabelText('새 비밀번호', { selector: 'input' }), { target: { value: 'new-password-123' } })
  fireEvent.change(screen.getByLabelText('새 비밀번호 확인'), { target: { value: 'new-password-123' } })
  fireEvent.submit(screen.getByRole('form', { name: '새 비밀번호' }))
  act(() => notify('SIGNED_IN', { ...session, user: { ...session.user, id: 'user-B' } }))
  expect(mocks.updatePassword.mock.calls[0][2].aborted).toBe(true)
  await act(async () => { complete() })
  expect(screen.queryByLabelText('새 비밀번호', { selector: 'input' })).toBeNull()
  expect(screen.getByRole('status').textContent).toContain('계정이 변경')
  expect(screen.getByRole('status').textContent).not.toContain('변경되었습니다')
})

test('변경 성공 후 로그아웃 실패를 비밀번호 저장 실패로 표시하지 않는다', async () => {
  mocks.signOut.mockRejectedValue(new Error('offline'))
  render(<PasswordReset recovery />)
  fireEvent.change(await screen.findByLabelText('새 비밀번호', { selector: 'input' }), { target: { value: 'new-password-123' } })
  fireEvent.change(screen.getByLabelText('새 비밀번호 확인'), { target: { value: 'new-password-123' } })
  fireEvent.submit(screen.getByRole('form', { name: '새 비밀번호' }))
  fireEvent.click(await screen.findByRole('button', { name: '로그아웃 후 로그인하기' }))
  await screen.findByText(/변경되었지만 로그아웃/)
  expect(mocks.updatePassword).toHaveBeenCalledTimes(1)
})

test('재설정 화면에서 그만두면 재설정 세션을 로그아웃한 뒤 이동한다', async () => {
  mocks.signOut.mockRejectedValue(new Error('로그아웃 실패'))
  render(<PasswordReset recovery />)
  await screen.findByRole('form', { name: '새 비밀번호' })

  expect(screen.queryByRole('link', { name: '로그인 화면으로' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '변경을 그만두고 로그인 화면으로' }))

  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('로그아웃에 실패했습니다'))
  expect(mocks.signOut).toHaveBeenCalledTimes(1)
})
