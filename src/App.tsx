import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import { isAuthError } from '@supabase/supabase-js'
import { Link, Navigate, NavLink, Route, Routes } from 'react-router'
import { signIn, signOut, signUp, subscribeAuthState } from './lib/auth'
import { commonErrorMessage, isAuthFailure } from './lib/errors'
import { releaseReminder, syncReminder } from './lib/push'
import { clearTimer } from './lib/timer'
import CabinIcon from './CabinIcon'
import Library from './Library'

// 첫 화면(로그인·서재)에 필요 없는 화면은 들어갈 때 받아 모바일 첫 로딩을 줄인다.
const BookDetail = lazy(() => import('./BookDetail'))
const BookSearch = lazy(() => import('./BookSearch'))
const BookCatalog = lazy(() => import('./BookCatalog'))
const PasswordReset = lazy(() => import('./PasswordReset'))
const ReadingRecords = lazy(() => import('./ReadingRecords'))
const AccountSettings = lazy(() => import('./AccountSettings'))
const TimerPage = lazy(() => import('./TimerPage'))

function PageLoading() {
  return (
    <div className="cabin-loading">
      <CabinIcon className="cabin-icon" />
      <p>화면을 여는 중…</p>
    </div>
  )
}

function App() {
  return (
    <Suspense fallback={<main><PageLoading /></main>}>
      <Routes>
        <Route path="/reset-password" element={<PasswordReset key="request" />} />
        <Route
          path="/reset-password/update"
          element={<PasswordReset key="update" recovery />}
        />
        {/* 그 밖의 경로는 인증 화면이 받고, /me 확인 뒤에만 개인 화면 경로를 연다 */}
        <Route path="*" element={<AuthScreen />} />
      </Routes>
    </Suspense>
  )
}

