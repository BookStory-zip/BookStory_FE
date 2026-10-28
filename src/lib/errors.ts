import { isAuthError, isAuthRetryableFetchError } from '@supabase/supabase-js'
import { ApiError } from './api'
import { SessionMissingError } from './auth'

export const isTimeout = (error: unknown) =>
  error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')

// 연결 실패·시간 초과·SDK의 재시도 가능 오류는 인증 실패가 아니라 연결 문제다.
export const isNetworkFailure = (error: unknown) =>
  error instanceof TypeError || isTimeout(error) || isAuthRetryableFetchError(error)

export const isAuthFailure = (error: unknown) =>
  !isNetworkFailure(error) &&
  (error instanceof SessionMissingError ||
    isAuthError(error) ||
    (error instanceof ApiError && error.status === 401))

// 서버에 반영됐는지 알 수 없는 쓰기 실패. 다시 보내지 않고 서버 상태를 확인한다.
export const isUnclearWrite = (error: unknown) =>
  error instanceof TypeError ||
  isTimeout(error) ||
  (error instanceof ApiError && (error.status === 502 || error.status === 504))

export const RELOGIN_MESSAGE = '로그인 정보를 확인할 수 없습니다. 다시 로그인해주세요.'

// 화면 공통 안내. 404·409처럼 화면마다 뜻이 다른 상태는 호출하는 쪽에서 먼저 처리한다.
export function commonErrorMessage(error: unknown, failed: string): string {
  if (isAuthFailure(error)) return RELOGIN_MESSAGE
  if (isTimeout(error)) return '서버 응답이 없습니다. 잠시 후 다시 시도해주세요.'
  if (isNetworkFailure(error)) {
    return '서버에 연결하지 못했습니다. 네트워크를 확인하고 다시 시도해주세요.'
  }
  if (error instanceof ApiError && error.status === 503) {
    return '서버가 잠시 응답할 수 없습니다. 잠시 후 다시 시도해주세요.'
  }
  if (error instanceof ApiError) return `${failed}. (${error.status})`
  return `${failed}. 잠시 후 다시 시도해주세요.`
}
