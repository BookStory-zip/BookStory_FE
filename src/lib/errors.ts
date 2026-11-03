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

// BE가 409·422에 붙이는 원인 코드별 안내. 영어 detail은 보여 주지 않는다.
const CODE_MESSAGES: Record<string, string> = {
  invalid_transition: '지금 상태에서는 이 상태로 바꿀 수 없습니다. 최신 상태를 확인해주세요.',
  // 상태 날짜와 달력·통계 조회 범위가 같은 코드를 쓴다.
  date_order: '날짜 순서가 올바르지 않습니다. 날짜를 확인해주세요.',
  future_date: '오늘 이후 날짜는 선택할 수 없어요.',
  date_too_old: '오늘을 포함한 최근 7일만 체크하거나 취소할 수 있어요.',
  ambiguous_dates: '날짜 입력이 겹쳤습니다. 다시 시도해주세요.',
  invalid_date_fields: '이 상태에서는 고른 날짜를 저장할 수 없습니다.',
  reading_check_not_allowed: '읽는 중인 책만 오늘 체크할 수 있습니다.',
  date_range: '조회 기간이 너무 깁니다. 366일 이내로 조회해주세요.',
  blank_query: '검색어를 입력해주세요.',
  validation_error: '입력값을 확인해주세요.',
  review_memo_required: '공개 후기를 남기려면 메모를 입력해주세요.',
  invalid_position: '책을 자기 자신 뒤로 옮길 수 없습니다. 순서를 다시 확인해주세요.',
}

export function codeMessage(error: unknown): string | undefined {
  return error instanceof ApiError && error.code ? CODE_MESSAGES[error.code] : undefined
}

// 화면 공통 안내. 404·409처럼 화면마다 뜻이 다른 상태는 호출하는 쪽에서 먼저 처리한다.
export function commonErrorMessage(error: unknown, failed: string): string {
  if (isAuthFailure(error)) return RELOGIN_MESSAGE
  if (isTimeout(error)) return '서버 응답이 없습니다. 잠시 후 다시 시도해주세요.'
  if (isNetworkFailure(error)) {
    return '서버에 연결하지 못했습니다. 네트워크를 확인하고 다시 시도해주세요.'
  }
  const byCode = codeMessage(error)
  if (byCode) return byCode
  if (error instanceof ApiError && error.status === 503) {
    return '서버가 잠시 응답할 수 없습니다. 잠시 후 다시 시도해주세요.'
  }
  if (error instanceof ApiError) return `${failed}. (${error.status})`
  return `${failed}. 잠시 후 다시 시도해주세요.`
}
