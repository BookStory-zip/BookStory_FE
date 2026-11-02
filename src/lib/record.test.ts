import { expect, test } from 'vitest'
import type { LibraryBookDetail } from './api'
import {
  buildRecordPatch,
  formatKstDate,
  kstToday,
  recordFormFrom,
} from './record'

const saved = {
  rating: 4,
  memo: '좋았던 문장',
  stop_reason: null,
  is_review_public: false,
} as LibraryBookDetail

test('바꾸지 않은 필드는 보내지 않는다', () => {
  expect(buildRecordPatch(saved, recordFormFrom(saved))).toEqual({})
})

test('별점 지우기는 0이 아니라 null로 보낸다', () => {
  expect(buildRecordPatch(saved, { ...recordFormFrom(saved), rating: null })).toEqual({ rating: null })
})

test('메모를 비우거나 공백만 남기면 null로 삭제한다', () => {
  expect(buildRecordPatch(saved, { ...recordFormFrom(saved), memo: '   ' })).toEqual({ memo: null })
})

test('없던 중단 사유를 입력하면 그 필드만 보낸다', () => {
  expect(buildRecordPatch(saved, { ...recordFormFrom(saved), stopReason: '바빠서' })).toEqual({
    stop_reason: '바빠서',
  })
})

test('공개 스위치를 바꿀 때만 불리언을 전송한다', () => {
  expect(buildRecordPatch(saved, { ...recordFormFrom(saved), isReviewPublic: true })).toEqual({ is_review_public: true })
  const published = { ...saved, is_review_public: true }
  expect(recordFormFrom(published).isReviewPublic).toBe(true)
  expect(buildRecordPatch(published, recordFormFrom(published))).toEqual({})
  expect(buildRecordPatch(published, { ...recordFormFrom(published), isReviewPublic: false })).toEqual({ is_review_public: false })
})

test('한국 자정 직후에도 오늘 날짜는 한국 기준이다', () => {
  expect(kstToday(new Date('2026-10-26T15:30:00Z'))).toBe('2026-10-27')
})

test('KST 자정 직후 시각은 한국 날짜로 표시한다', () => {
  // UTC로는 10월 26일이지만 한국 시간으로는 10월 27일 00:30이다.
  expect(formatKstDate('2026-10-26T15:30:00Z')).toBe('2026년 10월 27일')
  expect(formatKstDate(null)).toBe('없음')
})
