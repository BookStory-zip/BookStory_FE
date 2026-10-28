import type { LibraryBookDetail, RecordPatch } from './api'

export type RecordForm = {
  rating: number | null
  memo: string
  stopReason: string
}

export function recordFormFrom(detail: LibraryBookDetail): RecordForm {
  return {
    rating: detail.rating,
    memo: detail.memo ?? '',
    stopReason: detail.stop_reason ?? '',
  }
}

// 공백만 남은 입력은 기록 삭제(null)로 본다.
const orNull = (value: string) => (value.trim() ? value : null)

// 바뀐 필드만 담는다. 생략은 서버에서 유지, 명시적 null은 삭제다.
export function buildRecordPatch(
  saved: LibraryBookDetail,
  form: RecordForm,
): RecordPatch {
  const patch: RecordPatch = {}
  if (form.rating !== saved.rating) patch.rating = form.rating
  if (orNull(form.memo) !== saved.memo) patch.memo = orNull(form.memo)
  if (orNull(form.stopReason) !== saved.stop_reason) {
    patch.stop_reason = orNull(form.stopReason)
  }
  return patch
}

// 날짜만 고른 입력은 한국 날짜 안의 시각으로 보내 시간대 변환으로 하루가 밀리지 않게 한다.
// 시작은 그날 00:00, 완독은 그날 23:59:59(오늘이면 지금)로 보내 같은 날 시작·완독도 순서가 맞는다.
export function kstStartIso(date: string): string {
  return `${date}T00:00:00+09:00`
}

export function kstCompletionIso(date: string, now = new Date()): string {
  const endOfDay = new Date(`${date}T23:59:59+09:00`)
  return endOfDay > now ? now.toISOString() : `${date}T23:59:59+09:00`
}

const kstIsoDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' })

export function kstDateOf(iso: string): string {
  return kstIsoDate.format(new Date(iso))
}

export function kstToday(now = new Date()): string {
  return kstIsoDate.format(now)
}

const kstDate = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})

export function formatKstDate(iso: string | null): string {
  return iso ? kstDate.format(new Date(iso)) : '없음'
}
