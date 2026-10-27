export class ApiError extends Error {
  status: number

  constructor(status: number, detail?: string) {
    super(detail ?? `요청에 실패했습니다. (${status})`)
    this.name = 'ApiError'
    this.status = status
  }
}

// FastAPI detail은 문자열 또는 검증 오류 배열이다.
function readDetail(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('detail' in body)) {
    return undefined
  }
  const { detail } = body
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item: unknown) =>
        typeof item === 'object' && item !== null && 'msg' in item
          ? String(item.msg)
          : '',
      )
      .filter(Boolean)
    return messages.length ? messages.join(' ') : undefined
  }
  return undefined
}

// accessToken이 null이면 공개 API로 인증 헤더 없이 요청한다.
export async function apiRequest(
  path: string,
  accessToken: string | null,
  options: { method?: 'POST'; body?: unknown } = {},
): Promise<unknown> {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL

  if (!apiBaseUrl) {
    throw new Error('API 주소 설정이 필요합니다.')
  }

  const headers: Record<string, string> = {}
  if (accessToken !== null) headers.Authorization = `Bearer ${accessToken}`
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers,
    ...(options.method && { method: options.method }),
    ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
  })

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    throw new ApiError(response.status, readDetail(body))
  }

  if (response.status === 204) return null
  return response.json()
}

export async function getMe(
  accessToken: string,
): Promise<{ user_id: string }> {
  const data = await apiRequest('/me', accessToken)

  if (
    typeof data !== 'object' ||
    data === null ||
    !('user_id' in data) ||
    typeof data.user_id !== 'string' ||
    data.user_id.trim().length === 0
  ) {
    throw new Error('사용자 확인 응답 형식이 올바르지 않습니다.')
  }

  return { user_id: data.user_id }
}

export const readingStatuses = [
  'want_to_read',
  'reading',
  'completed',
  'paused',
  'abandoned',
] as const

export type ReadingStatus = (typeof readingStatuses)[number]

export const statusLabels: Record<ReadingStatus, string> = {
  want_to_read: '읽고 싶음',
  reading: '읽는 중',
  completed: '완독',
  paused: '중단',
  abandoned: '포기',
}

export type LibraryBookItem = {
  id: string
  book_id: string
  isbn13: string
  title: string
  authors: string[]
  thumbnail_url: string | null
  status: ReadingStatus
  created_at: string
}

function isLibraryBookItem(value: unknown): value is LibraryBookItem {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    typeof item.book_id === 'string' &&
    typeof item.isbn13 === 'string' &&
    typeof item.title === 'string' &&
    Array.isArray(item.authors) &&
    item.authors.every((author) => typeof author === 'string') &&
    (item.thumbnail_url === null || typeof item.thumbnail_url === 'string') &&
    readingStatuses.includes(item.status as ReadingStatus) &&
    typeof item.created_at === 'string'
  )
}

export async function getLibraryBooks(
  accessToken: string,
  limit: number,
  offset: number,
): Promise<LibraryBookItem[]> {
  const query = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  })
  const data = await apiRequest(`/library/books?${query}`, accessToken)

  if (!Array.isArray(data) || !data.every(isLibraryBookItem)) {
    throw new Error('서재 응답 형식이 올바르지 않습니다.')
  }

  return data
}

const ISBN13_PATTERN = /^97[89][0-9]{10}$/

// 공급자 isbn은 "ISBN10 ISBN13"처럼 공백으로 이어질 수 있다. ISBN13이 없으면 null.
export function pickIsbn13(isbn: unknown): string | null {
  if (typeof isbn !== 'string') return null
  return isbn.split(/\s+/).find((part) => ISBN13_PATTERN.test(part)) ?? null
}

export type SearchBook = {
  title: string
  authors: string[]
  publisher: string
  thumbnail: string | null
  isbn13: string | null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function searchBooks(query: string): Promise<SearchBook[]> {
  const params = new URLSearchParams({ query })
  const data = await apiRequest(`/books/search?${params}`, null)

  if (
    typeof data !== 'object' ||
    data === null ||
    !('documents' in data) ||
    !Array.isArray(data.documents)
  ) {
    throw new Error('검색 응답 형식이 올바르지 않습니다.')
  }

  // 공급자 데이터의 누락·null·빈 문자열을 화면에서 쓰기 전에 정리한다.
  return data.documents
    .filter((item: unknown): item is Record<string, unknown> =>
      typeof item === 'object' && item !== null,
    )
    .map((item) => ({
      title: text(item.title),
      authors: Array.isArray(item.authors)
        ? item.authors.map(text).filter(Boolean)
        : [],
      publisher: text(item.publisher),
      thumbnail: text(item.thumbnail) || null,
      isbn13: pickIsbn13(item.isbn),
    }))
}

export async function addLibraryBook(
  accessToken: string,
  isbn13: string,
): Promise<{ id: string; status: ReadingStatus }> {
  const data = await apiRequest('/library/books', accessToken, {
    method: 'POST',
    body: { isbn13 },
  })

  if (
    typeof data !== 'object' ||
    data === null ||
    !('id' in data) ||
    typeof data.id !== 'string' ||
    !('status' in data) ||
    !readingStatuses.includes(data.status as ReadingStatus)
  ) {
    throw new Error('서재 등록 응답 형식이 올바르지 않습니다.')
  }

  return { id: data.id, status: data.status as ReadingStatus }
}
