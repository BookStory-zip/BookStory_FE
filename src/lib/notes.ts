import type { NoteInput, ReadingNote } from './api'
import { ApiError } from './api'
import { commonErrorMessage, isUnclearWrite } from './errors'

export type NoteForm = { date: string; quote: string; thought: string; page: string }

export const QUOTE_LIMIT = 1000
export const THOUGHT_LIMIT = 2000
export const PAGE_LIMIT = 99999
export const NOTE_PHOTO_MAX_BYTES = 10_485_760
export const NOTE_REFRESH_PAGE_SIZE = 100

// 펼친 노트의 URL을 함께 갱신하되 서버에서 사라진 노트만 목록에서 뺀다.
export async function refreshNotePhotos<T extends ReadingNote>(items: T[], loadPage: (offset: number) => Promise<T[]>, isCurrent: () => boolean): Promise<T[] | null> {
  const remaining = new Set(items.map((item) => item.id))
  const fresh = new Map<string, T>()
  for (let offset = 0; remaining.size > 0; offset += NOTE_REFRESH_PAGE_SIZE) {
    const page = await loadPage(offset)
    if (!isCurrent()) return null
    for (const item of page) {
      if (remaining.delete(item.id)) fresh.set(item.id, item)
    }
    if (page.length < NOTE_REFRESH_PAGE_SIZE) break
  }
  return items.flatMap((item) => { const replacement = fresh.get(item.id); return replacement ? [replacement] : [] })
}

export function validateNotePhoto(file: File): string | null {
  if (file.size > NOTE_PHOTO_MAX_BYTES) return '사진은 10MB 이하로 올려주세요.'
  if (file.type && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'JPEG, PNG 또는 WebP 사진을 선택해주세요. HEIC 사진은 JPEG나 PNG로 변환해주세요.'
  return null
}

export function notePhotoError(error: unknown, action = '저장'): string {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      const seconds = error.retryAfter
      return seconds !== undefined && Number.isFinite(seconds) && seconds > 0
        ? `사진 업로드 요청이 많아요. ${Math.ceil(seconds)}초 후 다시 시도해주세요.`
        : '사진 업로드 요청이 많아요. 잠시 후 다시 시도해주세요.'
    }
    if (error.status === 413 || error.code === 'image_too_large') return '사진은 10MB 이하, 4천만 화소 이하로 올려주세요.'
    if (error.code === 'unsupported_image') return '지원하지 않는 사진이에요. JPEG, PNG 또는 WebP 사진을 선택해주세요.'
    if (error.code === 'invalid_image') return '사진을 읽을 수 없어요. 다른 사진을 선택해주세요.'
    if (error.code === 'photo_storage_unavailable') return '사진 저장소에 연결할 수 없어요. 잠시 후 다시 시도해주세요.'
    if (error.status === 404) return '노트를 찾을 수 없습니다. 목록을 다시 확인해주세요.'
    if (action === '삭제' && error.status === 422 && error.code === 'validation_error') return '사진을 삭제할 수 없습니다. 최신 노트를 확인해주세요. 사진만 남은 노트는 노트 자체를 삭제해주세요.'
  }
  if (isUnclearWrite(error)) return `사진 ${action} 결과를 확인하지 못했어요. 노트 목록을 확인한 뒤 다시 시도해주세요.`
  return commonErrorMessage(error, `사진을 ${action}하지 못했습니다`)
}

// BE는 문자 수(코드 포인트)로 센다. 이모지도 1자다.
export const charCount = (value: string) => [...value].length

// BE와 같은 규칙: 앞뒤 공백 제거, 비면 null, 문구·생각·사진 중 하나는 필수.
export function noteInput(form: NoteForm, today: string, hasPhoto = false): { input: NoteInput } | { error: string } {
  const quote = form.quote.trim() || null
  const thought = form.thought.trim() || null
  const page = form.page.trim()
  if (!form.date) return { error: '날짜를 선택해주세요.' }
  if (form.date > today) return { error: '오늘 이후 날짜는 선택할 수 없어요.' }
  if (quote === null && thought === null && !hasPhoto) return { error: '문구나 생각 중 하나는 남겨주세요.' }
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
