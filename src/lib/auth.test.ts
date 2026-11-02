import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { addLibraryBook } from './api'
import {
  getPasswordResetUser,
  requestPasswordReset,
  signIn,
  signUp,
  subscribeAuthState,
  updatePassword,
  withAccessToken,
  SessionMissingError,
} from './auth'

const { auth } = vi.hoisted(() => ({
  auth: {
    getSession: vi.fn(),
    refreshSession: vi.fn(),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    onAuthStateChange: vi.fn(),
    initialize: vi.fn(),
    getUser: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    updateUser: vi.fn(),
  },
}))

vi.mock('./supabase', () => ({ supabase: { auth } }))

const fetchMock = vi.fn<typeof fetch>()
const unsubscribeMock = vi.fn()
let currentSession: Session | null
let notify: (event: AuthChangeEvent, session: Session | null) => void
let stop: (() => void) | undefined

function makeSession(id: string): Session {
  return {
    access_token: `test-token-${id}`,
    refresh_token: 'test-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    user: {
      id,
      aud: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-10-27T00:00:00Z',
    },
  }
}

const sessionA = makeSession('11111111-1111-4111-8111-111111111111')
const sessionB = makeSession('22222222-2222-4222-8222-222222222222')
const userA = { user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
const userB = { user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }

function emit(event: AuthChangeEvent, session: Session | null) {
  currentSession = session
  notify(event, session)
}

function deferredResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('window', {
    location: { origin: 'http://localhost:5173' },
  })
  fetchMock.mockRejectedValue(new Error('예상하지 않은 API 요청'))
  currentSession = null

  auth.getSession.mockImplementation(async () => ({
    data: { session: currentSession },
    error: null,
  }))
  auth.signInWithPassword.mockResolvedValue({ error: null })
  auth.initialize.mockResolvedValue({ error: null })
  auth.getUser.mockResolvedValue({ data: { user: sessionA.user }, error: null })
  auth.onAuthStateChange.mockImplementation((callback: typeof notify) => {
    notify = callback
    return { data: { subscription: { unsubscribe: unsubscribeMock } } }
  })
})

afterEach(() => {
  stop?.()
  stop = undefined
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

test('SDK 로그인 함수가 별도로 /me를 중복 요청하지 않는다', async () => {
  await signIn('reader@example.test', ' password ')

  expect(auth.signInWithPassword).toHaveBeenCalledWith({
    email: 'reader@example.test',
    password: ' password ',
  })
  expect(fetchMock).not.toHaveBeenCalled()
})

test('401 재시도 중 갱신 이벤트가 와도 요청을 반복하지 않는다', async () => {
  auth.refreshSession.mockImplementation(async () => {
    const refreshed = { ...sessionA, access_token: 'refreshed-token' }
    emit('TOKEN_REFRESHED', refreshed)
    return { data: { session: refreshed }, error: null }
  })
  fetchMock.mockResolvedValue(new Response(null, { status: 401 }))
  const onChange = vi.fn()
  stop = subscribeAuthState(onChange)

  emit('INITIAL_SESSION', sessionA)
  await vi.advanceTimersByTimeAsync(10)

  expect(onChange).toHaveBeenLastCalledWith({
    user: null,
    authUserId: sessionA.user.id,
    isChecking: false,
    error: expect.objectContaining({ status: 401 }),
    retry: expect.any(Function),
  })
  expect(auth.refreshSession).toHaveBeenCalledTimes(1)
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://api.example.test/me', {
    headers: { Authorization: 'Bearer refreshed-token' },
    signal: expect.any(AbortSignal),
  })
})

test('503은 인증 확인 오류로 전달하고 로그아웃하지 않는다', async () => {
  fetchMock.mockResolvedValue(new Response(null, { status: 503 }))
  const onChange = vi.fn()
  stop = subscribeAuthState(onChange)

  emit('INITIAL_SESSION', sessionA)
  await vi.advanceTimersByTimeAsync(0)

  expect(onChange).toHaveBeenLastCalledWith({
    user: null,
    authUserId: sessionA.user.id,
    isChecking: false,
    error: expect.objectContaining({ status: 503 }),
    retry: expect.any(Function),
  })
  expect(auth.refreshSession).not.toHaveBeenCalled()
  expect(auth.signOut).not.toHaveBeenCalled()
})

