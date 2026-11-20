import { apiRequest } from './api'

const REGION_KEY = 'bookstory:last-library-district'
export function savedDistrict(userId: string): string {
  try {
    localStorage.removeItem(REGION_KEY)
    return localStorage.getItem(`${REGION_KEY}:${userId}`) ?? ''
  } catch { return '' }
}
export function rememberDistrict(userId: string, code: string) {
  const key = `${REGION_KEY}:${userId}`
  try {
    localStorage.removeItem(REGION_KEY)
    if (code) localStorage.setItem(key, code); else localStorage.removeItem(key)
  } catch { /* 지역 기억 실패가 조회를 막지 않는다. */ }
}

export type District = { code: string; name: string }
export type Region = District & { districts: District[] }
export type OnlineStore = { store: string; name: string; url: string }
export type HoldingLibrary = {
  lib_code: string; name: string; address: string | null
  tel: string | null; homepage: string | null; operating_time: string | null; closed: string | null
  loan_available: boolean | null
}
export type BookAvailability = { online: OnlineStore[]; district: District | null; libraries: HoldingLibrary[] | null }
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim()
const optionalText = (value: unknown): string | null => text(value) ? value : null
const district = (value: unknown): value is District => object(value) && text(value.code) && text(value.name)
function link(value: unknown, httpsOnly = false): value is string {
  if (!text(value)) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || (!httpsOnly && url.protocol === 'http:')) && !url.username && !url.password
  } catch { return false }
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
    (districtCode ? !district(data.district) || data.district.code !== districtCode : data.district !== null) ||
    !(data.libraries === null || Array.isArray(data.libraries)) ||
    (!districtCode && (!Array.isArray(data.libraries) || data.libraries.length !== 0))) throw new Error('구매·대출 응답을 확인하지 못했습니다.')
  const online: OnlineStore[] = []
  const stores = new Set<string>()
  for (const item of data.online) {
    if (!object(item) || !text(item.store) || !text(item.name) || !link(item.url, true) || stores.has(item.store)) continue
    stores.add(item.store)
    online.push({ store: item.store, name: item.name, url: item.url })
  }
  let libraries: HoldingLibrary[] | null = null
  if (Array.isArray(data.libraries)) {
    const valid: HoldingLibrary[] = []
    const codes = new Set<string>()
    for (const item of data.libraries) {
      if (!object(item) || !text(item.lib_code) || !text(item.name) || codes.has(item.lib_code)) continue
      codes.add(item.lib_code)
      valid.push({
        lib_code: item.lib_code, name: item.name,
        address: optionalText(item.address), tel: optionalText(item.tel),
        operating_time: optionalText(item.operating_time), closed: optionalText(item.closed),
        homepage: link(item.homepage) ? item.homepage : null,
        loan_available: typeof item.loan_available === 'boolean' ? item.loan_available : null,
      })
    }
    // 잘못된 행만 받은 경우 소장 도서관이 없다고 단정하지 않는다.
    libraries = data.libraries.length > 0 && valid.length === 0 ? null : valid
  }
  return { online, district: data.district as District | null, libraries }
}
