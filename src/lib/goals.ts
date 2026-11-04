import type { GoalMetric } from './api'

const isLeapYear = (year: number) => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)

// BE와 같은 직접 입력 상한. 응답 target(이어받기·연 합계)에는 적용하지 않는다.
export function goalLimit(metric: GoalMetric, year: number, month: number | null): number {
  if (metric === 'completed_books') return 9999
  const leap = isLeapYear(year)
  const days = month === null ? (leap ? 366 : 365) : [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  return metric === 'reading_days' ? days : days * 1440
}

// 빈 입력을 0으로 바꾸지 않는다. 목표 끄기(0)는 별도 버튼으로만 보낸다.
export function parseGoalTarget(input: string, limit: number): { target: number } | { error: string } {
  const value = input.trim()
  if (!value) return { error: '목표를 입력해주세요.' }
  if (!/^\d+$/.test(value) || Number(value) < 1) return { error: '1 이상의 정수로 입력해주세요.' }
  if (Number(value) > limit) return { error: `최대 ${limit}까지 정할 수 있어요.` }
  return { target: Number(value) }
}
