import { apiRequest } from './api'

export type District = { code: string; name: string }
export type Region = District & { districts: District[] }
export type OnlineStore = { store: string; name: string; url: string }
export type HoldingLibrary = {
  lib_code: string; name: string; address: string
  tel: string | null; homepage: string | null; operating_time: string | null; closed: string | null
  loan_available: boolean | null
}
export type BookAvailability = { online: OnlineStore[]; district: District | null; libraries: HoldingLibrary[] | null }
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim()
const nullableText = (value: unknown) => value === null || typeof value === 'string'
const district = (value: unknown): value is District => object(value) && text(value.code) && text(value.name)
function link(value: unknown, httpsOnly = false): value is string {
  if (!text(value)) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || (!httpsOnly && url.protocol === 'http:')) && !url.username && !url.password
  } catch { return false }
}
function library(value: unknown): value is HoldingLibrary {
  return object(value) && text(value.lib_code) && text(value.name) && typeof value.address === 'string' &&
    ['tel', 'operating_time', 'closed'].every(key => nullableText(value[key])) &&
    (value.homepage === null || link(value.homepage)) && (value.loan_available === null || typeof value.loan_available === 'boolean')
}

export async function getRegions(): Promise<Region[]> {
  const data = await apiRequest('/regions', null)
  const codes = new Set<string>()
  if (!Array.isArray(data) || !data.every(item => {
    if (!object(item) || !Array.isArray(item.districts)) return false
    const districts = item.districts
    if (!district(item)) return false
    return districts.every((value: unknown) => {
      if (!district(value) || codes.has(value.code)) return false
      codes.add(value.code)
      return true
    })
  }) || new Set(data.map(item => item.code)).size !== data.length) throw new Error('지역 목록 응답을 확인하지 못했습니다.')
  return data as Region[]
}

export async function getBookAvailability(isbn13: string, districtCode?: string): Promise<BookAvailability> {
  const query = districtCode ? `?${new URLSearchParams({ district: districtCode })}` : ''
  const data = await apiRequest(`/books/${encodeURIComponent(isbn13)}/where${query}`, null)
  if (!object(data) || !Array.isArray(data.online) ||
    !data.online.every(item => object(item) && text(item.store) && text(item.name) && link(item.url, true)) ||
    new Set(data.online.map(item => item.store)).size !== data.online.length ||
    (districtCode ? !district(data.district) || data.district.code !== districtCode : data.district !== null) ||
    !(data.libraries === null || (Array.isArray(data.libraries) && data.libraries.every(library) &&
      new Set(data.libraries.map(item => item.lib_code)).size === data.libraries.length)) ||
    (!districtCode && (!Array.isArray(data.libraries) || data.libraries.length !== 0))) throw new Error('구매·대출 응답을 확인하지 못했습니다.')
  return data as BookAvailability
}
