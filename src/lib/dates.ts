// 날짜는 'YYYY-MM-DD', 달은 'YYYY-MM' 문자열로만 다루고, 계산은 UTC Date로 해서 시간대에 흔들리지 않는다.
const toUtc = (date: string) => new Date(`${date}T00:00:00Z`)
const toDate = (utc: Date) => utc.toISOString().slice(0, 10)

export function addDays(date: string, days: number): string {
  const utc = toUtc(date)
  utc.setUTCDate(utc.getUTCDate() + days)
  return toDate(utc)
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

export function spokenDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return `${y}년 ${m}월 ${d}일`
}

export function spokenMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${y}년 ${m}월`
}
