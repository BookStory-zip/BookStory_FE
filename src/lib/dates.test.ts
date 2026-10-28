import { expect, test } from 'vitest'
import { addMonths, calendarDays, monthRange } from './dates'
import { msUntilNextKstDay } from '../useKstToday'

test('월 범위는 양 끝을 포함하고 윤년 2월도 맞다', () => {
  expect(monthRange('2026-10')).toEqual({ start: '2026-10-01', end: '2026-10-31' })
  expect(monthRange('2028-02')).toEqual({ start: '2028-02-01', end: '2028-02-29' })
  expect(addMonths('2026-12', 1)).toBe('2027-01')
})

test('달력은 1일이 있는 주의 일요일부터 6주를 채운다', () => {
  const days = calendarDays('2026-10')
  expect(days).toHaveLength(42)
  expect(days[0]).toBe('2026-09-27')
  expect(days[4]).toBe('2026-10-01')
})

test('다음 한국 자정까지 남은 시간을 계산한다', () => {
  // 한국 시간 2026-10-28 23:59:30
  expect(msUntilNextKstDay(new Date('2026-10-28T14:59:30Z'))).toBe(30_000)
})
