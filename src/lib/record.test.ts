import { expect, test } from 'vitest'
import type { LibraryBookDetail } from './api'
import {
  buildRecordPatch,
  formatKstDate,
  kstCompletionIso,
  kstStartIso,
  kstToday,
  recordFormFrom,
} from './record'

const saved = {
  rating: 4,
  memo: '좋았던 문장',
  stop_reason: null,
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

test('고른 날짜는 시간대 변환 후에도 같은 한국 날짜로 남는다', () => {
  expect(kstStartIso('2026-10-27')).toBe('2026-10-27T00:00:00+09:00')
  expect(formatKstDate(kstStartIso('2026-10-27'))).toBe('2026년 10월 27일')
  expect(formatKstDate(kstCompletionIso('2026-10-20'))).toBe('2026년 10월 20일')
})

test('오늘 시작·오늘 완독이어도 시작이 완독보다 늦지 않다', () => {
  // 한국 시간 10월 27일 오전 10시. 정오로 보내면 서버의 현재 시각 완독보다 늦어 409가 난다.
  const now = new Date('2026-10-27T01:00:00Z')
  const completed = kstCompletionIso('2026-10-27', now)
  expect(completed).toBe(now.toISOString())
  expect(new Date(kstStartIso(kstToday(now))) <= new Date(completed)).toBe(true)
})

test('한국 자정 직후에도 오늘 날짜는 한국 기준이다', () => {
  expect(kstToday(new Date('2026-10-26T15:30:00Z'))).toBe('2026-10-27')
})

test('KST 자정 직후 시각은 한국 날짜로 표시한다', () => {
  // UTC로는 10월 26일이지만 한국 시간으로는 10월 27일 00:30이다.
  expect(formatKstDate('2026-10-26T15:30:00Z')).toBe('2026년 10월 27일')
  expect(formatKstDate(null)).toBe('없음')
})
