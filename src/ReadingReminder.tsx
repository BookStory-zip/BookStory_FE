import { useEffect, useRef, useState } from 'react'
import { ApiError } from './lib/api'
import { commonErrorMessage } from './lib/errors'
import { disableReminder, enableReminder, getReminderState } from './lib/push'
import type { ReminderState } from './lib/push'

const STATE_NOTES: Record<ReminderState, string> = {
  unsupported: '이 브라우저에서는 독서 알림을 켤 수 없어요. iPhone은 iOS 16.4 이상에서 BookStory를 홈 화면에 추가한 뒤 켤 수 있어요.',
  denied: '브라우저에서 알림이 차단되어 있어요. 브라우저 설정에서 이 사이트의 알림을 허용해주세요.',
  on: '매일 밤 9시, 오늘 체크하지 않은 읽는 중인 책이 있으면 알려드려요.',
  off: '매일 밤 9시, 오늘 체크하지 않은 읽는 중인 책이 있으면 알려드릴 수 있어요.',
}

function reminderErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 503) return '지금은 알림을 사용할 수 없어요. 잠시 후 다시 시도해주세요.'
  // 구독 실패(푸시 서비스 오류는 AbortError)·키 해석 실패. 요청 시간 초과(TimeoutError)만 공통 안내를 쓴다.
  if (error instanceof DOMException && error.name !== 'TimeoutError') return '알림을 등록하지 못했어요. 잠시 후 다시 시도해주세요.'
  return commonErrorMessage(error, '알림 설정을 바꾸지 못했습니다')
}

export default function ReadingReminder() {
  const [state, setState] = useState<ReminderState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    getReminderState().then(
      (next) => mounted.current && setState(next),
      () => mounted.current && setState('off'),
    )
    return () => {
      mounted.current = false
    }
  }, [])

  async function toggle() {
    if (busy || (state !== 'on' && state !== 'off')) return
    setBusy(true)
    setError(null)
    try {
      if (state === 'on') {
        await disableReminder()
        if (mounted.current) setState('off')
      } else {
        const next = await enableReminder()
        if (mounted.current) setState(next)
      }
    } catch (toggleError) {
      if (mounted.current) setError(reminderErrorMessage(toggleError))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  if (state === null) return null

  return (
    <div className="records-reminder">
      <p className="result-note">{STATE_NOTES[state]}</p>
      {(state === 'on' || state === 'off') && (
        <button type="button" className="secondary compact" aria-pressed={state === 'on'} disabled={busy} onClick={toggle}>
          {busy ? '처리 중…' : state === 'on' ? '알림 끄기' : '알림 켜기'}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
