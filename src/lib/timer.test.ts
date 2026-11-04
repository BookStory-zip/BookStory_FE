// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest'
import { clearTimer, finishTimer, getTimerSeconds, pauseTimer, readTimer, resumeTimer, settleTimer, startTimer, timerPayload, writeTimer } from './timer'

const start = Date.parse('2026-11-04T14:30:00Z')
const clientId = '00000000-0000-4000-8000-000000000001'
const draft = () => startTimer('user-a', 'book-a', start, clientId)
afterEach(() => localStorage.clear())

test('일시정지 시간은 빼고 재개 후 실제 측정 시간만 합산한다', () => {
  const paused = pauseTimer(draft(), start + 90_000)
  expect(getTimerSeconds(paused, start + 600_000)).toBe(90)
  const resumed = resumeTimer(paused, start + 600_000)
  const finished = finishTimer(resumed, start + 630_000)
  expect(timerPayload(finished)).toEqual({ client_session_id: clientId, started_at: '2026-11-04T14:30:00.000Z', duration_seconds: 120 })
})

test('화면이 꺼진 채 여러 시간이 지나도 1시간에서 멈추고 확인 전 시간은 더하지 않는다', () => {
  const stopped = settleTimer(draft(), start + 5 * 3600_000)
  expect(stopped.phase).toBe('finished')
  expect(getTimerSeconds(stopped, start + 8 * 3600_000)).toBe(3600)
  expect(timerPayload(stopped).started_at).toBe('2026-11-04T14:30:00.000Z')
  expect(resumeTimer(stopped, start + 8 * 3600_000)).toEqual(stopped)
})

test('분 경계의 일시정지는 밀리초를 보존하고 종료 때만 초로 내린다', () => {
  const paused = pauseTimer(draft(), start + 30_750)
  const resumed = resumeTimer(paused, start + 100_000)
  expect(timerPayload(finishTimer(resumed, start + 129_250)).duration_seconds).toBe(60)
})

test('1분보다 짧거나 아직 종료하지 않은 구간은 저장 요청으로 만들지 않는다', () => {
  expect(() => timerPayload(draft())).toThrow()
  expect(() => timerPayload(finishTimer(draft(), start + 59_999))).toThrow()
})

test('시계가 뒤로 바뀌어도 음수 시간을 만들지 않는다', () => {
  expect(getTimerSeconds(draft(), start - 10_000)).toBe(0)
})

test('같은 계정의 구간과 재시도 식별자를 복원하고 다른 계정에는 노출하지 않는다', () => {
  writeTimer(draft())
  expect(readTimer('user-a')).toEqual(draft())
  expect(readTimer('user-b')).toBeNull()
  clearTimer('user-a')
  expect(readTimer('user-a')).toBeNull()
})

test('다른 계정으로 위조되거나 손상된 로컬 타이머는 사용하지 않는다', () => {
  localStorage.setItem('bookstory-reading-timer:user-a', JSON.stringify({ ...draft(), userId: 'user-b' }))
  expect(readTimer('user-a')).toBeNull()
  localStorage.setItem('bookstory-reading-timer:user-a', JSON.stringify({ ...draft(), elapsedMs: -1 }))
  expect(readTimer('user-a')).toBeNull()
  localStorage.setItem('bookstory-reading-timer:user-a', '{')
  expect(readTimer('user-a')).toBeNull()
})
