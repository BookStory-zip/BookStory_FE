import { expect, test, vi } from 'vitest'
import { NOTE_PHOTO_MAX_BYTES, validateNotePhoto, notePhotoError, charCount, noteInput, notePatch } from './notes'
import { ApiError, type ReadingNote } from './api'

vi.mock('./supabase', () => ({ supabase: { auth: {} } }))

const today = '2026-11-04'
const form = (patch: Partial<{ date: string; quote: string; thought: string; page: string }> = {}) =>
  ({ date: today, quote: '', thought: '', page: '', ...patch })

test('앞뒤 공백을 지우고 비운 항목은 null로 보낸다', () => {
  expect(noteInput(form({ quote: '  밑줄 친 문장  ', thought: '   ', page: ' 12 ' }), today)).toEqual({
    input: { note_date: today, quote: '밑줄 친 문장', thought: null, page: 12 },
  })
})

test.each([
  [form({ quote: ' ', thought: '\n\t' }), '문구나 생각 중 하나는 남겨주세요.'],
  [form({ quote: 'a'.repeat(1001) }), '문구는 1000자까지 남길 수 있어요.'],
  [form({ thought: 'a'.repeat(2001) }), '생각은 2000자까지 남길 수 있어요.'],
  [form({ quote: 'a', page: '0' }), '페이지는 1~99999 사이의 정수로 입력해주세요.'],
  [form({ quote: 'a', page: '-3' }), '페이지는 1~99999 사이의 정수로 입력해주세요.'],
  [form({ quote: 'a', page: '1.5' }), '페이지는 1~99999 사이의 정수로 입력해주세요.'],
  [form({ quote: 'a', page: '100000' }), '페이지는 1~99999 사이의 정수로 입력해주세요.'],
  [form({ quote: 'a', date: '' }), '날짜를 선택해주세요.'],
  [form({ quote: 'a', date: '2026-11-05' }), '오늘 이후 날짜는 선택할 수 없어요.'],
])('노트 입력을 거부한다: %j', (value, error) => {
  expect(noteInput(value, today)).toEqual({ error })
})

test('페이지는 99999까지 받는다', () => {
  expect(noteInput(form({ quote: 'a', page: '99999' }), today)).toHaveProperty('input.page', 99999)
})

test('길이는 앞뒤 공백을 지운 뒤 글자 수(이모지 1자)로 센다', () => {
  expect(noteInput(form({ quote: ` ${'가'.repeat(1000)} ` }), today)).toHaveProperty('input')
  expect(noteInput(form({ thought: '📚'.repeat(2000) }), today)).toHaveProperty('input')
  // BE 예시: 😀 1자, 👍🏻 2자, 👨‍👩‍👧 5자(화면에 보이는 글자 수와 다를 수 있다).
  expect([charCount('😀'), charCount('👍🏻'), charCount('👨‍👩‍👧')]).toEqual([1, 2, 5])
})

const saved: ReadingNote = {
  id: 'note-1', user_book_id: 'ub-1', note_date: '2026-11-01', quote: '문구', thought: '생각', page: 3,
  has_photo: false, photo_url: null,
  created_at: '2026-11-01T01:00:00Z', updated_at: '2026-11-01T01:00:00Z',
}

test('수정은 바뀐 항목만 보내고, 지운 항목은 null로 보낸다', () => {
  expect(notePatch(saved, { note_date: '2026-11-01', quote: '문구', thought: '생각', page: 3 })).toEqual({})
  expect(notePatch(saved, { note_date: '2026-11-02', quote: '문구', thought: null, page: null })).toEqual({
    note_date: '2026-11-02', thought: null, page: null,
  })
})

test('photo-only input still validates date, page and length', () => {
  expect(noteInput(form(), today, true)).toEqual({ input: { note_date: today, quote: null, thought: null, page: null } })
  expect(noteInput(form({ date: '' }), today, true)).toHaveProperty('error')
  expect(noteInput(form({ page: '0' }), today, true)).toHaveProperty('error')
  expect(noteInput(form({ quote: 'a'.repeat(1001) }), today, true)).toHaveProperty('error')
})

test('photo validation accepts supported types and 10MiB boundary', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp', '']) {
    expect(validateNotePhoto(new File(['a'], 'photo', { type }))).toBeNull()
  }
  expect(validateNotePhoto(new File(['a'], 'photo.heic', { type: 'image/heic' }))).toMatch(/JPEG.*PNG/)
  const file = new File(['a'], 'photo.jpg', { type: 'image/jpeg' })
  Object.defineProperty(file, 'size', { value: NOTE_PHOTO_MAX_BYTES, configurable: true })
  expect(validateNotePhoto(file)).toBeNull()
  Object.defineProperty(file, 'size', { value: NOTE_PHOTO_MAX_BYTES + 1 })
  expect(validateNotePhoto(file)).toMatch(/10MB/)
})

test('photo errors explain rejection and uncertain outcomes', () => {
  expect(notePhotoError(new ApiError(422, 'cannot identify image', 'invalid_image'))).toContain('사진을 읽을 수 없어요')
  expect(notePhotoError(new ApiError(404, 'not found'))).toContain('노트를 찾을 수 없습니다')
  expect(notePhotoError(new ApiError(401, 'unauthorized'))).toContain('다시 로그인')
  expect(notePhotoError(new ApiError(413, '', 'image_too_large'))).toMatch(/10MB/)
  expect(notePhotoError(new ApiError(422, '', 'unsupported_image'))).toMatch(/JPEG.*PNG/)
  expect(notePhotoError(new ApiError(503, '', 'photo_storage_unavailable'))).toMatch(/잠시/)
  expect(notePhotoError(new TypeError('Failed to fetch'))).toMatch(/확인/)
})

test('사진 삭제 안내는 HTTP 상태와 validation_error 코드로 판단한다', () => {
  expect(notePhotoError(new ApiError(422, 'quote or thought is required', 'validation_error'), '삭제')).toContain('노트 자체를 삭제')
  expect(notePhotoError(new ApiError(422, 'quote or thought is required', 'other_error'), '삭제')).not.toContain('노트 자체를 삭제')
  expect(notePhotoError(new ApiError(422, 'quote or thought is required'), '삭제')).not.toContain('노트 자체를 삭제')
})

test('사진 업로드 429는 Retry-After 초를 안내하고 없으면 일반 재시도를 안내한다', () => {
  expect(notePhotoError(new ApiError(429, '', 'rate_limited', 12.3))).toContain('13초 후')
  for (const retryAfter of [undefined, 0, -1, NaN, Infinity]) {
    expect(notePhotoError(new ApiError(429, '', 'rate_limited', retryAfter))).toContain('잠시 후')
  }
})
