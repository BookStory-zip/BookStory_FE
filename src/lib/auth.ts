import { ApiError, getMe } from './api'
import { supabase } from './supabase'

export async function getCurrentUser(): Promise<{ user_id: string } | null> {
  const { data, error } = await supabase.auth.getSession()

  if (error) throw error
  if (!data.session) return null

  try {
    return await getMe(data.session.access_token)
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) {
      throw error
    }
  }

  const { data: refreshed, error: refreshError } =
    await supabase.auth.refreshSession()

  if (refreshError) throw refreshError
  if (!refreshed.session) return null

  return getMe(refreshed.session.access_token)
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
