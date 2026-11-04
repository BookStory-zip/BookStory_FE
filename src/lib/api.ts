import { kstDateOf } from './record'

export class ApiError extends Error {
  status: number
  // BE가 409·422·429·5xx에 붙이는 원인 코드(예: invalid_transition). 없으면 undefined.
  code?: string
  // 429의 Retry-After(초). 숫자가 아니면 undefined.
  retryAfter?: number

  constructor(status: number, detail?: string, code?: string, retryAfter?: number) {
    super(detail ?? `요청에 실패했습니다. (${status})`)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.retryAfter = retryAfter
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

type RequestOptions = { method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown }

export async function apiRequest(
  path: string,
  accessToken: string | null,
  options: RequestOptions = {},
): Promise<unknown> {
  return (await apiRequestWithStatus(path, accessToken, options)).data
}

// accessToken이 null이면 공개 API로 인증 헤더 없이 요청한다.
// 성공 코드로 뜻이 갈리는 API(등록 201·200)를 위해 상태 코드도 돌려준다.
export async function apiRequestWithStatus(
  path: string,
  accessToken: string | null,
  options: RequestOptions = {},
): Promise<{ status: number; data: unknown }> {
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
    const code =
      typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string'
        ? body.code
        : undefined
    // 비어 있는 헤더를 0초로 읽지 않는다.
    const retryHeader = response.headers.get('Retry-After')?.trim()
    const retryAfter = retryHeader ? Number(retryHeader) : NaN
    throw new ApiError(response.status, readDetail(body), code, Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : undefined)
  }

  if (response.status === 204) return { status: 204, data: null }
  return { status: response.status, data: await response.json() }
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

// 검색·상태 조건은 서버가 함께 적용한다. 정렬은 저장된 서재 순서이고 전체 개수는 없다.
export type LibraryFilter = { q?: string; field?: 'title' | 'author'; status?: ReadingStatus }

export async function getLibraryBooks(
  accessToken: string,
  limit: number,
  offset: number,
  filter: LibraryFilter = {},
): Promise<LibraryBookItem[]> {
  const query = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  })
  // 검색어를 지우면 q를 빼고 보낸다(공백만 있는 q는 422). 기준은 검색어가 있을 때만 의미가 있다.
  if (filter.q) {
    query.set('q', filter.q)
    if (filter.field) query.set('field', filter.field)
  }
  // 필터를 모르는 서버는 전체를 돌려줄 수 있으므로 체크 편집기는 화면에서도 상태를 거른다.
  if (filter.status) query.set('status', filter.status)
  const data = await apiRequest(`/library/books?${query}`, accessToken)

  if (!Array.isArray(data) || !data.every(isLibraryBookItem)) {
    throw new Error('서재 응답 형식이 올바르지 않습니다.')
  }

  return data
}

const ISBN13_PATTERN = /^97[89][0-9]{10}$/
// 카카오 검색은 한 페이지 10개, 최대 50페이지까지 요청할 수 있다.
export const SEARCH_LAST_PAGE = 50

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

export async function searchBooks(
  query: string,
  page = 1,
): Promise<{ books: SearchBook[]; isEnd: boolean }> {
  const params = new URLSearchParams({ query, page: String(page) })
  const data = await apiRequest(`/books/search?${params}`, null)

  if (
    typeof data !== 'object' ||
    data === null ||
    !('documents' in data) ||
    !Array.isArray(data.documents)
  ) {
    throw new Error('검색 응답 형식이 올바르지 않습니다.')
  }

  // 등록용 isbn13은 BE가 고른 값을 쓰고, 공급자 표시 값의 누락·null·빈 문자열만 정리한다.
  const books = data.documents
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
      isbn13:
        typeof item.isbn13 === 'string' && ISBN13_PATTERN.test(item.isbn13) ? item.isbn13 : null,
    }))
  const meta = 'meta' in data && typeof data.meta === 'object' && data.meta !== null ? data.meta : {}
  // is_end가 없으면 더 보기를 막아 존재하지 않는 페이지를 반복 요청하지 않는다.
  const isEnd = !('is_end' in meta) || meta.is_end !== false
  return { books, isEnd }
}

