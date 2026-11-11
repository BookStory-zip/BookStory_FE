import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js'
import { expect, test, vi } from 'vitest'
import { ApiError, ApiResponseError } from './api'
import { SessionMissingError } from './auth'
import { commonErrorMessage, isAuthFailure, isUnclearWrite } from './errors'

vi.mock('./supabase', () => ({ supabase: { auth: {} } }))

test('응답 해석 실패만 불명확한 결과이며 세션 없음·사진 저장소 거절은 아니다', () => {
  expect(isUnclearWrite(new ApiResponseError('invalid metadata'))).toBe(true)
  expect(isUnclearWrite(new SessionMissingError())).toBe(false)
  expect(isUnclearWrite(new ApiError(503, '', 'photo_storage_unavailable'))).toBe(false)
})

test('세션 갱신 중 연결 실패는 다시 로그인 안내가 아니라 연결 안내다', () => {
  const error = new AuthRetryableFetchError('Failed to fetch', 0)
  expect(isAuthFailure(error)).toBe(false)
  expect(commonErrorMessage(error, '불러오지 못했습니다')).toContain('서버에 연결하지 못했습니다')
})

test('세션 없음·갱신 거절·401은 다시 로그인 안내다', () => {
  for (const error of [new SessionMissingError(), new AuthApiError('invalid', 400, 'refresh_token_not_found'), new ApiError(401)]) {
    expect(commonErrorMessage(error, '불러오지 못했습니다')).toContain('다시 로그인')
  }
})

test('시간 초과는 반영 여부를 알 수 없는 쓰기로 보고 안내한다', () => {
  const timeout = new DOMException('signal timed out', 'TimeoutError')
  expect(isUnclearWrite(timeout)).toBe(true)
  expect(commonErrorMessage(timeout, '불러오지 못했습니다')).toContain('서버 응답이 없습니다')
})

test('최근 7일 범위 오류를 한국어로 안내한다', () => {
  expect(commonErrorMessage(new ApiError(422, '', 'date_too_old'), '실패')).toBe('오늘을 포함한 최근 7일만 체크하거나 취소할 수 있어요.')
})
