export const TIMER_LIMIT_MS = 60 * 60 * 1000
export const TIMER_MIN_SECONDS = 60

export type TimerDraft = {
  userId: string
  userBookId: string
  clientSessionId: string
  startedAt: string
  elapsedMs: number
  runningSince: number | null
  phase: 'running' | 'paused' | 'finished'
}

export function startTimer(userId: string, userBookId: string, now: number, clientSessionId: string): TimerDraft {
  return { userId, userBookId, clientSessionId, startedAt: new Date(now).toISOString(), elapsedMs: 0, runningSince: now, phase: 'running' }
}

function elapsed(timer: TimerDraft, now: number): number {
  return Math.min(TIMER_LIMIT_MS, timer.elapsedMs + (timer.runningSince === null ? 0 : Math.max(0, now - timer.runningSince)))
}

export function getTimerSeconds(timer: TimerDraft, now: number): number {
  return Math.floor(elapsed(timer, now) / 1000)
}

export function settleTimer(timer: TimerDraft, now: number): TimerDraft {
  return timer.phase === 'running' && elapsed(timer, now) >= TIMER_LIMIT_MS
    ? { ...timer, elapsedMs: TIMER_LIMIT_MS, runningSince: null, phase: 'finished' }
    : timer
}

export function pauseTimer(timer: TimerDraft, now: number): TimerDraft {
  timer = settleTimer(timer, now)
  if (timer.phase !== 'running') return timer
  return { ...timer, elapsedMs: elapsed(timer, now), runningSince: null, phase: 'paused' }
}

export function resumeTimer(timer: TimerDraft, now: number): TimerDraft {
  return timer.phase === 'paused' ? { ...timer, runningSince: now, phase: 'running' } : timer
}

export function finishTimer(timer: TimerDraft, now: number): TimerDraft {
  return { ...pauseTimer(timer, now), phase: 'finished' }
}

export function timerPayload(timer: TimerDraft) {
  const seconds = getTimerSeconds(timer, 0)
  if (timer.phase !== 'finished' || seconds < TIMER_MIN_SECONDS || seconds > 3600) throw new Error('종료한 1분 이상·1시간 이하 기록만 저장할 수 있습니다.')
  return { client_session_id: timer.clientSessionId, started_at: timer.startedAt, duration_seconds: seconds }
}

const storageKey = (userId: string) => `bookstory-reading-timer:${userId}`
const CHANGE_EVENT = 'bookstory-timer-change'

export function readTimer(userId: string): TimerDraft | null {
  const stored = localStorage.getItem(storageKey(userId))
  if (!stored) return null
  let value: unknown
  try { value = JSON.parse(stored) } catch { return null }
  if (typeof value !== 'object' || value === null) return null
  const timer = value as Partial<TimerDraft>
  if (timer.userId !== userId || typeof timer.userBookId !== 'string' || !timer.userBookId ||
    typeof timer.clientSessionId !== 'string' || !/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(timer.clientSessionId) ||
    typeof timer.startedAt !== 'string' || !Number.isFinite(Date.parse(timer.startedAt)) ||
    typeof timer.elapsedMs !== 'number' || !Number.isInteger(timer.elapsedMs) || timer.elapsedMs < 0 || timer.elapsedMs > TIMER_LIMIT_MS ||
    !['running', 'paused', 'finished'].includes(timer.phase ?? '') ||
    (timer.phase === 'running' ? typeof timer.runningSince !== 'number' || !Number.isFinite(timer.runningSince) : timer.runningSince !== null)) return null
  return timer as TimerDraft
}

export function writeTimer(timer: TimerDraft): void {
  localStorage.setItem(storageKey(timer.userId), JSON.stringify(timer))
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function clearTimer(userId: string): void {
  try { localStorage.removeItem(storageKey(userId)) } catch { /* 저장소 오류가 로그아웃을 막지 않게 한다. */ }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function subscribeTimer(listener: () => void): () => void {
  window.addEventListener('storage', listener)
  window.addEventListener(CHANGE_EVENT, listener)
  return () => {
    window.removeEventListener('storage', listener)
    window.removeEventListener(CHANGE_EVENT, listener)
  }
}