export async function addLibraryBook(
  accessToken: string,
  isbn13: string,
): Promise<{ id: string; status: ReadingStatus; created: boolean }> {
  const { status: httpStatus, data } = await apiRequestWithStatus('/library/books', accessToken, {
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

  // 새로 담으면 201, 이미 서재에 있으면 기존 기록과 함께 200이 온다.
  return { id: data.id, status: data.status as ReadingStatus, created: httpStatus === 201 }
}

export type LibraryBookDetail = LibraryBookItem & {
  publisher: string | null
  published_date: string | null
  description: string | null
  source_url: string
  started_at: string | null
  last_read_at: string | null
  last_read_date: string | null
  completed_at: string | null
  stopped_at: string | null
  stop_reason: string | null
  rating: number | null
  memo: string | null
  is_review_public: boolean
  review_published_at: string | null
  review_updated_at: string | null
  has_completed: boolean
  updated_at: string
  // 지금 요청할 수 있는 상태(현재 상태 재요청 포함). 날짜 검증은 요청 시점에 서버가 따로 한다.
  allowed_statuses: ReadingStatus[]
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
    (item.last_read_date === null || (typeof item.last_read_date === 'string' && DATE_PATTERN.test(item.last_read_date))) &&
    ['review_published_at', 'review_updated_at'].every((key) => item[key] === null ||
      (typeof item[key] === 'string' && Number.isFinite(Date.parse(item[key])))) &&
    typeof item.source_url === 'string' &&
    (item.rating === null ||
      (Number.isInteger(item.rating) && Number(item.rating) >= 1 && Number(item.rating) <= 5)) &&
    typeof item.has_completed === 'boolean' &&
    typeof item.is_review_public === 'boolean' &&
    typeof item.updated_at === 'string' &&
    Array.isArray(item.allowed_statuses) &&
    item.allowed_statuses.every((status) => readingStatuses.includes(status as ReadingStatus))
  )
}

const libraryBookPath = (userBookId: string) =>
  `/library/books/${encodeURIComponent(userBookId)}`

export async function moveLibraryBook(
  accessToken: string,
  userBookId: string,
  afterUserBookId: string | null,
): Promise<void> {
  await apiRequest(`${libraryBookPath(userBookId)}/position`, accessToken, {
    method: 'PATCH',
    body: { after_user_book_id: afterUserBookId },
  })
}

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

export async function getLibraryBookByIsbn(
  accessToken: string,
  isbn13: string,
): Promise<LibraryBookDetail | null> {
  try {
    const data = await apiRequest(`/library/books/by-isbn/${encodeURIComponent(isbn13)}`, accessToken)
    if (!isLibraryBookDetail(data) || data.isbn13 !== isbn13) {
      throw new Error('책 상세 응답 형식이 올바르지 않습니다.')
    }
    return data
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

// 날짜는 YYYY-MM-DD로 보내고 BE가 한국 시간으로 해석한다(시작 00:00, 완독 23:59:59, 오늘 완독은 지금).
export type StatusChange = {
  status: ReadingStatus
  started_date?: string
  completed_date?: string
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
  is_review_public?: boolean
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
  return checkReadingDate(accessToken, userBookId, 'today')
}

export async function checkReadingDate(
  accessToken: string,
  userBookId: string,
  readDate: string,
): Promise<ReadingLog> {
  const data = await apiRequest(`${libraryBookPath(userBookId)}/reading-logs/${encodeURIComponent(readDate)}`, accessToken, {
    method: 'PUT',
  })
  if (!isReadingLog(data) || data.user_book_id !== userBookId || (readDate !== 'today' && data.read_date !== readDate)) {
    throw new Error('독서 체크 응답 형식이 올바르지 않습니다.')
  }
  return data
}

// 오늘 기록이 없어도, 상태가 무엇이든 204로 성공한다.
export async function cancelReadingToday(
  accessToken: string,
  userBookId: string,
): Promise<void> {
  return cancelReadingDate(accessToken, userBookId, 'today')
}

export async function cancelReadingDate(
  accessToken: string,
  userBookId: string,
  readDate: string,
): Promise<void> {
  await apiRequest(`${libraryBookPath(userBookId)}/reading-logs/${encodeURIComponent(readDate)}`, accessToken, {
    method: 'DELETE',
  })
}

export const READING_LOG_PAGE_SIZE = 100

// 기간 조회는 100건씩 나뉘므로 마지막 페이지까지 모두 가져온다.
async function getAllPages<T>(
  path: string,
  accessToken: string,
  startDate: string,
  endDate: string,
  isItem: (value: unknown) => value is T,
  invalid: string,
): Promise<T[]> {
  const items: T[] = []
  for (let offset = 0; ; offset += READING_LOG_PAGE_SIZE) {
    const query = new URLSearchParams({
      start_date: startDate,
      end_date: endDate,
      limit: String(READING_LOG_PAGE_SIZE),
      offset: String(offset),
    })
    const page = await apiRequest(`${path}?${query}`, accessToken)
    if (!Array.isArray(page) || !page.every(isItem)) throw new Error(invalid)
    items.push(...page)
    if (page.length < READING_LOG_PAGE_SIZE) return items
  }
}

export function getReadingLogs(
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<ReadingLogEntry[]> {
  return getAllPages('/reading-logs', accessToken, startDate, endDate, isReadingLogEntry, '독서 기록 응답 형식이 올바르지 않습니다.')
}

// 완독일이 알려진 완독. 체크 기록과 별개이며 재독·상태 변경 후에도 저장된 완독일을 돌려준다.
export type ReadingCompletion = {
  user_book_id: string
  book_id: string
  title: string
  authors: string[]
  thumbnail_url: string | null
  status: ReadingStatus
  completed_at: string
  completed_date: string
}

function isReadingCompletion(value: unknown): value is ReadingCompletion {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.user_book_id === 'string' &&
    typeof item.book_id === 'string' &&
    typeof item.title === 'string' &&
    Array.isArray(item.authors) &&
    item.authors.every((author) => typeof author === 'string') &&
    isNullableString(item.thumbnail_url) &&
    readingStatuses.includes(item.status as ReadingStatus) &&
    typeof item.completed_at === 'string' &&
    typeof item.completed_date === 'string' &&
    DATE_PATTERN.test(item.completed_date)
  )
}

export function getReadingCompletions(
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<ReadingCompletion[]> {
  return getAllPages('/reading-completions', accessToken, startDate, endDate, isReadingCompletion, '완독 기록 응답 형식이 올바르지 않습니다.')
}

export type ReadingStatistics = {
  library: {
    total_books: number
    status_counts: Record<ReadingStatus, number>
    completed_books: number
  }
  period: {
    year: number
    month: number | null
    start_date: string
    end_date: string
    reading_days: number
    reading_minutes: number
    goals: GoalProgress[]
  }
}

export const goalMetrics = ['reading_days', 'completed_books', 'reading_minutes'] as const
export type GoalMetric = (typeof goalMetrics)[number]
// month null은 연 목표다. 빠뜨리면 422이므로 선택 속성으로 두지 않는다.
export type GoalKey = { metric: GoalMetric; year: number; month: number | null }
// target 0은 목표 꺼짐. 한 번도 정하지 않은 지표는 goals에서 빠진다.
export type GoalProgress = { metric: GoalMetric; target: number; current: number; source: 'set' | 'inherited' | 'sum' }

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

// inherited는 월 응답, sum은 연 응답에만 나온다. 응답 target에는 입력 상한을 적용하지 않는다.
function isGoalProgress(value: unknown, yearly: boolean): value is GoalProgress {
  if (typeof value !== 'object' || value === null) return false
  const goal = value as Record<string, unknown>
  return goalMetrics.includes(goal.metric as GoalMetric) && isCount(goal.target) && isCount(goal.current) &&
    (goal.source === 'set' || goal.source === (yearly ? 'sum' : 'inherited'))
}

function isReadingStatistics(value: unknown): value is ReadingStatistics {
  if (typeof value !== 'object' || value === null) return false
  const { library, period } = value as Record<string, unknown>
  if (typeof library !== 'object' || library === null ||
      typeof period !== 'object' || period === null) return false
  const shelf = library as Record<string, unknown>
  const selected = period as Record<string, unknown>
  const counts = shelf.status_counts
  return (
    isCount(shelf.total_books) && isCount(shelf.completed_books) &&
    typeof counts === 'object' && counts !== null &&
    readingStatuses.every((status) => isCount((counts as Record<string, unknown>)[status])) &&
    typeof selected.year === 'number' && Number.isInteger(selected.year) &&
    (selected.month === null || (typeof selected.month === 'number' && Number.isInteger(selected.month))) &&
    typeof selected.start_date === 'string' && DATE_PATTERN.test(selected.start_date) &&
    typeof selected.end_date === 'string' && DATE_PATTERN.test(selected.end_date) &&
    isCount(selected.reading_days) && isCount(selected.reading_minutes) &&
    Array.isArray(selected.goals) && selected.goals.every((goal) => isGoalProgress(goal, selected.month === null))
  )
}

export async function getReadingStatistics(
  accessToken: string,
  year: number,
  month?: number,
): Promise<ReadingStatistics> {
  const query = new URLSearchParams({ year: String(year) })
  if (month !== undefined) query.set('month', String(month))
  const data = await apiRequest(`/me/statistics?${query}`, accessToken)
  if (!isReadingStatistics(data) || data.period.year !== year || data.period.month !== (month ?? null)) {
    throw new Error('통계 응답 형식이 올바르지 않습니다.')
  }
  return data
}

// 같은 기간에 다시 보내면 덮어쓴다. 0은 그 기간부터 목표를 끈다.
export async function updateGoal(accessToken: string, body: GoalKey & { target: number }): Promise<void> {
  await apiRequest('/me/goals', accessToken, { method: 'PUT', body })
}

// 월은 이전 달 목표를 다시 이어받고, 연은 월 목표 합계로 돌아간다. 대상이 없어도 204다.
export async function deleteGoal(accessToken: string, body: GoalKey): Promise<void> {
  await apiRequest('/me/goals', accessToken, { method: 'DELETE', body })
}

// 공개 후기에 표시할 닉네임. null이면 공통 이름 '독서가'로 표시된다.
function readNickname(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || !('nickname' in data) || (data.nickname !== null && typeof data.nickname !== 'string')) {
    throw new Error('프로필 응답 형식이 올바르지 않습니다.')
  }
  return data.nickname
}

export async function getProfile(accessToken: string): Promise<string | null> {
  return readNickname(await apiRequest('/me/profile', accessToken))
}

export async function updateNickname(accessToken: string, nickname: string | null): Promise<string | null> {
  return readNickname(await apiRequest('/me/profile', accessToken, { method: 'PATCH', body: { nickname } }))
}

// 로그인 후 5분 이내 토큰만 받는다(403 recent_login_required). 여러 번 보내도 안전하다.
export async function deleteMe(accessToken: string): Promise<void> {
  await apiRequest('/me', accessToken, { method: 'DELETE' })
}

export type ReadingSessionInput = { client_session_id: string; started_at: string; duration_seconds: number }
export type ReadingSession = ReadingSessionInput & { id: string; user_book_id: string; read_date: string; created_at: string }

function isReadingSession(value: unknown, userBookId: string): value is ReadingSession {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  if (typeof item.started_at !== 'string' || !Number.isFinite(Date.parse(item.started_at))) return false
  const date = kstDateOf(item.started_at)
  return typeof item.id === 'string' && item.user_book_id === userBookId &&
    typeof item.client_session_id === 'string' && typeof item.created_at === 'string' &&
    Number.isFinite(Date.parse(item.created_at)) && item.read_date === date &&
    typeof item.duration_seconds === 'number' && Number.isInteger(item.duration_seconds) &&
    item.duration_seconds >= 60 && item.duration_seconds <= 3600
}

export async function saveReadingSession(accessToken: string, userBookId: string, body: ReadingSessionInput): Promise<ReadingSession> {
  const data = await apiRequest(`${libraryBookPath(userBookId)}/reading-sessions`, accessToken, { method: 'POST', body })
  if (!isReadingSession(data, userBookId) || data.client_session_id !== body.client_session_id ||
    Date.parse(data.started_at) !== Date.parse(body.started_at) || data.duration_seconds !== body.duration_seconds) {
    throw new Error('시간 기록 응답 형식이 올바르지 않습니다.')
  }
  return data
}

export async function getReadingSessions(accessToken: string, userBookId: string, limit: number, offset: number): Promise<ReadingSession[]> {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  const data = await apiRequest(`${libraryBookPath(userBookId)}/reading-sessions?${query}`, accessToken)
  if (!Array.isArray(data) || !data.every((item) => isReadingSession(item, userBookId))) throw new Error('시간 기록 응답 형식이 올바르지 않습니다.')
  return data
}

export async function deleteReadingSession(accessToken: string, sessionId: string): Promise<void> {
  await apiRequest(`/reading-sessions/${encodeURIComponent(sessionId)}`, accessToken, { method: 'DELETE' })
}

// 비공개 독서 노트. 공개 후기 memo와 별개이며 저장해도 독서 체크를 만들지 않는다.
export type NoteInput = { note_date: string; quote: string | null; thought: string | null; page: number | null }
export type ReadingNote = NoteInput & { id: string; user_book_id: string; created_at: string; updated_at: string }
export type ReadingNoteEntry = ReadingNote & { title: string; authors: string[]; thumbnail_url: string | null }

const NOTE_INVALID = '노트 응답 형식이 올바르지 않습니다.'

function isReadingNote(value: unknown): value is ReadingNote {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return typeof item.id === 'string' && typeof item.user_book_id === 'string' &&
    typeof item.note_date === 'string' && DATE_PATTERN.test(item.note_date) &&
    isNullableString(item.quote) && isNullableString(item.thought) && (item.quote !== null || item.thought !== null) &&
    (item.page === null || (Number.isInteger(item.page) && Number(item.page) >= 1)) &&
    typeof item.created_at === 'string' && typeof item.updated_at === 'string'
}

function isReadingNoteEntry(value: unknown): value is ReadingNoteEntry {
  if (!isReadingNote(value)) return false
  const item = value as Record<string, unknown>
  return typeof item.title === 'string' && Array.isArray(item.authors) &&
    item.authors.every((author) => typeof author === 'string') && isNullableString(item.thumbnail_url)
}

function readNote(data: unknown, userBookId?: string): ReadingNote {
  if (!isReadingNote(data) || (userBookId !== undefined && data.user_book_id !== userBookId)) throw new Error(NOTE_INVALID)
  return data
}

export async function createReadingNote(accessToken: string, userBookId: string, body: NoteInput): Promise<ReadingNote> {
  return readNote(await apiRequest(`${libraryBookPath(userBookId)}/notes`, accessToken, { method: 'POST', body }), userBookId)
}

export async function getReadingNotes(accessToken: string, userBookId: string, limit: number, offset: number): Promise<ReadingNote[]> {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  const data = await apiRequest(`${libraryBookPath(userBookId)}/notes?${query}`, accessToken)
  if (!Array.isArray(data) || !data.every((item) => isReadingNote(item) && item.user_book_id === userBookId)) throw new Error(NOTE_INVALID)
  return data
}

// 생략한 항목은 유지되고 null로 보낸 항목은 지워진다. note_date는 null로 보내지 않는다.
export async function updateReadingNote(accessToken: string, noteId: string, patch: Partial<NoteInput>): Promise<ReadingNote> {
  return readNote(await apiRequest(`/notes/${encodeURIComponent(noteId)}`, accessToken, { method: 'PATCH', body: patch }))
}

export async function deleteReadingNote(accessToken: string, noteId: string): Promise<void> {
  await apiRequest(`/notes/${encodeURIComponent(noteId)}`, accessToken, { method: 'DELETE' })
}

// 기간(최대 366일)의 모든 책 노트. note_date·created_at·id 내림차순의 평평한 목록이다.
export async function getNoteTimeline(accessToken: string, startDate: string, endDate: string, limit: number, offset: number): Promise<ReadingNoteEntry[]> {
  const query = new URLSearchParams({ start_date: startDate, end_date: endDate, limit: String(limit), offset: String(offset) })
  const data = await apiRequest(`/notes?${query}`, accessToken)
  if (!Array.isArray(data) || !data.every(isReadingNoteEntry)) throw new Error(NOTE_INVALID)
  return data
}

// 발송 키가 설정되지 않은 서버는 503을 돌려준다.
export async function getPushPublicKey(): Promise<string> {
  const data = await apiRequest('/push/public-key', null)
  if (typeof data !== 'object' || data === null || !('public_key' in data) || typeof data.public_key !== 'string' || !data.public_key) {
    throw new Error('알림 키 응답 형식이 올바르지 않습니다.')
  }
  return data.public_key
}

export type PushSubscriptionBody = { endpoint: string; keys: { p256dh: string; auth: string } }

// 같은 endpoint를 다시 보내면 키만 갱신되므로 반복 등록해도 안전하다.
export async function savePushSubscription(accessToken: string, body: PushSubscriptionBody): Promise<void> {
  await apiRequest('/me/push-subscriptions', accessToken, { method: 'PUT', body })
}

// 본인 구독이 아니거나 이미 없어도 204다.
export async function deletePushSubscription(accessToken: string, endpoint: string): Promise<void> {
  await apiRequest('/me/push-subscriptions', accessToken, { method: 'DELETE', body: { endpoint } })
}
