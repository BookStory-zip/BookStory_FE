// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError } from './lib/api'
import ReviewSettings from './ReviewSettings'

const api = vi.hoisted(() => ({ getReviewSettings: vi.fn(), updateReviewSettings: vi.fn() }))
vi.mock('./lib/api', async (original) => ({ ...await original<typeof import('./lib/api')>(), ...api }))
vi.mock('./lib/auth', async (original) => ({ ...await original<typeof import('./lib/auth')>(), withAccessToken: (call: (token: string) => unknown) => call('token') }))
vi.mock('./lib/supabase', () => ({ supabase: { auth: {} } }))
beforeEach(() => { vi.resetAllMocks(); api.getReviewSettings.mockResolvedValue(false); api.updateReviewSettings.mockResolvedValue(undefined) })
afterEach(cleanup)

test('기존 후기까지 함께 공개함을 안내하고 계정 설정 하나로 켜고 끈다', async () => {
  render(<ReviewSettings />)
  expect(screen.getByText(/이전에 작성한 내용을 포함/)).toBeTruthy()
  fireEvent.click(await screen.findByRole('button', { name: '후기·별점 공개 켜기' }))
  expect(await screen.findByRole('button', { name: '후기·별점 공개 끄기', pressed: true })).toBeTruthy()
  expect(api.updateReviewSettings).toHaveBeenCalledWith('token', true)
  fireEvent.click(screen.getByRole('button', { name: '후기·별점 공개 끄기' }))
  expect(await screen.findByRole('button', { name: '후기·별점 공개 켜기', pressed: false })).toBeTruthy()
  expect(api.updateReviewSettings).toHaveBeenLastCalledWith('token', false)
})

test('조회 실패를 비공개로 해석하지 않고 다시 확인한다', async () => {
  api.getReviewSettings.mockRejectedValueOnce(new ApiError(503))
  render(<ReviewSettings />)
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '후기·별점 공개 켜기' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '다시 확인' }))
  expect(await screen.findByRole('button', { name: '후기·별점 공개 켜기' })).toBeTruthy()
})

test('응답을 잃으면 자동 재전송하지 않고 서버 공개 설정을 다시 읽는다', async () => {
  api.getReviewSettings.mockResolvedValueOnce(false).mockResolvedValue(true)
  api.updateReviewSettings.mockRejectedValue(new TypeError('Failed to fetch'))
  render(<ReviewSettings />)
  fireEvent.click(await screen.findByRole('button', { name: '후기·별점 공개 켜기' }))
  expect(await screen.findByRole('button', { name: '후기·별점 공개 끄기' })).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toContain('현재 설정을 다시 확인했습니다')
  expect(api.updateReviewSettings).toHaveBeenCalledTimes(1)
})

test('저장 후 재조회도 실패하면 재확인 전 추가 공개 변경을 막는다', async () => {
  api.getReviewSettings.mockResolvedValueOnce(false).mockRejectedValue(new ApiError(503))
  api.updateReviewSettings.mockRejectedValue(new TypeError('Failed to fetch'))
  render(<ReviewSettings />)
  fireEvent.click(await screen.findByRole('button', { name: '후기·별점 공개 켜기' }))
  expect(await screen.findByRole('button', { name: '다시 확인' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /공개 켜기/ })).toBeNull()
})

test('계정을 떠난 뒤 늦게 실패한 저장은 새 계정 설정을 재조회하지 않는다', async () => {
  let fail!: (error: unknown) => void
  api.updateReviewSettings.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject }))
  const view = render(<ReviewSettings />)
  fireEvent.click(await screen.findByRole('button', { name: '후기·별점 공개 켜기' }))
  view.unmount()
  await act(async () => fail(new TypeError('Failed to fetch')))
  expect(api.getReviewSettings).toHaveBeenCalledTimes(1)
})

test('탈퇴 처리 중에는 공개 설정을 변경할 수 없다', async () => {
  render(<ReviewSettings disabled />)
  expect(await screen.findByRole('button', { name: '후기·별점 공개 켜기' })).toHaveProperty('disabled', true)
})

test('StrictMode의 이전 조회가 늦게 끝나도 저장한 공개 설정을 덮지 않는다', async () => {
  let finish!: (enabled: boolean) => void
  api.getReviewSettings.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve })).mockResolvedValue(false)
  render(<StrictMode><ReviewSettings /></StrictMode>)
  fireEvent.click(await screen.findByRole('button', { name: '후기·별점 공개 켜기' }))
  await screen.findByRole('button', { name: '후기·별점 공개 끄기' })
  await act(async () => finish(false))
  expect(screen.getByRole('button', { name: '후기·별점 공개 끄기', pressed: true })).toBeTruthy()
})
