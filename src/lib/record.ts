import type { LibraryBookDetail, RecordPatch } from './api'

export type RecordForm = {
  rating: number | null
  memo: string
  stopReason: string
  isReviewPublic: boolean
}

export function recordFormFrom(detail: LibraryBookDetail): RecordForm {
  return {
    rating: detail.rating,
    memo: detail.memo ?? '',
    stopReason: detail.stop_reason ?? '',
    isReviewPublic: detail.is_review_public,
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
  if (form.isReviewPublic !== saved.is_review_public) patch.is_review_public = form.isReviewPublic
  if (form.rating !== saved.rating) patch.rating = form.rating
  if (orNull(form.memo) !== saved.memo) patch.memo = orNull(form.memo)
  if (orNull(form.stopReason) !== saved.stop_reason) {
    patch.stop_reason = orNull(form.stopReason)
  }
  return patch
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
