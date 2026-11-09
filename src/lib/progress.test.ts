import { expect, test } from 'vitest'
import { buildProgressPatch, progressInputFrom } from './progress'
import type { ReadingStatus } from './api'

const book = (patch: Partial<{ status: ReadingStatus; page_count: number | null; total_pages: number | null; current_page: number | null; progress_percent: number | null }> = {}) =>
  ({ status: 'reading' as ReadingStatus, page_count: 300, total_pages: null, current_page: 120, progress_percent: 40, ...patch })

test('입력칸은 직접 정한 전체 쪽수와 단위별 현재 값으로 채운다', () => {
  expect(progressInputFrom(book())).toEqual({ total: '', current: '120', unit: 'page' })
  expect(progressInputFrom(book({ total_pages: 250 }), 'percent')).toEqual({ total: '250', current: '40', unit: 'percent' })
  expect(progressInputFrom(book({ current_page: null, progress_percent: null }), 'percent').current).toBe('')
})

test('바뀐 칸만 보내고, 빈칸은 저장된 값이 있을 때만 null로 지운다', () => {
  expect(buildProgressPatch(book(), progressInputFrom(book()))).toEqual({ patch: {} })
  expect(buildProgressPatch(book(), { total: '', current: '150', unit: 'page' })).toEqual({ patch: { current_page: 150 } })
  expect(buildProgressPatch(book(), { total: '', current: ' ', unit: 'page' })).toEqual({ patch: { current_page: null } })
  expect(buildProgressPatch(book({ total_pages: 320 }), { total: '', current: '120', unit: 'page' })).toEqual({ patch: { total_pages: null } })
  expect(buildProgressPatch(book(), { total: '0', current: '120', unit: 'page' })).toEqual({ errors: { total: '전체 쪽수는 1~99999 사이 정수로 입력해주세요.' } })
  expect(buildProgressPatch(book(), { total: '100000', current: '120', unit: 'page' })).toHaveProperty('errors.total')
  expect(buildProgressPatch(book(), { total: '99999', current: '120', unit: 'page' })).toEqual({ patch: { total_pages: 99999 } })
})

test('현재 쪽은 반영 후 전체 쪽수 기준으로 검사하고, %는 올림해 쪽으로 보낸다', () => {
  // 함께 보내면 새 전체 쪽수로 검사한다.
  expect(buildProgressPatch(book(), { total: '500', current: '450', unit: 'page' })).toEqual({ patch: { total_pages: 500, current_page: 450 } })
  expect(buildProgressPatch(book(), { total: '', current: '301', unit: 'page' })).toEqual({ errors: { current: '현재 쪽은 0~300 사이 정수로 입력해주세요.' } })
  expect(buildProgressPatch(book(), { total: '', current: '0', unit: 'page' })).toEqual({ patch: { current_page: 0 } })
  for (const bad of ['-1', '1.5', '열']) expect(buildProgressPatch(book(), { total: '', current: bad, unit: 'page' })).toHaveProperty('errors.current')
  expect(buildProgressPatch(book({ page_count: 301 }), { total: '', current: '50', unit: 'percent' })).toEqual({ patch: { current_page: 151 } })
  expect(buildProgressPatch(book(), { total: '', current: '100', unit: 'percent' })).toEqual({ patch: { current_page: 300 } })
  expect(buildProgressPatch(book(), { total: '', current: '101', unit: 'percent' })).toHaveProperty('errors.current')
  // 서버는 %를 내림하므로 올림해야 7쪽 책의 29%가 28%로 보이지 않는다(3쪽 → 42%, 2쪽 → 28%).
  expect(buildProgressPatch(book({ page_count: 7, current_page: 1, progress_percent: 14 }), { total: '', current: '29', unit: 'percent' })).toEqual({ patch: { current_page: 3 } })
  // 그대로 둔 %는 쪽으로 다시 바꿔 보내지 않지만, 전체 쪽수를 바꾸면 그 %를 새 기준으로 다시 보낸다.
  expect(buildProgressPatch(book({ page_count: 301 }), { total: '', current: '40', unit: 'percent' })).toEqual({ patch: {} })
  expect(buildProgressPatch(book(), { total: '100', current: '40', unit: 'percent' })).toEqual({ patch: { total_pages: 100, current_page: 40 } })
  expect(buildProgressPatch(book(), { total: '600', current: '40', unit: 'percent' })).toEqual({ patch: { total_pages: 600, current_page: 240 } })
  expect(buildProgressPatch(book({ page_count: null, current_page: null, progress_percent: null }), { total: '', current: '10', unit: 'page' }))
    .toEqual({ errors: { current: '전체 쪽수를 먼저 입력해주세요.' } })
})

test('현재 쪽보다 작게 줄이거나 기준을 없애는 변경은 현재 쪽을 함께 고치게 한다', () => {
  expect(buildProgressPatch(book(), { total: '100', current: '120', unit: 'page' }))
    .toEqual({ errors: { total: '현재 쪽(120쪽)보다 작게 바꾸려면 현재 쪽도 함께 고쳐주세요.' } })
  expect(buildProgressPatch(book(), { total: '100', current: '90', unit: 'page' })).toEqual({ patch: { total_pages: 100, current_page: 90 } })
  // total_pages를 지우면 page_count로 돌아간다. page_count도 없으면 현재 쪽을 함께 지워야 한다.
  const noCount = book({ page_count: null, total_pages: 200 })
  expect(buildProgressPatch(noCount, { total: '', current: '120', unit: 'page' }))
    .toEqual({ errors: { total: '전체 쪽수를 지우려면 현재 쪽도 함께 지워주세요.' } })
  expect(buildProgressPatch(noCount, { total: '', current: '', unit: 'page' })).toEqual({ patch: { total_pages: null, current_page: null } })
})

test('읽고 싶음·완독은 현재 쪽을 보내지 않고 전체 쪽수만 바꾼다', () => {
  const want = book({ status: 'want_to_read', current_page: null, progress_percent: null })
  expect(buildProgressPatch(want, { total: '280', current: '30', unit: 'page' })).toEqual({ patch: { total_pages: 280 } })
  // 완독은 서버가 현재 쪽을 새 전체 쪽수로 맞춘다.
  const done = book({ status: 'completed', current_page: 300, progress_percent: 100 })
  expect(buildProgressPatch(done, { total: '250', current: '300', unit: 'page' })).toEqual({ patch: { total_pages: 250 } })
})
