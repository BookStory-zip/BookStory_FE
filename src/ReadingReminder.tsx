import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from './lib/api'
import { commonErrorMessage } from './lib/errors'
import { enableReminder, getReminderState, setReminderEnabled } from './lib/push'
import type { DeviceReminderState, ReminderState } from './lib/push'

const DEVICE_NOTES: Record<DeviceReminderState, string> = {
  unsupported: '이 브라우저에서는 알림을 받을 수 없어요. iPhone은 iOS 16.4 이상에서 BookStory를 홈 화면에 추가한 뒤 사용할 수 있어요.',
  denied: '이 기기의 알림이 차단되어 있어요. 브라우저 설정에서 이 사이트의 알림을 허용해주세요.',
  permission: '이 기기에서 알림을 받으려면 알림 권한을 허용해주세요.',
  on: '이 기기에서 알림을 받을 수 있어요.',
  off: '이 기기가 아직 연결되지 않았어요. 연결하면 이 기기에서도 알림을 받을 수 있어요.',
}

function reminderErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 503) return '지금은 알림을 사용할 수 없어요. 잠시 후 다시 시도해주세요.'
  if (error instanceof DOMException && error.name !== 'TimeoutError') return '알림을 등록하지 못했어요. 잠시 후 다시 시도해주세요.'
  return commonErrorMessage(error, '알림 설정을 확인하지 못했습니다')
}

export default function ReadingReminder({ disabled = false }: { disabled?: boolean }) {
  const [state, setState] = useState<ReminderState | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const working = useRef(false)
  const version = useRef(0)

  const load = useCallback(() => {
    if (working.current) return
    const current = ++version.current
    return getReminderState().then((next) => {
      if (mounted.current && current === version.current) {
        setState(next)
        setError(null)
      }
    }, (error: unknown) => {
      if (mounted.current && current === version.current) {
        setState(null)
        setError(reminderErrorMessage(error))
      }
    }).finally(() => {
      if (mounted.current && current === version.current) setBusy(false)
    })
  }, [])

  useEffect(() => {
    mounted.current = true
    void load()
    const refresh = () => { if (document.visibilityState === 'visible') void load() }
    window.addEventListener('focus', refresh)
    window.addEventListener('reminder-sync', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      mounted.current = false
      version.current += 1
      window.removeEventListener('focus', refresh)
      window.removeEventListener('reminder-sync', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [load])

  async function change(connectDevice: boolean) {
    if (working.current || disabled || state === null || busy) return
    working.current = true
    version.current += 1
    setBusy(true)
    setError(null)
    const isActive = () => mounted.current
    try {
      const next = await (connectDevice ? enableReminder(isActive) : setReminderEnabled(!state.enabled, isActive))
      if (mounted.current) setState(next)
    } catch (error) {
      // 설정 저장 후 기기 등록만 실패했거나 응답을 잃었을 수 있으므로 재전송하지 않고 확인한다.
      if (!mounted.current) return
      try {
        const next = await getReminderState()
        if (mounted.current) {
          setState(next)
          setError(`${reminderErrorMessage(error)} 현재 설정을 다시 확인했습니다.`)
        }
      } catch {
        if (mounted.current) {
          setState(null)
          setError('알림 설정을 확인하지 못했습니다. 다시 확인한 뒤 변경해주세요.')
        }
      }
    } finally {
      working.current = false
      if (mounted.current) setBusy(false)
    }
  }

  return (
    <section id="reminder-settings" className="detail-card" aria-labelledby="reminder-title" aria-busy={busy}>
      <h2 id="reminder-title">독서 알림</h2>
      <p className="result-note">매일 밤 9시, 오늘 체크하지 않은 읽는 중인 책이 있으면 알려드려요. 이 계정의 모든 기기에 함께 적용돼요.</p>
      {state ? (
        <>
          <p role="status">계정 알림 {state.enabled ? '켜짐' : '꺼짐'}{!state.enabled && ' · 모든 기기에 알림을 보내지 않아요.'}</p>
          <button type="button" className="secondary compact" aria-pressed={state.enabled} disabled={busy || disabled} onClick={() => void change(false)}>
            {state.enabled ? '알림 끄기' : '알림 켜기'}
          </button>
          <p className="result-note">{!state.enabled && state.device === 'on'
            ? '이 기기의 연결은 유지돼요. 계정 알림을 켜면 받을 수 있어요.'
            : DEVICE_NOTES[state.device]}</p>
          {state.enabled && (state.device === 'permission' || state.device === 'off') && (
            <button type="button" className="secondary compact" disabled={busy || disabled} onClick={() => void change(true)}>
              {state.device === 'permission' ? '이 기기 알림 허용' : '이 기기 연결'}
            </button>
          )}
        </>
      ) : busy ? <p role="status">알림 설정을 불러오는 중…</p> : (
        <button type="button" className="secondary compact" disabled={disabled} onClick={() => { setBusy(true); setError(null); void load() }}>다시 확인</button>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
