import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ApiError, saveReadingSession } from './lib/api'
import type { ReadingStatus } from './lib/api'
import { withAccessToken } from './lib/auth'
import { commonErrorMessage, isUnclearWrite } from './lib/errors'
import { clearTimer, finishTimer, getTimerSeconds, pauseTimer, readTimer, resumeTimer, settleTimer, startTimer, subscribeTimer, TIMER_MIN_SECONDS, timerPayload, writeTimer } from './lib/timer'
import type { TimerDraft } from './lib/timer'
import ConfirmDialog from './ConfirmDialog'

type Props = {
  userId: string
  userBookId: string
  status: ReadingStatus
  blocked: boolean
  onSaved: () => Promise<ReadingStatus | null>
  onBusyChange: (busy: boolean) => void
}
const STORAGE_ERROR = '이 기기에 타이머를 보관하지 못했습니다. 브라우저 저장소 설정을 확인한 뒤 새로고침해주세요.'
const clock = (seconds: number) => [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':')

function initialTimer(userId: string): { draft: TimerDraft | null; error: string } {
  try {
    const draft = readTimer(userId)
    return { draft: draft ? settleTimer(draft, Date.now()) : null, error: '' }
  } catch { return { draft: null, error: STORAGE_ERROR } }
}

function saveError(error: unknown): string {
  if (isUnclearWrite(error)) return '저장 결과를 확인하지 못했습니다. 측정 값은 보관했어요. 다시 저장하면 같은 기록으로 확인합니다.'
  if (error instanceof ApiError) {
    if (error.code === 'session_overlap') return '이미 기록된 시간과 겹칩니다. 다른 탭이나 기기의 시간 기록을 확인해주세요. 측정 값은 보관했어요.'
    if (error.code === 'reading_check_not_allowed') return '읽는 중인 책만 시간 기록을 저장할 수 있어요. 책 상태를 확인해주세요.'
    if (error.code === 'date_order') return '독서 시작일보다 이전에 시작한 시간 기록은 저장할 수 없어요.'
    if (error.code === 'invalid_duration') return '측정 시간이 실제 경과 시간보다 깁니다. 기기 시계를 확인해주세요.'
    if (error.code === 'future_date') return '측정 시작 시각이 서버 시각보다 앞섭니다. 기기 시계를 확인해주세요. 측정 값은 보관했어요.'
    if (error.code === 'date_too_old') return '시간 기록은 오늘을 포함한 최근 7일 안에 시작한 것만 저장할 수 있어요. 측정 값은 보관했어요.'
    if (error.code === 'session_conflict') return '같은 기록 번호로 다른 내용이 이미 저장돼 있어요. 측정 값을 보관했으니 시간 기록을 확인해주세요.'
    if (error.status === 404) return '서재에서 이 책을 찾을 수 없습니다. 측정 값은 보관했어요.'
  }
  return commonErrorMessage(error, '시간 기록을 저장하지 못했습니다')
}

