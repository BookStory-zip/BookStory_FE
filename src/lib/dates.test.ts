import { expect, test } from 'vitest'
import { addMonths, calendarDays, inclusiveDays, isEditableDate, monthRange, pastRangeProblem } from './dates'
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

test.each([
  ['2026-11-01', true],
  ['2026-10-26', true],
  ['2026-10-25', false],
  ['2026-11-02', false],
  ['2026-10-99', false],
  ['2026-10-32', false],
  ['2026-02-30', false],
  ['today', false],
])('오늘 2026-11-01 기준 %s의 체크 가능 여부는 %s', (date, editable) => {
  expect(isEditableDate(date, '2026-11-01')).toBe(editable)
})

test('기간 일수는 양 끝을 포함하고 윤년을 센다', () => {
  expect(inclusiveDays('2025-03-01', '2025-03-01')).toBe(1)
  expect(inclusiveDays('2024-01-01', '2024-12-31')).toBe(366)
})

const range = { start: '2024-01-01', end: '2025-03-01' }
test.each([
  ['2024-01-01', '2024-12-31', range, null],
  ['2024-01-01', '2025-01-01', range, '한 번에 366일까지 남길 수 있어요. 기간을 나눠 저장해주세요.'],
  ['2024-03-02', '2024-03-01', range, '시작일이 종료일보다 늦을 수 없어요.'],
  ['2023-12-31', '2024-01-31', range, '시작일(2024년 1월 1일)부터 완독일(2025년 3월 1일)까지만 남길 수 있어요.'],
  ['2025-02-01', '2025-03-02', range, '시작일(2024년 1월 1일)부터 완독일(2025년 3월 1일)까지만 남길 수 있어요.'],
  ['1999-01-01', '1999-12-31', { start: null, end: '2025-03-01' }, null],
  ['', '2025-03-01', range, '시작일과 종료일을 모두 골라주세요.'],
])('과거 기간 %s~%s 검사', (from, to, span, problem) => {
  expect(pastRangeProblem(from, to, span)).toBe(problem)
})

test('다음 한국 자정까지 남은 시간을 계산한다', () => {
  // 한국 시간 2026-10-28 23:59:30
  expect(msUntilNextKstDay(new Date('2026-10-28T14:59:30Z'))).toBe(30_000)
})
