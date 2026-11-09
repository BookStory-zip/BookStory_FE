import type { ProgressFields, ProgressPatch, ReadingStatus } from './api'

// BE와 같은 상한. page_out_of_range는 어느 칸인지 알려 주지 않으므로 같은 규칙으로 먼저 검사한다.
export const MAX_PAGES = 99999

// 현재 쪽은 읽는 중·중단·포기에서만 바꿀 수 있다(그 외 409 progress_not_allowed).
export const canEditCurrentPage = (status: ReadingStatus) =>
  status === 'reading' || status === 'paused' || status === 'abandoned'

export const totalPagesOf = (book: ProgressFields) => book.total_pages ?? book.page_count

export type ProgressInput = { total: string; current: string; unit: 'page' | 'percent' }
type Book = ProgressFields & { status: ReadingStatus }

// 입력칸은 사용자가 정한 전체 쪽수와 저장된 현재 쪽(또는 서버 %)으로 채운다.
export function progressInputFrom(book: Book, unit: ProgressInput['unit'] = 'page'): ProgressInput {
  const current = unit === 'page' ? book.current_page : book.progress_percent
  return { total: book.total_pages === null ? '' : String(book.total_pages), current: current === null ? '' : String(current), unit }
}

const whole = (value: string) => (/^\d+$/.test(value) ? Number(value) : null)

// 입력 중인 전체 쪽수 기준(비우면 page_count). 잘못된 입력이면 null이다.
export function typedTotalOf(book: ProgressFields, totalInput: string) {
  const total = totalInput.trim()
  if (!total) return book.page_count
  const value = whole(total)
  return value !== null && value >= 1 && value <= MAX_PAGES ? value : null
}

// 바뀐 칸만 담는다. 빈칸은 저장된 값이 있을 때만 null(지우기)이다.
// %는 반영 후 전체 쪽수로 바꿔 보낸다. 서버가 %를 내림하므로 올림해야 입력한 %보다 낮게 보이지 않는다.
// 반영 후 값이 범위를 벗어나면 보내지 않는다.
export function buildProgressPatch(book: Book, input: ProgressInput):
  { patch: ProgressPatch } | { errors: Partial<Record<'total' | 'current', string>> } {
  const errors: Partial<Record<'total' | 'current', string>> = {}
  const patch: ProgressPatch = {}
  const initial = progressInputFrom(book, input.unit)

  const total = input.total.trim()
  if (total !== initial.total) {
    if (!total) patch.total_pages = null
    else {
      const value = whole(total)
      if (value === null || value < 1 || value > MAX_PAGES) errors.total = `전체 쪽수는 1~${MAX_PAGES} 사이 정수로 입력해주세요.`
      else patch.total_pages = value
    }
  }
  const nextTotal = patch.total_pages === undefined ? totalPagesOf(book) : patch.total_pages ?? book.page_count

  const current = input.current.trim()
  // %는 전체 쪽수에 따라 쪽이 달라지므로, 전체 쪽수를 바꾸면 그대로 둔 %도 새 기준으로 다시 보낸다.
  const rescale = input.unit === 'percent' && current !== '' && patch.total_pages !== undefined
  if (canEditCurrentPage(book.status) && (current !== initial.current || rescale)) {
    if (!current) patch.current_page = null
    else if (nextTotal === null) errors.current = '전체 쪽수를 먼저 입력해주세요.'
    else {
      const value = whole(current)
      if (input.unit === 'percent') {
        if (value === null || value > 100) errors.current = '0~100 사이 정수로 입력해주세요.'
        else patch.current_page = Math.ceil((value * nextTotal) / 100)
      } else if (value === null || value > nextTotal) errors.current = `현재 쪽은 0~${nextTotal} 사이 정수로 입력해주세요.`
      else patch.current_page = value
    }
  }

  // 완독은 서버가 현재 쪽을 새 전체 쪽수로 맞추므로 검사하지 않는다.
  if (!errors.total && !errors.current && canEditCurrentPage(book.status) && patch.current_page === undefined &&
      book.current_page !== null && (nextTotal === null || book.current_page > nextTotal)) {
    errors.total = nextTotal === null
      ? '전체 쪽수를 지우려면 현재 쪽도 함께 지워주세요.'
      : `현재 쪽(${book.current_page}쪽)보다 작게 바꾸려면 현재 쪽도 함께 고쳐주세요.`
  }
  return Object.keys(errors).length ? { errors } : { patch }
}