function AuthScreen() {
  const [message, setMessage] = useState('로그인 상태를 확인하고 있습니다.')
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  // 세션은 있는데 서버 확인이 연결 문제로 실패하면 로그인 폼 대신 다시 시도를 보여 준다.
  const [retryCheck, setRetryCheck] = useState<(() => void) | null>(null)

  const formRef = useRef<HTMLFormElement>(null)
  const authUserId = useRef<string | null>(null)
  const actionVersion = useRef(0)
  const pendingAction = useRef<'login' | 'signup' | 'logout' | null>(null)

  useEffect(() => {
    const unsubscribe = subscribeAuthState((state) => {
      const identityChanged = authUserId.current !== state.authUserId
      const signedOut =
        state.authUserId === null && !state.isChecking && state.error === null

      if (identityChanged || state.isChecking || signedOut) {
        if (identityChanged && authUserId.current !== null) {
          clearTimer(authUserId.current)
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

      if (state.authUserId !== null || signedOut) {
        setAuthMode('login')
      }

      setUserId(state.user?.user_id ?? null)
      setIsCheckingSession(state.isChecking)
      setRetryCheck(() =>
        state.error !== null && state.retry && !isAuthFailure(state.error)
          ? state.retry
          : null,
      )

      if (state.isChecking) {
        setMessage('사용자 확인 중입니다. 서버 응답이 늦을 수 있습니다.')
      } else if (state.error !== null) {
        // Render 기동 지연·연결 실패는 로그아웃으로 처리하지 않는다.
        setMessage(commonErrorMessage(state.error, '사용자 확인에 실패했습니다'))
      } else if (state.user) {
        setMessage('')
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

  // 확인된 계정으로 열 때 알림 구독을 서버와 맞춘다. 실패해도 화면을 막지 않고 다음 시작 때 다시 맞춘다.
  useEffect(() => {
    if (userId === null) return
    let active = true
    void syncReminder(() => active).catch(() => undefined)
    return () => {
      active = false
    }
  }, [userId])

  async function handleAuthSubmit(event: SubmitEvent<HTMLFormElement>) {
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

    if (
      authMode === 'signup' &&
      formData.get('passwordConfirm') !== password
    ) {
      setMessage('비밀번호와 비밀번호 확인이 일치하지 않습니다.')
      return
    }

    const currentAction = ++actionVersion.current
    pendingAction.current = authMode
    setIsSubmitting(true)
    setMessage(
      authMode === 'signup' ? '회원가입 요청 중입니다.' : '로그인 중입니다.',
    )

    try {
      if (authMode === 'signup') {
        const result = await signUp(email.trim(), password)

        if (currentAction !== actionVersion.current) return

        if (!result.hasSession) {
          formRef.current?.reset()
          setAuthMode('login')
          setMessage(
            '회원가입 요청을 처리했습니다. 이메일과 스팸함에서 인증 메일을 확인해주세요. 이미 가입한 계정이라면 로그인해주세요.',
          )
        }
      } else {
        await signIn(email.trim(), password)
      }
    } catch (error) {
      if (currentAction !== actionVersion.current) return

      if (isAuthError(error) && error.code === 'invalid_credentials') {
        setMessage('이메일 또는 비밀번호를 확인해주세요.')
      } else if (isAuthError(error) && error.code === 'email_not_confirmed') {
        setMessage('인증 메일을 확인한 뒤 다시 로그인해주세요.')
      } else if (isAuthError(error) && error.code === 'weak_password') {
        setMessage('비밀번호의 길이와 문자 조합을 확인해주세요.')
      } else if (
        isAuthError(error) &&
        (error.code === 'over_email_send_rate_limit' ||
          error.code === 'over_request_rate_limit')
      ) {
        setMessage('요청이 너무 많습니다. 잠시 후 다시 시도해주세요.')
      } else if (isAuthError(error) && error.code === 'signup_disabled') {
        setMessage('현재 회원가입이 허용되지 않습니다.')
      } else if (
        isAuthError(error) &&
        error.code === 'email_address_not_authorized'
      ) {
        setMessage('현재 인증 메일을 보낼 수 없습니다. 잠시 후 다시 시도해주세요.')
      } else {
        setMessage('요청에 실패했습니다. 잠시 후 다시 시도해주세요.')
      }
    } finally {
      if (currentAction === actionVersion.current) {
        pendingAction.current = null
        setIsSubmitting(false)
      }
    }
  }

  function handleAuthModeChange() {
    if (isCheckingSession || pendingAction.current !== null) return

    formRef.current?.reset()
    const nextMode = authMode === 'login' ? 'signup' : 'login'
    setAuthMode(nextMode)
    setMessage(
      nextMode === 'signup'
        ? '가입할 이메일과 비밀번호를 입력해주세요.'
        : '이메일과 비밀번호로 로그인해주세요.',
    )
  }

  // 탈퇴 완료 뒤에도 같은 정리(알림 해제·로그아웃)를 하고 안내만 바꾼다.
  async function handleLogout(doneMessage = '로그아웃되었습니다. 다시 로그인해주세요.') {
    if (isCheckingSession || pendingAction.current !== null) return

    const currentAction = ++actionVersion.current
    pendingAction.current = 'logout'
    setIsSubmitting(true)
    setMessage('로그아웃 중입니다.')

    try {
      // 다음에 로그인하는 계정이 이 기기의 알림을 이어받지 않게 먼저 끊는다.
      await releaseReminder()
      await signOut()

      if (currentAction === actionVersion.current) {
        setMessage(doneMessage)
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

  if (userId !== null) {
    return (
      <main className="app">
        <a href="#content" className="skip-link">본문으로 바로가기</a>
        <header className="app-header">
          <Link to="/" className="wordmark" translate="no">
            <CabinIcon className="wordmark-icon" />
            BookStory
          </Link>
          <nav className="app-nav" aria-label="주요 메뉴">
            <NavLink to="/" end>서재</NavLink>
            <NavLink to="/search">책 찾기</NavLink>
            <NavLink to="/timer">타이머</NavLink>
            <NavLink to="/records">기록</NavLink>
            <NavLink to="/settings">계정</NavLink>
          </nav>
          <button
            type="button"
            className="secondary compact"
            onClick={() => void handleLogout()}
            disabled={isSubmitting}
          >
            {isSubmitting ? '처리 중…' : '로그아웃'}
          </button>
        </header>
        <p role="status">{message}</p>
        {/* 계정이 바뀌면 개인 화면을 새로 마운트해 이전 계정의 목록·늦은 응답을 버린다 */}
        <div id="content" tabIndex={-1}>
          <Suspense fallback={<PageLoading />}>
            <Routes key={userId}>
              <Route index element={<Library />} />
              <Route path="search" element={<BookSearch />} />
              <Route path="catalog/:isbn13" element={<BookCatalog />} />
              <Route path="books/:userBookId" element={<BookDetail userId={userId} />} />
              <Route path="records" element={<ReadingRecords />} />
              <Route path="timer" element={<TimerPage userId={userId} />} />
              <Route path="settings" element={<AccountSettings onDeleted={() => {
                clearTimer(userId)
                return handleLogout('탈퇴가 완료되었습니다. 이용해 주셔서 감사합니다.')
              }} />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </div>
      </main>
    )
  }

  if (retryCheck) {
    return (
      <main>
        <h1 translate="no">BookStory</h1>
        <p className="tagline">읽은 날을 한 권씩 꽂아 두는 서재</p>
        <p role="status">{message}</p>
        <div className="retry-actions">
          <button type="button" onClick={retryCheck}>다시 시도</button>
          <button type="button" className="secondary" onClick={() => void handleLogout()} disabled={isSubmitting}>
            {isSubmitting ? '처리 중…' : '로그아웃'}
          </button>
        </div>
      </main>
    )
  }

  return (
    <main>
      <h1 translate="no">BookStory</h1>
      <p className="tagline">읽은 날을 한 권씩 꽂아 두는 서재</p>
      <p role="status">{message}</p>

      <form
        ref={formRef}
        aria-label={authMode === 'signup' ? '회원가입' : '로그인'}
        onSubmit={handleAuthSubmit}
      >
        <h2>{authMode === 'signup' ? '회원가입' : '로그인'}</h2>

        <div>
          <label htmlFor="email">이메일</label>
          <input
            id="email"
            name="email"
            type="email"
            spellCheck={false}
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
            autoComplete={
              authMode === 'signup' ? 'new-password' : 'current-password'
            }
            disabled={isCheckingSession || isSubmitting}
            required
          />
        </div>

        {authMode === 'signup' && (
          <div>
            <label htmlFor="password-confirm">비밀번호 확인</label>
            <input
              id="password-confirm"
              name="passwordConfirm"
              type="password"
              autoComplete="new-password"
              disabled={isCheckingSession || isSubmitting}
              required
            />
          </div>
        )}

        <button
          type="submit"
          disabled={isCheckingSession || isSubmitting}
        >
          {isSubmitting
            ? '처리 중…'
            : authMode === 'signup'
              ? '회원가입'
              : '로그인'}
        </button>

        <button
          type="button"
          className="secondary"
          onClick={handleAuthModeChange}
          disabled={isCheckingSession || isSubmitting}
        >
          {authMode === 'signup' ? '로그인으로 돌아가기' : '회원가입하기'}
        </button>
        <p><a href="/reset-password">비밀번호를 잊으셨나요?</a></p>
      </form>
    </main>
  )
}

export default App