test.each([sessionB, null])('401 응답 전에 계정 전환·로그아웃되면 등록을 재전송하지 않는다: %j', async (nextSession) => {
  currentSession = sessionA
  const pending = deferredResponse()
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(Response.json({ id: 'new-book', status: 'want_to_read' }, { status: 201 }))
  auth.refreshSession.mockResolvedValue({ data: { session: nextSession ?? sessionB }, error: null })
  const request = withAccessToken((token) => addLibraryBook(token, '9788936433598'))
  const rejected = expect(request).rejects.toBeInstanceOf(SessionMissingError)
  await vi.advanceTimersByTimeAsync(0)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  currentSession = nextSession
  pending.resolve(new Response(null, { status: 401 }))
  await rejected
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(auth.refreshSession).not.toHaveBeenCalled()
  expect(auth.signOut).not.toHaveBeenCalled()
})

test('토큰 갱신 중 계정이 바뀌어도 새 계정으로 등록을 재시도하지 않는다', async () => {
  currentSession = sessionA
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(Response.json({ id: 'new-book', status: 'want_to_read' }, { status: 201 }))
  auth.refreshSession.mockImplementation(async () => {
    currentSession = sessionB
    return { data: { session: sessionB }, error: null }
  })
  await expect(withAccessToken((token) => addLibraryBook(token, '9788936433598'))).rejects.toBeInstanceOf(SessionMissingError)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(auth.signOut).not.toHaveBeenCalled()
})

