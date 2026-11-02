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