// 부모의 계정·책 key로 재마운트한다. 측정 중 화면을 떠나도 시각과 일시정지 누계만 로컬에 보관한다.
export default function ReadingTimer({ userId, userBookId, status, blocked, onSaved, onBusyChange }: Props) {
  const [local, setLocal] = useState(() => initialTimer(userId))
  const [now, setNow] = useState(Date.now)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')
  const [remove, setRemove] = useState<string | null>(null)
  const active = useRef(true)
  const busy = useRef(false)
  const draft = local.draft
  const own = draft?.userBookId === userBookId
  const seconds = draft ? getTimerSeconds(draft, now) : 0
  const locked = blocked || saving || !!local.error

  useEffect(() => {
    active.current = true
    function refresh() {
      if (!active.current) return
      const time = Date.now()
      try {
        const current = readTimer(userId)
        const settled = current ? settleTimer(current, time) : null
        setLocal({ draft: settled, error: '' })
        setNow(time)
        // 복귀 때도 시각으로 상한을 확정하므로 백그라운드의 타이머 실행에 의존하지 않는다.
        if (settled && settled !== current) writeTimer(settled)
      } catch { setLocal(previous => ({ ...previous, error: STORAGE_ERROR })) }
    }
    const unsubscribe = subscribeTimer(refresh)
    const interval = setInterval(refresh, 1000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      active.current = false
      unsubscribe()
      clearInterval(interval)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
      onBusyChange(false)
    }
  }, [userId, onBusyChange])

  function persist(next: TimerDraft | null): boolean {
    try {
      if (next) writeTimer(next)
      else {
        clearTimer(userId)
        if (readTimer(userId)) throw new Error('timer cleanup failed')
      }
      setLocal({ draft: next, error: '' })
      setNow(Date.now())
      return true
    } catch { setLocal(previous => ({ ...previous, error: STORAGE_ERROR })); return false }
  }

  function begin() {
    if (locked || busy.current || status !== 'reading') return
    try {
      if (readTimer(userId)) { setNote('다른 화면에서 시작한 타이머가 있어요. 진행 중인 기록을 먼저 확인해주세요.'); return }
      if (persist(startTimer(userId, userBookId, Date.now(), crypto.randomUUID()))) setNote('')
    } catch { setLocal(previous => ({ ...previous, error: STORAGE_ERROR })) }
  }

  function togglePause() {
    if (locked || busy.current || !draft || !own) return
    try {
      const current = readTimer(userId)
      if (current?.clientSessionId !== draft.clientSessionId) return
      persist(current.phase === 'running' ? pauseTimer(current, Date.now()) : resumeTimer(current, Date.now()))
    } catch { setLocal(previous => ({ ...previous, error: STORAGE_ERROR })) }
  }

  async function save(continueReading = false) {
    if (locked || busy.current || !draft || !own) return
    busy.current = true
    setSaving(true)
    onBusyChange(true)
    let saved = false
    try {
      const current = readTimer(userId)
      if (current?.clientSessionId !== draft.clientSessionId) { setNote('다른 화면에서 타이머가 바뀌었습니다. 현재 기록을 확인해주세요.'); return }
      const finished = finishTimer(current, Date.now())
      const body = timerPayload(finished)
      if (!persist(finished)) return
      setNote('시간 기록을 저장하는 중…')
      await withAccessToken(token => saveReadingSession(token, userBookId, body))
      saved = true
      if (!active.current) return
      const unchanged = readTimer(userId)?.clientSessionId === finished.clientSessionId
      const cleared = unchanged && persist(null)
      const freshStatus = await onSaved().catch(() => null)
      if (!active.current) return
      setNote('시간 기록을 저장했습니다. 시작한 날짜의 독서 체크도 반영됐어요.')
      if (continueReading && cleared && freshStatus === 'reading' && !readTimer(userId)) {
        persist(startTimer(userId, userBookId, Date.now(), crypto.randomUUID()))
      } else if (continueReading && freshStatus !== 'reading') setNote('시간 기록은 저장했습니다. 책 상태를 확인한 뒤 다음 구간을 시작해주세요.')
    } catch (error) {
      if (!active.current) return
      setNote(saved ? '시간 기록은 저장했습니다. 목록과 기기 저장소를 다시 확인해주세요.' : saveError(error))
      if (!saved && error instanceof ApiError && (error.status === 409 || error.status === 404)) await onSaved().catch(() => null)
    } finally {
      busy.current = false
      if (active.current) { setSaving(false); onBusyChange(false) }
    }
  }

  function confirmRemove() {
    const target = remove
    setRemove(null)
    if (!target || locked || busy.current) return
    try {
      if (readTimer(userId)?.clientSessionId === target && persist(null)) setNote('저장하지 않은 측정을 버렸습니다.')
    } catch { setLocal(previous => ({ ...previous, error: STORAGE_ERROR })) }
  }

  return <section className="detail-card reading-timer" aria-labelledby="timer-title">
    <h2 id="timer-title">독서 타이머</h2>
    {draft && !own ? <div>
      <p className="result-note">다른 책의 측정이 남아 있어요. <Link to={`/timer?book=${encodeURIComponent(draft.userBookId)}`}>진행 중인 타이머로 이동</Link></p>
      <button type="button" className="link-button" disabled={locked} onClick={() => setRemove(draft.clientSessionId)}>측정 버리기</button>
    </div> : <>
      <p className="timer-clock" role="timer" aria-label="측정 시간" aria-live="off">{clock(seconds)}</p>
      <progress max={3600} value={seconds} aria-label="한 구간 최대 1시간" />
      {draft?.phase === 'finished' && seconds === 3600 && <p>1시간을 읽었어요. 계속 읽고 계신가요? 확인 전까지 시간은 더해지지 않아요.</p>}
      {draft && seconds < TIMER_MIN_SECONDS && <p className="result-note">1분부터 저장할 수 있어요.</p>}
      {draft?.phase === 'paused' && <p className="result-note">일시정지 중입니다.</p>}
      <div className="timer-actions">
        {!draft && <button type="button" disabled={locked || status !== 'reading'} onClick={begin}>타이머 시작</button>}
        {draft && draft.phase !== 'finished' && <button type="button" disabled={locked || (draft.phase === 'paused' && status !== 'reading')} onClick={togglePause}>{draft.phase === 'running' ? '일시정지' : '다시 읽기'}</button>}
        {draft?.phase === 'finished' && seconds === 3600 && <button type="button" disabled={locked || status !== 'reading'} onClick={() => void save(true)}>계속 읽기</button>}
        {draft && <button type="button" className="secondary" disabled={locked || seconds < TIMER_MIN_SECONDS} onClick={() => void save()}>{saving ? '저장하는 중…' : draft.phase === 'finished' && seconds < 3600 ? '다시 저장' : '종료·저장'}</button>}
        {draft && <button type="button" className="link-button" disabled={locked} onClick={() => setRemove(draft.clientSessionId)}>측정 버리기</button>}
      </div>
      {status !== 'reading' && <p className="result-note">읽는 중인 책만 새 측정을 시작할 수 있어요.</p>}
    </>}
    {local.error && <p role="alert">{local.error}</p>}
    <p aria-live="polite">{note}</p>
    <details className="inline-help"><summary>타이머 사용법</summary>
      <p>1분부터 저장할 수 있습니다. 한 구간은 최대 1시간이며 계속 읽기를 확인해야 다음 구간이 시작됩니다. 일시정지한 시간은 제외하고 저장한 구간의 시작 날짜에 독서 체크를 반영합니다.</p>
    </details>
    <ConfirmDialog open={remove !== null} title="측정을 버릴까요?" message="아직 저장하지 않은 측정은 복구할 수 없습니다."
      confirmLabel="측정 버리기" danger onConfirm={confirmRemove} onCancel={() => setRemove(null)} />
  </section>
}
