import type { NoteInput, ReadingNote } from './api'

export type NoteForm = { date: string; quote: string; thought: string; page: string }

export const QUOTE_LIMIT = 1000
export const THOUGHT_LIMIT = 2000
export const PAGE_LIMIT = 99999

// BE는 문자 수(코드 포인트)로 센다. 이모지도 1자다.
export const charCount = (value: string) => [...value].length

// BE와 같은 규칙: 앞뒤 공백 제거, 비면 null, 문구·생각 중 하나는 필수.
export function noteInput(form: NoteForm, today: string): { input: NoteInput } | { error: string } {
  const quote = form.quote.trim() || null
  const thought = form.thought.trim() || null
  const page = form.page.trim()
  if (!form.date) return { error: '날짜를 선택해주세요.' }
  if (form.date > today) return { error: '오늘 이후 날짜는 선택할 수 없어요.' }
  if (quote === null && thought === null) return { error: '문구나 생각 중 하나는 남겨주세요.' }
  if (quote && charCount(quote) > QUOTE_LIMIT) return { error: `문구는 ${QUOTE_LIMIT}자까지 남길 수 있어요.` }
  if (thought && charCount(thought) > THOUGHT_LIMIT) return { error: `생각은 ${THOUGHT_LIMIT}자까지 남길 수 있어요.` }
  if (page && (!/^\d+$/.test(page) || Number(page) < 1 || Number(page) > PAGE_LIMIT)) {
    return { error: `페이지는 1~${PAGE_LIMIT} 사이의 정수로 입력해주세요.` }
  }
  return { input: { note_date: form.date, quote, thought, page: page ? Number(page) : null } }
}

// PATCH는 바뀐 항목만 보낸다. 지운 항목은 null로 보낸다.
export function notePatch(note: ReadingNote, input: NoteInput): Partial<NoteInput> {
  const patch: Partial<NoteInput> = {}
  if (input.note_date !== note.note_date) patch.note_date = input.note_date
  if (input.quote !== note.quote) patch.quote = input.quote
  if (input.thought !== note.thought) patch.thought = input.thought
  if (input.page !== note.page) patch.page = input.page
  return patch
}

export function noteForm(note: ReadingNote | null, today: string): NoteForm {
  return note
    ? { date: note.note_date, quote: note.quote ?? '', thought: note.thought ?? '', page: note.page === null ? '' : String(note.page) }
    : { date: today, quote: '', thought: '', page: '' }
}