test('503 뒤 다시 시도하면 같은 세션으로 /me를 다시 확인한다', async () => {
  fetchMock
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(Response.json(userA))
  const onChange = vi.fn()
  stop = subscribeAuthState(onChange)

  emit('INITIAL_SESSION', sessionA)
  await vi.advanceTimersByTimeAsync(0)
  onChange.mock.lastCall?.[0].retry()
  await vi.advanceTimersByTimeAsync(0)

  expect(onChange).toHaveBeenLastCalledWith({
    user: userA,
    authUserId: sessionA.user.id,
    isChecking: false,
    error: null,
  })
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

test('확인된 같은 계정의 사용자 정보 변경 이벤트는 개인 화면을 다시 확인하지 않는다', async () => {
  fetchMock.mockResolvedValue(Response.json(userA))
  const onChange = vi.fn()
  stop = subscribeAuthState(onChange)

  emit('INITIAL_SESSION', sessionA)
  await vi.advanceTimersByTimeAsync(0)
  onChange.mockClear()
  emit('USER_UPDATED', sessionA)
  await vi.advanceTimersByTimeAsync(0)

  expect(onChange).not.toHaveBeenCalled()
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test('로그아웃 뒤 도착한 이전 사용자 응답을 무시한다', async () => {
  const pending = deferredResponse()
  fetchMock.mockReturnValue(pending.promise)
  const onChange = vi.fn()
  stop = subscribeAuthState(onChange)

  emit('INITIAL_SESSION', sessionA)
  await vi.advanceTimersByTimeAsync(0)
  emit('SIGNED_OUT', null)

  pending.resolve(Response.json(userA))
  await vi.advanceTimersByTimeAsync(0)

  expect(onChange).toHaveBeenLastCalledWith({
    user: null,
    authUserId: null,
    isChecking: false,
    error: null,
  })
})

test('A의 늦은 응답이 새 계정 B의 확인 결과를 덮지 않는다', async () => {
  const pendingA = deferredResponse()
  fetchMock
    .mockReturnValueOnce(pendingA.promise)
    .mockResolvedValueOnce(Response.json(userB))
  const onChange = vi.fn()
  stop = subscribeAuthState(onChange)

  emit('INITIAL_SESSION', sessionA)
  await vi.advanceTimersByTimeAsync(0)
  emit('SIGNED_IN', sessionB)
  await vi.advanceTimersByTimeAsync(0)

  pendingA.resolve(Response.json(userA))
  await vi.advanceTimersByTimeAsync(0)

  expect(onChange).toHaveBeenLastCalledWith({
    user: userB,
    authUserId: sessionB.user.id,
    isChecking: false,
    error: null,
  })
})

test('구독 해제 후에는 진행 중 요청의 결과를 전달하지 않는다', async () => {
  const pending = deferredResponse()
  fetchMock.mockReturnValue(pending.promise)
  const onChange = vi.fn()
  stop = subscribeAuthState(onChange)

  emit('INITIAL_SESSION', sessionA)
  await vi.advanceTimersByTimeAsync(0)
  stop()
  stop = undefined
  onChange.mockClear()

  pending.resolve(Response.json(userA))
  await vi.advanceTimersByTimeAsync(0)

  expect(onChange).not.toHaveBeenCalled()
  expect(unsubscribeMock).toHaveBeenCalledTimes(1)
})

test('세션 없는 가입 성공을 이메일 확인 대기 상태로 반환한다', async () => {
  auth.signUp.mockResolvedValue({
    data: { session: null },
    error: null,
  })

  await expect(
    signUp('reader@example.test', ' password '),
  ).resolves.toEqual({ hasSession: false })

  expect(auth.signUp).toHaveBeenCalledWith({
    email: 'reader@example.test',
    password: ' password ',
    options: { emailRedirectTo: 'http://localhost:5173/' },
  })
  expect(fetchMock).not.toHaveBeenCalled()
})

test('가입 응답에 세션이 있으면 그 사실만 반환한다', async () => {
  auth.signUp.mockResolvedValue({
    data: { session: sessionA },
    error: null,
  })

  await expect(
    signUp('reader@example.test', ' password '),
  ).resolves.toEqual({ hasSession: true })

  expect(fetchMock).not.toHaveBeenCalled()
})

test('회원가입 SDK 오류를 성공으로 바꾸지 않고 전달한다', async () => {
  const error = new Error('SMTP request failed')
  auth.signUp.mockResolvedValue({
    data: { session: null },
    error,
  })

  await expect(
    signUp('reader@example.test', ' password '),
  ).rejects.toBe(error)
  expect(fetchMock).not.toHaveBeenCalled()
})

test('재설정 메일에 새 비밀번호 입력 화면의 복귀 주소를 전달한다', async () => {
  auth.resetPasswordForEmail.mockResolvedValue({ error: null })
  await requestPasswordReset('reader@example.test')
  expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('reader@example.test', {
    redirectTo: 'http://localhost:5173/reset-password/update',
  })
})

test('메일 발송 실패를 자동 재시도하거나 성공으로 바꾸지 않는다', async () => {
  const error = new Error('SMTP failed')
  auth.resetPasswordForEmail.mockResolvedValue({ error })
  await expect(requestPasswordReset('reader@example.test')).rejects.toBe(error)
  expect(auth.resetPasswordForEmail).toHaveBeenCalledTimes(1)
})

test('잘못된 링크 초기화 오류가 있으면 기존 계정으로 복구를 진행하지 않는다', async () => {
  const error = new Error('expired callback')
  auth.initialize.mockResolvedValue({ error })
  await expect(getPasswordResetUser()).rejects.toBe(error)
  expect(auth.getUser).not.toHaveBeenCalled()
  expect(auth.updateUser).not.toHaveBeenCalled()
})

test('재설정 화면에서 SDK 서버가 확인한 사용자만 반환한다', async () => {
  await expect(getPasswordResetUser()).resolves.toEqual(sessionA.user)
  expect(auth.getUser).toHaveBeenCalledTimes(1)
})

test('다른 계정으로 바뀌면 비밀번호 변경 요청을 보내지 않는다', async () => {
  auth.getUser.mockResolvedValue({ data: { user: sessionB.user }, error: null })
  await expect(updatePassword(' new password ', sessionA.user.id, new AbortController().signal)).rejects.toThrow()
  expect(auth.getUser).toHaveBeenCalledTimes(1)
  expect(auth.updateUser).not.toHaveBeenCalled()
})

test('새 비밀번호의 앞뒤 공백을 바꾸지 않고 SDK로 저장한다', async () => {
  auth.updateUser.mockResolvedValue({ error: null })
  await updatePassword(' new password ', sessionA.user.id, new AbortController().signal)
  expect(auth.updateUser).toHaveBeenCalledWith({ password: ' new password ' })
})

test('비밀번호 저장 실패를 자동 재시도하지 않고 전달한다', async () => {
  const error = new Error('save failed')
  auth.updateUser.mockResolvedValue({ error })
  await expect(updatePassword('new password', sessionA.user.id, new AbortController().signal)).rejects.toBe(error)
  expect(auth.updateUser).toHaveBeenCalledTimes(1)
})

test('사용자 확인 중 계정이 바뀌면 저장 요청을 시작하지 않는다', async () => {
  const controller = new AbortController()
  let complete!: (result: { data: { user: typeof sessionA.user }; error: null }) => void
  auth.getUser.mockReturnValue(new Promise((resolve) => { complete = resolve }))
  const request = updatePassword('new password', sessionA.user.id, controller.signal)
  await vi.waitFor(() => expect(auth.getUser).toHaveBeenCalledTimes(1))
  controller.abort()
  complete({ data: { user: sessionA.user }, error: null })
  await expect(request).rejects.toThrow()
  expect(auth.updateUser).not.toHaveBeenCalled()
})
