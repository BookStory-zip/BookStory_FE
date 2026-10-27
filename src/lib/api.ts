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

export async function apiRequest(
  path: string,
  accessToken: string,
): Promise<unknown> {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL

  if (!apiBaseUrl) {
    throw new Error('API 주소 설정이 필요합니다.')
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
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
