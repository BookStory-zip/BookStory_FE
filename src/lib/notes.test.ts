import { expect, test } from 'vitest'
import { charCount, noteInput, notePatch } from './notes'
import type { ReadingNote } from './api'

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
  created_at: '2026-11-01T01:00:00Z', updated_at: '2026-11-01T01:00:00Z',
}

test('수정은 바뀐 항목만 보내고, 지운 항목은 null로 보낸다', () => {
  expect(notePatch(saved, { note_date: '2026-11-01', quote: '문구', thought: '생각', page: 3 })).toEqual({})
  expect(notePatch(saved, { note_date: '2026-11-02', quote: '문구', thought: null, page: null })).toEqual({
    note_date: '2026-11-02', thought: null, page: null,
  })
})
