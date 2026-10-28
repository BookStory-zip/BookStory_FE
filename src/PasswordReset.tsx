import { useEffect, useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import { isAuthError } from '@supabase/supabase-js'
import type { User } from '@supabase/supabase-js'
import {
  getPasswordResetUser, RecoverySessionError, requestPasswordReset,
  signOut, updatePassword,
} from './lib/auth'
import { supabase } from './lib/supabase'

type Phase = 'request' | 'checking' | 'update' | 'saved' | 'invalid' | 'error'

function isInvalidSession(error: unknown) {
  return error instanceof RecoverySessionError || (isAuthError(error) && (
    error.status === 401 || error.status === 403 ||
    error.name === 'AuthSessionMissingError' ||
    error.name === 'AuthImplicitGrantRedirectError' ||
    error.code === 'session_not_found' || error.code === 'reauthentication_needed'
  ))
}

function failureMessage(error: unknown, saving: boolean) {
  if (isAuthError(error)) {
    if (error.code === 'weak_password') return '비밀번호의 길이와 문자 조합을 확인해주세요.'
    if (error.code === 'same_password') return '기존 비밀번호와 다른 비밀번호를 입력해주세요.'
    if (error.status === 429) return '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.'
    if (saving && error.name === 'AuthRetryableFetchError') {
      return '변경 결과를 확인하지 못했습니다. 로그인 화면에서 새 비밀번호로 확인해주세요.'
    }
  }
  return saving
    ? '비밀번호 저장에 실패했습니다. 입력을 확인하고 다시 시도해주세요.'
    : '메일 요청에 실패했습니다. 잠시 후 다시 시도해주세요.'
}

export default function PasswordReset({ recovery = false }: { recovery?: boolean }) {
  const [phase, setPhase] = useState<Phase>(recovery ? 'checking' : 'request')
  const [user, setUser] = useState<User | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(recovery
    ? '재설정 링크를 확인하고 있습니다.' : '가입한 이메일을 입력해주세요.')
  const formRef = useRef<HTMLFormElement>(null)
  const actionVersion = useRef(0)
  const pendingAction = useRef<'email' | 'save' | 'logout' | null>(null)
  const saveController = useRef<AbortController | null>(null)

  useEffect(() => {
    let active = true
    const version = actionVersion.current
    let observedUserId: string | null | undefined

    function invalidate() {
      saveController.current?.abort()
      actionVersion.current += 1
      pendingAction.current = null
      formRef.current?.reset()
      setBusy(false)
      setUser(null)
      setPhase('invalid')
      setMessage('로그인 계정이 변경되었거나 로그아웃되었습니다. 새 재설정 링크를 요청해주세요.')
    }

    const subscription = recovery
      ? supabase.auth.onAuthStateChange((_event, session) => {
        if (!active) return
        const nextId = session?.user.id ?? null
        if (observedUserId !== undefined && nextId !== observedUserId) {
          if (!(pendingAction.current === 'logout' && nextId === null)) invalidate()
        }
        observedUserId = nextId
      }).data.subscription
      : null

    async function checkUser() {
      try {
        const verifiedUser = await getPasswordResetUser()
        if (!active || version !== actionVersion.current) return
        if (observedUserId !== undefined && observedUserId !== verifiedUser.id) {
          invalidate()
          return
        }
        observedUserId = verifiedUser.id
        setUser(verifiedUser)
        setPhase('update')
        setMessage('새 비밀번호를 입력해주세요.')
      } catch (error) {
        if (!active || version !== actionVersion.current) return
        const invalid = isInvalidSession(error)
        setPhase(invalid ? 'invalid' : 'error')
        setMessage(invalid
          ? '재설정 링크가 만료되었거나 유효하지 않습니다. 새 링크를 요청해주세요.'
          : '사용자 확인에 실패했습니다. 잠시 후 다시 확인해주세요.')
      }
    }

    if (recovery) void checkUser()
    return () => {
      active = false
      saveController.current?.abort()
      actionVersion.current += 1
      pendingAction.current = null
      subscription?.unsubscribe()
    }
  }, [recovery])

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pendingAction.current || (phase !== 'request' && phase !== 'update')) return
    const data = new FormData(event.currentTarget)
    const email = data.get('email')
    const password = data.get('password')
    const saving = phase === 'update'

    if (!saving && (typeof email !== 'string' || !email.trim())) {
      setMessage('이메일을 입력해주세요.')
      return
    }
    if (saving && (typeof password !== 'string' || !password)) {
      setMessage('새 비밀번호를 입력해주세요.')
      return
    }
    if (saving && password !== data.get('passwordConfirm')) {
      setMessage('비밀번호와 비밀번호 확인이 일치하지 않습니다.')
      return
    }
    if (saving && !user) return

    const currentAction = ++actionVersion.current
    pendingAction.current = saving ? 'save' : 'email'
    setBusy(true)
    setMessage(saving ? '비밀번호를 변경하고 있습니다.' : '메일을 요청하고 있습니다.')
    try {
      if (saving && typeof password === 'string' && user) {
        saveController.current = new AbortController()
        await updatePassword(password, user.id, saveController.current.signal)
        if (currentAction !== actionVersion.current) return
        formRef.current?.reset()
        setPhase('saved')
        setMessage('비밀번호가 변경되었습니다. 로그아웃 후 새 비밀번호로 로그인해주세요.')
      } else if (typeof email === 'string') {
        await requestPasswordReset(email.trim())
        if (currentAction !== actionVersion.current) return
        setMessage('가입된 주소라면 재설정 안내 메일을 확인할 수 있습니다. 받은편지함과 스팸함을 확인해주세요.')
      }
    } catch (error) {
      if (currentAction !== actionVersion.current) return
      if (saving && isInvalidSession(error)) {
        setPhase('invalid')
        setMessage('재설정 세션이 만료되었거나 계정이 변경되었습니다. 새 링크를 요청해주세요.')
      } else {
        setMessage(failureMessage(error, saving))
      }
    } finally {
      if (currentAction === actionVersion.current) {
        pendingAction.current = null
        setBusy(false)
      }
    }
  }

  // 재설정 링크의 세션은 비밀번호를 바꾸지 않고 서재로 들어가는 데 쓰이지 않게 로그아웃한 뒤 이동한다.
  async function handleLogin(failure = '비밀번호는 변경되었지만 로그아웃에 실패했습니다. 다시 시도해주세요.') {
    if (pendingAction.current) return
    const currentAction = ++actionVersion.current
    pendingAction.current = 'logout'
    setBusy(true)
    try {
      await signOut()
      if (currentAction === actionVersion.current) window.location.assign('/')
    } catch {
      if (currentAction === actionVersion.current) {
        setMessage(failure)
      }
    } finally {
      if (currentAction === actionVersion.current) {
        pendingAction.current = null
        setBusy(false)
      }
    }
  }

  return (
    <main>
      <h1>{recovery ? '새 비밀번호 설정' : '비밀번호 재설정'}</h1>
      <p role="status">{message}</p>
      {phase === 'request' && (
        <form ref={formRef} aria-label="재설정 메일 요청" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="reset-email">이메일</label>
            <input id="reset-email" name="email" type="email" autoComplete="username" disabled={busy} required />
          </div>
          <button type="submit" disabled={busy}>{busy ? '요청 중…' : '재설정 메일 보내기'}</button>
        </form>
      )}
      {phase === 'update' && (
        <form ref={formRef} aria-label="새 비밀번호" onSubmit={handleSubmit}>
          <p>변경할 계정: {user?.email ?? '확인된 계정'}</p>
          <div>
            <label htmlFor="new-password">새 비밀번호</label>
            <input id="new-password" name="password" type="password" autoComplete="new-password" disabled={busy} required />
          </div>
          <div>
            <label htmlFor="new-password-confirm">새 비밀번호 확인</label>
            <input id="new-password-confirm" name="passwordConfirm" type="password" autoComplete="new-password" disabled={busy} required />
          </div>
          <button type="submit" disabled={busy}>{busy ? '저장 중…' : '비밀번호 변경'}</button>
        </form>
      )}
      {phase === 'saved' && (
        <button type="button" onClick={() => void handleLogin()} disabled={busy}>로그아웃 후 로그인하기</button>
      )}
      {(phase === 'invalid' || phase === 'error') && (
        <p><a href="/reset-password">새 재설정 메일 요청</a></p>
      )}
      {phase === 'error' && (
        <button type="button" className="secondary" onClick={() => window.location.reload()}>다시 확인</button>
      )}
      {phase !== 'saved' && !recovery && <p><a href="/">로그인 화면으로</a></p>}
      {phase !== 'saved' && recovery && (
        <p>
          <button
            type="button"
            className="link-button"
            onClick={() => void handleLogin('로그아웃에 실패했습니다. 다시 시도해주세요.')}
            disabled={busy}
          >
            변경을 그만두고 로그인 화면으로
          </button>
        </p>
      )}
    </main>
  )
}
