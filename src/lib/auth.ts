import { ApiError, deleteMe, getMe } from './api'
import { supabase } from './supabase'

export class SessionMissingError extends Error {
  constructor() {
    super('로그인이 필요합니다.')
    this.name = 'SessionMissingError'
  }
}

// 현재 access token으로 요청하고, 401이면 SDK로 한 번만 갱신해 다시 요청한다.
export async function withAccessToken<T>(
  request: (accessToken: string) => Promise<T>,
): Promise<T> {
  const { data, error } = await supabase.auth.getSession()

  if (error) throw error
  if (!data.session) throw new SessionMissingError()

  try {
    return await request(data.session.access_token)
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) {
      throw error
    }
  }

  // 대기 중 계정이 바뀌었으면 이전 동작을 새 계정으로 이어서 보내지 않는다.
  const { data: current, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) throw sessionError
  if (current.session?.user.id !== data.session.user.id) throw new SessionMissingError()

  const { data: refreshed, error: refreshError } =
    await supabase.auth.refreshSession()

  if (refreshError) throw refreshError
  if (refreshed.session?.user.id !== data.session.user.id) throw new SessionMissingError()

  return request(refreshed.session.access_token)
}

export async function getCurrentUser(): Promise<{ user_id: string } | null> {
  try {
    return await withAccessToken(getMe)
  } catch (error) {
    if (error instanceof SessionMissingError) return null
    throw error
  }
}

export async function signIn(
  email: string,
  password: string,
): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) throw error
}


// 탈퇴는 최근 비밀번호 인증을 요구하므로 같은 계정으로 다시 로그인한 새 토큰으로 바로 요청한다.
export async function deleteAccount(password: string): Promise<void> {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  const user = data.session?.user
  if (!user?.email) throw new SessionMissingError()

  const { data: signed, error: signInError } = await supabase.auth.signInWithPassword({ email: user.email, password })
  if (signInError) throw signInError
  if (signed.session?.user.id !== user.id) throw new SessionMissingError()

  await deleteMe(signed.session.access_token)
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut({
    scope: 'local',
  })

  if (error) throw error
}

export type AuthState = {
  user: { user_id: string } | null
  authUserId: string | null
  isChecking: boolean
  error: unknown
  // 세션은 남아 있는데 /me 확인이 실패했을 때 같은 계정으로 다시 확인한다.
  retry?: () => void
}

export function subscribeAuthState(
  onChange: (state: AuthState) => void,
): () => void {
  let active = true
  let requestNumber = 0
  let authUserId: string | null = null
  let isChecking = false
  let hasVerifiedUser = false
  let timer: ReturnType<typeof setTimeout> | undefined

  function startCheck(hasSession: boolean) {
    const checkedUserId = authUserId
    const currentRequest = ++requestNumber
    clearTimeout(timer)
    hasVerifiedUser = false
    isChecking = hasSession

    onChange({
      user: null,
      authUserId: checkedUserId,
      isChecking,
      error: null,
    })

    if (!hasSession) return

    // SDK 이벤트 콜백 밖에서 세션 갱신을 포함한 비동기 확인을 실행한다.
    timer = setTimeout(() => {
      void checkUser()

      async function checkUser() {
        try {
          const user = await getCurrentUser()

          if (!active || currentRequest !== requestNumber) return

          isChecking = false
          hasVerifiedUser = user !== null

          onChange({
            user,
            authUserId: user ? checkedUserId : null,
            isChecking: false,
            error: null,
          })
        } catch (error) {
          if (!active || currentRequest !== requestNumber) return

          isChecking = false
          onChange({
            user: null,
            authUserId: checkedUserId,
            isChecking: false,
            error,
            retry: () => {
              if (active && currentRequest === requestNumber) startCheck(true)
            },
          })
        }
      }
    }, 0)
  }

  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    if (!active) return

    const nextAuthUserId = session?.user.id ?? null

    // 같은 계정의 토큰 갱신·사용자 정보 변경은 확인 중이거나 확인된 화면을 유지한다.
    // 이전 확인이 실패한 상태라면 이 이벤트를 다시 확인할 기회로 쓴다.
    if (nextAuthUserId === authUserId && (isChecking || hasVerifiedUser)) return

    authUserId = nextAuthUserId
    startCheck(session !== null)
  })

  return () => {
    active = false
    requestNumber += 1
    clearTimeout(timer)
    data.subscription.unsubscribe()
  }
}

export async function signUp(
  email: string,
  password: string,
): Promise<{ hasSession: boolean }> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${window.location.origin}/`,
    },
  })

  if (error) throw error

  return { hasSession: data.session !== null }
}

export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password/update`,
  })
  if (error) throw error
}

export class RecoverySessionError extends Error {
  constructor() {
    super('재설정할 계정을 확인할 수 없습니다. 새 링크를 요청해주세요.')
    this.name = 'RecoverySessionError'
  }
}

export async function getPasswordResetUser() {
  // 잘못된 복귀 링크가 기존 로그인 세션을 재사용하지 않도록 먼저 검사한다.
  const { error: initializationError } = await supabase.auth.initialize()
  if (initializationError) throw initializationError

  const { data, error } = await supabase.auth.getUser()
  if (error) throw error
  if (!data.user) throw new RecoverySessionError()
  return data.user
}

export async function updatePassword(
  password: string,
  authUserId: string,
  signal: AbortSignal,
): Promise<void> {
  const user = await getPasswordResetUser()
  signal.throwIfAborted()
  if (user.id !== authUserId) throw new RecoverySessionError()

  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw error
}
