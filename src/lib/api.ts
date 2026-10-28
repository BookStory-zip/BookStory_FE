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

export const REQUEST_TIMEOUT_MS = 60_000

// accessToken이 null이면 공개 API로 인증 헤더 없이 요청한다.
export async function apiRequest(
  path: string,
  accessToken: string | null,
  options: { method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown } = {},
): Promise<unknown> {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL

  if (!apiBaseUrl) {
    throw new Error('API 주소 설정이 필요합니다.')
  }

  const headers: Record<string, string> = {}
  if (accessToken !== null) headers.Authorization = `Bearer ${accessToken}`
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  // Render 기동 지연을 기다리되, 응답이 끝나지 않는 요청이 화면을 영원히 잠그지 않게 한다.
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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

export type LibraryBookDetail = LibraryBookItem & {
  publisher: string | null
  published_date: string | null
  description: string | null
  source_url: string
  started_at: string | null
  last_read_at: string | null
  completed_at: string | null
  stopped_at: string | null
  stop_reason: string | null
  rating: number | null
  memo: string | null
  has_completed: boolean
  updated_at: string
}

function isNullableString(value: unknown) {
  return value === null || typeof value === 'string'
}

function isLibraryBookDetail(value: unknown): value is LibraryBookDetail {
  if (!isLibraryBookItem(value)) return false
  const item = value as Record<string, unknown>
  return (
    [
      'publisher',
      'published_date',
      'description',
      'started_at',
      'last_read_at',
      'completed_at',
      'stopped_at',
      'stop_reason',
      'memo',
    ].every((key) => isNullableString(item[key])) &&
    typeof item.source_url === 'string' &&
    (item.rating === null ||
      (Number.isInteger(item.rating) && Number(item.rating) >= 1 && Number(item.rating) <= 5)) &&
    typeof item.has_completed === 'boolean' &&
    typeof item.updated_at === 'string'
  )
}

const libraryBookPath = (userBookId: string) =>
  `/library/books/${encodeURIComponent(userBookId)}`

export async function getLibraryBook(
  accessToken: string,
  userBookId: string,
): Promise<LibraryBookDetail> {
  const data = await apiRequest(libraryBookPath(userBookId), accessToken)
  if (!isLibraryBookDetail(data)) {
    throw new Error('책 상세 응답 형식이 올바르지 않습니다.')
  }
  return data
}

export type StatusChange = {
  status: ReadingStatus
  started_at?: string
  completed_at?: string
}

// 작은 변경 응답으로 상세를 덮지 않도록 성공 여부만 반환하고, 화면은 상세를 다시 조회한다.
export async function updateLibraryStatus(
  accessToken: string,
  userBookId: string,
  change: StatusChange,
): Promise<void> {
  await apiRequest(`${libraryBookPath(userBookId)}/status`, accessToken, {
    method: 'PATCH',
    body: change,
  })
}

export type RecordPatch = {
  rating?: number | null
  memo?: string | null
  stop_reason?: string | null
}

export async function updateLibraryRecord(
  accessToken: string,
  userBookId: string,
  patch: RecordPatch,
): Promise<void> {
  await apiRequest(`${libraryBookPath(userBookId)}/record`, accessToken, {
    method: 'PATCH',
    body: patch,
  })
}

export async function deleteLibraryBook(
  accessToken: string,
  userBookId: string,
): Promise<void> {
  await apiRequest(libraryBookPath(userBookId), accessToken, { method: 'DELETE' })
}

export type ReadingLog = {
  id: string
  user_book_id: string
  read_date: string
  created_at: string
}

export type ReadingLogEntry = ReadingLog & {
  book_id: string
  title: string
  authors: string[]
  thumbnail_url: string | null
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function isReadingLog(value: unknown): value is ReadingLog {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    typeof item.user_book_id === 'string' &&
    typeof item.read_date === 'string' &&
    DATE_PATTERN.test(item.read_date) &&
    typeof item.created_at === 'string'
  )
}

function isReadingLogEntry(value: unknown): value is ReadingLogEntry {
  if (!isReadingLog(value)) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.book_id === 'string' &&
    typeof item.title === 'string' &&
    Array.isArray(item.authors) &&
    item.authors.every((author) => typeof author === 'string') &&
    isNullableString(item.thumbnail_url)
  )
}

// 오늘 날짜는 서버가 한국 시간으로 정한다. 이미 체크했으면 기존 기록이 그대로 온다.
export async function checkReadingToday(
  accessToken: string,
  userBookId: string,
): Promise<ReadingLog> {
  const data = await apiRequest(`${libraryBookPath(userBookId)}/reading-logs/today`, accessToken, {
    method: 'PUT',
  })
  if (!isReadingLog(data)) {
    throw new Error('독서 체크 응답 형식이 올바르지 않습니다.')
  }
  return data
}

// 오늘 기록이 없어도, 상태가 무엇이든 204로 성공한다.
export async function cancelReadingToday(
  accessToken: string,
  userBookId: string,
): Promise<void> {
  await apiRequest(`${libraryBookPath(userBookId)}/reading-logs/today`, accessToken, {
    method: 'DELETE',
  })
}

export const READING_LOG_PAGE_SIZE = 100

// 한 달 기록도 100건을 넘을 수 있으므로 마지막 페이지까지 모두 가져온다.
export async function getReadingLogs(
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<ReadingLogEntry[]> {
  const logs: ReadingLogEntry[] = []
  for (let offset = 0; ; offset += READING_LOG_PAGE_SIZE) {
    const query = new URLSearchParams({
      start_date: startDate,
      end_date: endDate,
      limit: String(READING_LOG_PAGE_SIZE),
      offset: String(offset),
    })
    const page = await apiRequest(`/reading-logs?${query}`, accessToken)
    if (!Array.isArray(page) || !page.every(isReadingLogEntry)) {
      throw new Error('독서 기록 응답 형식이 올바르지 않습니다.')
    }
    logs.push(...page)
    if (page.length < READING_LOG_PAGE_SIZE) return logs
  }
}
