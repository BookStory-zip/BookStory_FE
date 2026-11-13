import { apiRequest } from './api'

export type PopularBook = {
  rank: number; daily_rank: number | null; monthly_rank: number | null
  isbn13: string; title: string; author: string | null; publisher: string | null
  thumbnail_url: string | null; source_url: string
}
export type PopularBooksSnapshot = {
  source: 'yes24'; collected_at: string | null; basis_date: string | null; monthly_basis: string | null
  items: PopularBook[]
}
export const POPULAR_MAX_AGE = 72 * 60 * 60 * 1000
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const nullableText = (value: unknown) => value === null || typeof value === 'string'
const rank = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 1
const nullableRank = (value: unknown) => value === null || rank(value)

function calendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function httpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password }
  catch { return false }
}

export function yes24Url(value: unknown): value is string {
  return httpsUrl(value) && ['yes24.com', 'www.yes24.com', 'm.yes24.com'].includes(new URL(value).hostname) && !new URL(value).port
}

export function discoverySource(state: unknown, isbn13: string): string | null {
  if (!object(state) || !object(state.discoverySource)) return null
  const source = state.discoverySource
  return source.isbn13 === isbn13 && yes24Url(source.source_url) ? source.source_url : null
}

function isBook(value: unknown, index: number): value is PopularBook {
  return object(value) && value.rank === index + 1 && nullableRank(value.daily_rank) && nullableRank(value.monthly_rank) &&
    typeof value.isbn13 === 'string' && /^\d{13}$/.test(value.isbn13) && typeof value.title === 'string' && !!value.title.trim() &&
    nullableText(value.author) && nullableText(value.publisher) && (value.thumbnail_url === null || httpsUrl(value.thumbnail_url)) && yes24Url(value.source_url)
}

export async function getPopularBooks(limit: 10 | 30 = 10): Promise<PopularBooksSnapshot> {
  const data = await apiRequest(`/discovery/popular?limit=${limit}`, null)
  if (!object(data) || data.source !== 'yes24' || !Array.isArray(data.items) || data.items.length > limit || !data.items.every(isBook) ||
    new Set(data.items.map((item: PopularBook) => item.isbn13)).size !== data.items.length) throw new Error('인기 도서 응답 형식이 올바르지 않습니다.')
  const empty = data.collected_at === null && data.basis_date === null && data.monthly_basis === null && data.items.length === 0
  if (!empty && !(typeof data.collected_at === 'string' && /(Z|[+-]\d{2}:\d{2})$/.test(data.collected_at) && Number.isFinite(Date.parse(data.collected_at)) &&
    calendarDate(data.basis_date) &&
    typeof data.monthly_basis === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(data.monthly_basis))) throw new Error('인기 도서 응답 형식이 올바르지 않습니다.')
  return data as PopularBooksSnapshot
}

export function isPopularFresh(data: PopularBooksSnapshot, now = Date.now()): boolean {
  return data.items.length > 0 && data.collected_at !== null && now - Date.parse(data.collected_at) <= POPULAR_MAX_AGE
}
