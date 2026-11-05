// 날짜는 'YYYY-MM-DD', 달은 'YYYY-MM' 문자열로만 다루고, 계산은 UTC Date로 해서 시간대에 흔들리지 않는다.
const toUtc = (date: string) => new Date(`${date}T00:00:00Z`)
const toDate = (utc: Date) => utc.toISOString().slice(0, 10)

export function addDays(date: string, days: number): string {
  const utc = toUtc(date)
  utc.setUTCDate(utc.getUTCDate() + days)
  return toDate(utc)
}

// 독서 체크·취소할 수 있는 날짜: 실제 달력 날짜이고 서버 KST 오늘을 포함한 최근 7일.
export function isEditableDate(date: string, today: string): boolean {
  const utc = toUtc(date)
  return !Number.isNaN(utc.getTime()) && toDate(utc) === date && date >= addDays(today, -6) && date <= today
}

// 양 끝을 포함한 날 수.
export const inclusiveDays = (from: string, to: string) =>
  Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000) + 1

// 과거 읽은 날 기간 저장 전 검사. 최종 판단은 서버가 하고, 보내도 실패할 입력만 미리 막는다.
export function pastRangeProblem(from: string, to: string, range: { start: string | null; end: string }): string | null {
  if (!from || !to) return '시작일과 종료일을 모두 골라주세요.'
  if (from > to) return '시작일이 종료일보다 늦을 수 없어요.'
  if ((range.start !== null && from < range.start) || to > range.end) {
    return `${range.start ? `시작일(${spokenDate(range.start)})부터 ` : ''}완독일(${spokenDate(range.end)})까지만 남길 수 있어요.`
  }
  if (inclusiveDays(from, to) > 366) return '한 번에 366일까지 남길 수 있어요. 기간을 나눠 저장해주세요.'
  return null
}

export const monthOf = (date: string) => date.slice(0, 7)

export function addMonths(month: string, delta: number): string {
  const utc = toUtc(`${month}-01`)
  utc.setUTCMonth(utc.getUTCMonth() + delta)
  return toDate(utc).slice(0, 7)
}

export function monthRange(month: string): { start: string; end: string } {
  return { start: `${month}-01`, end: addDays(`${addMonths(month, 1)}-01`, -1) }
}

// 달력 6주(42칸): 그 달 1일이 있는 주의 일요일부터 시작한다.
export function calendarDays(month: string): string[] {
  const first = `${month}-01`
  const start = addDays(first, -toUtc(first).getUTCDay())
  return Array.from({ length: 42 }, (_, index) => addDays(start, index))
}

// 날짜 문자열을 UTC 자정으로 읽고 UTC로 표기해 시간대와 관계없이 같은 날을 보여 준다.
const spokenDateFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})
const spokenMonthFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'long',
})

export function spokenDate(date: string): string {
  return spokenDateFormat.format(toUtc(date))
}

export function spokenMonth(month: string): string {
  return spokenMonthFormat.format(toUtc(`${month}-01`))
}
