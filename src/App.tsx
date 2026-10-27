import { useEffect, useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import { isAuthError } from '@supabase/supabase-js'
import { ApiError } from './lib/api'
import { signIn, signOut, subscribeAuthState } from './lib/auth'

function App() {
  const [message, setMessage] = useState('로그인 상태를 확인하고 있습니다.')
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  const formRef = useRef<HTMLFormElement>(null)
  const authUserId = useRef<string | null>(null)
  const actionVersion = useRef(0)
  const pendingAction = useRef<'login' | 'logout' | null>(null)

  useEffect(() => {
    const unsubscribe = subscribeAuthState((state) => {
      const identityChanged = authUserId.current !== state.authUserId
      const signedOut =
        state.authUserId === null && !state.isChecking && state.error === null

      if (identityChanged || state.isChecking || signedOut) {
        if (identityChanged && authUserId.current !== null) {
          formRef.current?.reset()
        }

        authUserId.current = state.authUserId

        const finishingLogout =
          pendingAction.current === 'logout' && state.authUserId === null

        if (!finishingLogout) {
          actionVersion.current += 1
          pendingAction.current = null
          setIsSubmitting(false)
        }
      }

      setIsAuthenticated(state.user !== null)
      setIsCheckingSession(state.isChecking)

      if (state.isChecking) {
        setMessage('사용자 확인 중입니다. 서버 응답이 늦을 수 있습니다.')
      } else if (state.error !== null) {
        if (state.error instanceof ApiError && state.error.status === 401) {
          setMessage('로그인 정보를 확인할 수 없습니다. 다시 로그인해주세요.')
        } else {
          setMessage('사용자 확인에 실패했습니다. 잠시 후 다시 시도해주세요.')
        }
      } else if (state.user) {
        setMessage('사용자 확인이 완료되었습니다.')
      } else if (pendingAction.current === 'logout') {
        setMessage('로그아웃 중입니다.')
      } else {
        setMessage('로그인이 필요합니다.')
      }
    })

    return () => {
      actionVersion.current += 1
      pendingAction.current = null
      unsubscribe()
    }
  }, [])

  async function handleLogin(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()

    if (isCheckingSession || pendingAction.current !== null) return

    const formData = new FormData(event.currentTarget)
    const email = formData.get('email')
    const password = formData.get('password')

    if (
      typeof email !== 'string' ||
      !email.trim() ||
      typeof password !== 'string' ||
      !password
    ) {
      setMessage('이메일과 비밀번호를 입력해주세요.')
      return
    }

    const currentAction = ++actionVersion.current
    pendingAction.current = 'login'
    setIsSubmitting(true)
    setMessage('로그인 중입니다.')

    try {
      await signIn(email.trim(), password)
    } catch (error) {
      if (currentAction !== actionVersion.current) return

      if (isAuthError(error) && error.code === 'invalid_credentials') {
        setMessage('이메일 또는 비밀번호를 확인해주세요.')
      } else if (isAuthError(error) && error.code === 'email_not_confirmed') {
        setMessage('인증 메일을 확인한 뒤 다시 로그인해주세요.')
      } else {
        setMessage('로그인 요청에 실패했습니다. 잠시 후 다시 시도해주세요.')
      }
    } finally {
      if (currentAction === actionVersion.current) {
        pendingAction.current = null
        setIsSubmitting(false)
      }
    }
  }

  async function handleLogout() {
    if (isCheckingSession || pendingAction.current !== null) return

    const currentAction = ++actionVersion.current
    pendingAction.current = 'logout'
    setIsSubmitting(true)
    setMessage('로그아웃 중입니다.')

    try {
      await signOut()

      if (currentAction === actionVersion.current) {
        setMessage('로그아웃되었습니다. 다시 로그인해주세요.')
      }
    } catch {
      if (currentAction === actionVersion.current) {
        setMessage(
          '로그아웃 요청에 실패했습니다. 로그인 상태를 다시 확인해주세요.',
        )
      }
    } finally {
      if (currentAction === actionVersion.current) {
        pendingAction.current = null
        setIsSubmitting(false)
      }
    }
  }

  return (
    <main>
      <h1>BookStory</h1>
      <p role="status">{message}</p>

      {isAuthenticated ? (
        <button
          type="button"
          onClick={handleLogout}
          disabled={isSubmitting}
        >
          {isSubmitting ? '처리 중…' : '로그아웃'}
        </button>
      ) : (
        <form ref={formRef} aria-label="로그인" onSubmit={handleLogin}>
          <div>
            <label htmlFor="email">이메일</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              disabled={isCheckingSession || isSubmitting}
              required
            />
          </div>

          <div>
            <label htmlFor="password">비밀번호</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              disabled={isCheckingSession || isSubmitting}
              required
            />
          </div>

          <button
            type="submit"
            disabled={isCheckingSession || isSubmitting}
          >
            {isSubmitting ? '처리 중…' : '로그인'}
          </button>
        </form>
      )}
    </main>
  )
}

export default App
