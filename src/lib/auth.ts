import { ApiError, getMe } from './api'
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

  const { data: refreshed, error: refreshError } =
    await supabase.auth.refreshSession()

  if (refreshError) throw refreshError
  if (!refreshed.session) throw new SessionMissingError()

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

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (!active) return

    const nextAuthUserId = session?.user.id ?? null
    const sameUser = nextAuthUserId === authUserId

    if (
      sameUser &&
      (event === 'TOKEN_REFRESHED' ||
        (event === 'SIGNED_IN' && (isChecking || hasVerifiedUser)))
    ) {
      return
    }

    authUserId = nextAuthUserId
    const currentRequest = ++requestNumber
    clearTimeout(timer)
    hasVerifiedUser = false
    isChecking = session !== null

    onChange({
      user: null,
      authUserId,
      isChecking,
      error: null,
    })

    if (!session) return

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
            authUserId: user ? nextAuthUserId : null,
            isChecking: false,
            error: null,
          })
        } catch (error) {
          if (!active || currentRequest !== requestNumber) return

          isChecking = false
          onChange({
            user: null,
            authUserId: nextAuthUserId,
            isChecking: false,
            error,
          })
        }
      }
    }, 0)
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
