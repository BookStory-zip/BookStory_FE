import { expect, test } from 'vitest'
import { goalLimit, parseGoalTarget } from './goals'

test.each([
  ['reading_days', 2026, 2, 28],
  ['reading_days', 2024, 2, 29],
  ['reading_days', 2026, 4, 30],
  ['reading_days', 2026, null, 365],
  ['reading_days', 2024, null, 366],
  ['reading_days', 1900, null, 365],
  ['reading_days', 2000, 2, 29],
  ['reading_minutes', 2026, 2, 28 * 1440],
  ['reading_minutes', 2024, null, 366 * 1440],
  ['completed_books', 2026, 2, 9999],
  ['completed_books', 2026, null, 9999],
] as const)('%s %i년 %s월 입력 상한은 %i', (metric, year, month, limit) => {
  expect(goalLimit(metric, year, month)).toBe(limit)
})

test.each([
  ['-1', '0 이상의 정수로 입력해주세요.'],
  ['1.5', '0 이상의 정수로 입력해주세요.'],
  ['1e2', '0 이상의 정수로 입력해주세요.'],
  ['열둘', '0 이상의 정수로 입력해주세요.'],
  ['29', '최대 28까지 정할 수 있어요.'],
  ['99999999999999999999', '최대 28까지 정할 수 있어요.'],
])('목표 입력 %j를 거부한다', (input, error) => {
  expect(parseGoalTarget(input, 28)).toEqual({ error })
})

test.each([['0', 0], ['1', 1], [' 28 ', 28], ['007', 7]])('목표 입력 %j를 %i로 읽는다', (input, target) => {
  expect(parseGoalTarget(input, 28)).toEqual({ target })
})
