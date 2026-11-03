import { useCallback, useEffect, useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import { isAuthError } from '@supabase/supabase-js'
import { getProfile, updateNickname } from './lib/api'
import { deleteAccount, isAccountDeleted, withAccessToken } from './lib/auth'
import { commonErrorMessage, isUnclearWrite, NICKNAME_RULE } from './lib/errors'
import CabinIcon from './CabinIcon'
import ConfirmDialog from './ConfirmDialog'

// BE와 같은 규칙: 앞뒤 공백을 지우고 NFC로 정규화한 뒤 완성형 한글·영문·숫자·_·-와 한 칸 공백, 2~20자.
const NICKNAME_PATTERN = /^[가-힣A-Za-z0-9_-]+( [가-힣A-Za-z0-9_-]+)*$/

function deleteErrorMessage(error: unknown) {
  if (isAuthError(error) && error.code === 'invalid_credentials') return '비밀번호가 맞지 않습니다.'
  if (isAuthError(error) && error.code === 'over_request_rate_limit') return '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.'
  // 같은 요청을 다시 보내도 BE가 이어서 처리하므로 사용자가 직접 다시 누를 수 있다. 자동으로 다시 보내지는 않는다.
  if (isUnclearWrite(error)) return '탈퇴 결과를 확인하지 못했습니다. 비밀번호를 입력하고 다시 시도하면 이어서 처리됩니다.'
  return commonErrorMessage(error, '탈퇴하지 못했습니다')
}

type Props = { onDeleted: () => Promise<void> }

export default function AccountSettings({ onDeleted }: Props) {
  // undefined: 아직 불러오지 않음, null: 닉네임 없음(독서가)
  const [saved, setSaved] = useState<string | null | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [nickname, setNickname] = useState('')
  const [nicknameBusy, setNicknameBusy] = useState(false)
  const [nicknameNote, setNicknameNote] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleted, setDeleted] = useState(false)
  const [deleteNote, setDeleteNote] = useState('')
  const passwordRef = useRef<HTMLInputElement>(null)
  const active = useRef(true)

  const load = useCallback(() => {
    withAccessToken(getProfile).then(
      (current) => {
        if (!active.current) return
        setSaved(current)
        setNickname(current ?? '')
      },
      (error: unknown) => {
        if (active.current) setLoadError(commonErrorMessage(error, '닉네임을 불러오지 못했습니다'))
      },
    )
  }, [])

  useEffect(() => {
    active.current = true
    load()
    return () => {
      active.current = false
    }
  }, [load])

  async function saveNickname(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (nicknameBusy || saved === undefined) return
    const trimmed = nickname.trim().normalize('NFC')
    const next = trimmed === '' ? null : trimmed
    const length = next === null ? 0 : [...next].length
    if (next !== null && (!NICKNAME_PATTERN.test(next) || length < 2 || length > 20)) {
      setNicknameNote(NICKNAME_RULE)
      return
    }
    if (next === saved) {
      setNicknameNote('바뀐 내용이 없습니다.')
      return
    }
    setNicknameBusy(true)
    setNicknameNote('저장하는 중…')
    try {
      const result = await withAccessToken((token) => updateNickname(token, next))
      if (!active.current) return
      setSaved(result)
      setNickname(result ?? '')
      setNicknameNote(result ? '닉네임을 저장했습니다.' : '닉네임을 지웠습니다. 공개 후기에는 독서가로 표시됩니다.')
    } catch (error) {
      if (!active.current) return
      // 입력은 그대로 두고, 저장됐는지 모르면 다시 보내지 않고 확인을 안내한다.
      setNicknameNote(isUnclearWrite(error)
        ? '저장 결과를 확인하지 못했습니다. 새로고침해 현재 닉네임을 확인해주세요.'
        : commonErrorMessage(error, '닉네임을 저장하지 못했습니다'))
    } finally {
      if (active.current) setNicknameBusy(false)
    }
  }

  function requestDelete(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (deleting || deleted) return
    if (!passwordRef.current?.value) {
      setDeleteNote('탈퇴하려면 비밀번호를 입력해주세요.')
      return
    }
    setConfirming(true)
  }

  async function submitDelete() {
    setConfirming(false)
    const password = passwordRef.current?.value ?? ''
    if (deleting || deleted || !password) return
    setDeleting(true)
    setDeleteNote('탈퇴 처리 중입니다. 서버 응답이 늦을 수 있습니다.')
    let done: boolean
    try {
      await deleteAccount(password)
      done = true
    } catch (error) {
      // 앞선 요청이 로그인 계정까지 지웠다면 재시도의 재로그인이 비밀번호 오류로 실패한다. 계정이 없어졌는지 먼저 확인한다.
      const maybeDeleted = isUnclearWrite(error) || (isAuthError(error) && error.code === 'invalid_credentials')
      done = maybeDeleted && await isAccountDeleted().catch(() => false)
      if (!done && active.current) {
        setDeleteNote(deleteErrorMessage(error))
        setDeleting(false)
      }
    }
    if (!done) return
    // 로그아웃이 늦거나 실패해도 탈퇴가 끝났다는 사실은 이 화면에 남기고 다시 보내지 않는다.
    if (active.current) {
      setDeleted(true)
      setDeleteNote('탈퇴가 완료되었습니다. 로그아웃하는 중입니다.')
    }
    await onDeleted()
  }

  return (
    <section className="settings" aria-labelledby="settings-title">
      <h1 id="settings-title">계정</h1>

      <form className="detail-card" aria-labelledby="nickname-title" onSubmit={saveNickname}>
        <h2 id="nickname-title">공개 후기 닉네임</h2>
        <p className="result-note">공개 후기에 표시되는 이름입니다. 비워 두면 독서가로 표시되고, 바꾸면 이미 공개한 후기에도 바로 반영됩니다.</p>
        {loadError ? (
          <div className="library-note" role="alert">
            <p>{loadError}</p>
            <button type="button" className="secondary" onClick={() => { setLoadError(null); load() }}>다시 시도</button>
          </div>
        ) : saved === undefined ? (
          <div className="cabin-loading">
            <CabinIcon className="cabin-icon" />
            <p>닉네임을 불러오는 중…</p>
          </div>
        ) : (
          <>
            <label htmlFor="nickname">닉네임</label>
            {/* 정규화 전 길이로 자르지 않도록 넉넉히 받고, 2~20자 검사는 정규화한 뒤에 한다 */}
            <input
              id="nickname"
              name="nickname"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              maxLength={100}
              autoComplete="nickname"
              spellCheck={false}
              placeholder="독서가"
              disabled={nicknameBusy}
            />
            <button type="submit" disabled={nicknameBusy}>{nicknameBusy ? '저장하는 중…' : '닉네임 저장'}</button>
          </>
        )}
        <p role="status">{nicknameNote}</p>
      </form>

      <form className="detail-card danger" aria-labelledby="delete-title" onSubmit={requestDelete}>
        <h2 id="delete-title">계정 탈퇴</h2>
        <p className="result-note">서재·메모·별점·날짜·독서 체크·공개 후기·알림 설정이 모두 바로 삭제되며 되돌릴 수 없습니다. 공통 책 정보는 남습니다.</p>
        <label htmlFor="delete-password">비밀번호 확인</label>
        <input id="delete-password" ref={passwordRef} type="password" autoComplete="current-password" disabled={deleting || deleted} />
        <button type="submit" className="secondary" disabled={deleting || deleted}>{deleting && !deleted ? '탈퇴하는 중…' : '탈퇴하기'}</button>
        <p role="status">{deleteNote}</p>
      </form>

      <ConfirmDialog
        open={confirming}
        title="정말 탈퇴할까요?"
        message="모든 독서 기록과 공개 후기가 삭제되며 되돌릴 수 없습니다."
        confirmLabel="탈퇴하기"
        danger
        onConfirm={() => void submitDelete()}
        onCancel={() => setConfirming(false)}
      />
    </section>
  )
}
