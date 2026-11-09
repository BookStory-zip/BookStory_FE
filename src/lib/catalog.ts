import { apiRequest } from './api'

export type CatalogBook = {
  isbn13: string
  title: string
  authors: string[]
  publisher: string | null
  published_date: string | null
  thumbnail_url: string | null
  description: string | null
  source_url: string
  // 국립중앙도서관 쪽수. 모르면 null.
  page_count: number | null
  reviews: { total_reviews: number; rating_count: number; average_rating: number | null }
}

export type PublicReview = {
  id: string
  author_name: string
  memo: string
  rating: number | null
  published_at: string
  updated_at: string
  is_mine: boolean
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const nonblank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const count = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0
const rating = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 5
const timestamp = (value: unknown) => nonblank(value) && Number.isFinite(Date.parse(value))

export async function getCatalogBook(isbn13: string): Promise<CatalogBook> {
  const data = await apiRequest(`/books/${encodeURIComponent(isbn13)}`, null)
  if (!object(data) || data.isbn13 !== isbn13 || !nonblank(data.title) ||
      !Array.isArray(data.authors) || !data.authors.every((author) => typeof author === 'string') ||
      !['publisher', 'published_date', 'thumbnail_url', 'description'].every((key) => data[key] === null || typeof data[key] === 'string') ||
      !nonblank(data.source_url) || !object(data.reviews) ||
      !(data.page_count === null || (Number.isInteger(data.page_count) && Number(data.page_count) >= 1))) {
    throw new Error('책 정보 응답 형식이 올바르지 않습니다.')
  }
  const { total_reviews, rating_count, average_rating } = data.reviews
  if (!count(total_reviews) || !count(rating_count) || rating_count > total_reviews ||
      (rating_count === 0 ? average_rating !== null : !rating(average_rating))) {
    throw new Error('책 정보 응답 형식이 올바르지 않습니다.')
  }
  return data as CatalogBook
}

export async function getPublicReviews(token: string, isbn13: string, limit: number, offset: number): Promise<PublicReview[]> {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  const data = await apiRequest(`/books/${encodeURIComponent(isbn13)}/reviews?${query}`, token)
  if (!Array.isArray(data) || !data.every((item: unknown) => object(item) &&
      nonblank(item.id) && nonblank(item.author_name) && nonblank(item.memo) &&
      (item.rating === null || (rating(item.rating) && Number.isInteger(item.rating))) &&
      timestamp(item.published_at) && timestamp(item.updated_at) && typeof item.is_mine === 'boolean')) {
    throw new Error('후기 응답 형식이 올바르지 않습니다.')
  }
  return data
}
