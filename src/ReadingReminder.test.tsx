// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ApiError } from './lib/api'
import ReadingReminder from './ReadingReminder'

const push = vi.hoisted(() => ({ getReminderState: vi.fn(), enableReminder: vi.fn(), setReminderEnabled: vi.fn() }))
vi.mock('./lib/push', () => push)
vi.mock('./lib/supabase', () => ({ supabase: { auth: {} } }))

beforeEach(() => {
  vi.resetAllMocks()
  push.getReminderState.mockResolvedValue({ enabled: false, device: 'permission' })
})
afterEach(cleanup)

test.each([
  ['unsupported', 'iOS 16.4 이상'],
  ['denied', '브라우저 설정에서'],
])('%s 기기에서도 계정 전체 알림 설정을 바꿀 수 있다', async (device, note) => {
  push.getReminderState.mockResolvedValue({ enabled: true, device })
  push.setReminderEnabled.mockResolvedValue({ enabled: false, device })
  render(<ReadingReminder />)
  expect(await screen.findByText(new RegExp(note))).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '알림 끄기', pressed: true }))
  expect(await screen.findByRole('button', { name: '알림 켜기', pressed: false })).toBeTruthy()
  expect(push.setReminderEnabled).toHaveBeenCalledWith(false, expect.any(Function))
  expect(push.enableReminder).not.toHaveBeenCalled()
})

test('계정 켜기와 기기 권한 요청은 별도 버튼으로 동작한다', async () => {
  push.setReminderEnabled.mockResolvedValue({ enabled: true, device: 'permission' })
  push.enableReminder.mockResolvedValue({ enabled: true, device: 'on' })
  render(<ReadingReminder />)
  fireEvent.click(await screen.findByRole('button', { name: '알림 켜기' }))
  const permission = await screen.findByRole('button', { name: '이 기기 알림 허용' })
  expect(push.enableReminder).not.toHaveBeenCalled()
  fireEvent.click(permission)
  expect(await screen.findByText('이 기기에서 알림을 받을 수 있어요.')).toBeTruthy()
  expect(push.enableReminder).toHaveBeenCalledTimes(1)
})

test('설정 조회 실패를 꺼짐으로 표시하지 않고 재조회만 제공한다', async () => {
  push.getReminderState.mockRejectedValueOnce(new ApiError(503))
  render(<ReadingReminder />)
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '알림 켜기' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '다시 확인' }))
  expect(await screen.findByRole('button', { name: '알림 켜기' })).toBeTruthy()
})

test('설정 저장 결과가 불명확하면 재전송 없이 실제 값을 재조회한다', async () => {
  push.setReminderEnabled.mockRejectedValue(new TypeError('Failed to fetch'))
  push.getReminderState.mockResolvedValueOnce({ enabled: false, device: 'permission' }).mockResolvedValue({ enabled: true, device: 'permission' })
  render(<ReadingReminder />)
  fireEvent.click(await screen.findByRole('button', { name: '알림 켜기' }))
  expect(await screen.findByRole('button', { name: '알림 끄기', pressed: true })).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toContain('현재 설정을 다시 확인했습니다')
  expect(push.setReminderEnabled).toHaveBeenCalledTimes(1)
})

test('저장 후 재조회도 실패하면 설정을 추측하지 않고 재확인을 요구한다', async () => {
  push.getReminderState.mockResolvedValueOnce({ enabled: false, device: 'permission' }).mockRejectedValue(new ApiError(503))
  push.setReminderEnabled.mockRejectedValue(new ApiError(503))
  render(<ReadingReminder />)
  fireEvent.click(await screen.findByRole('button', { name: '알림 켜기' }))
  expect(await screen.findByRole('button', { name: '다시 확인' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '알림 켜기' })).toBeNull()
})

test('기기 등록 실패 후에도 계정이 켜져 있음을 보여 주고 기기만 다시 연결한다', async () => {
  push.getReminderState.mockResolvedValue({ enabled: true, device: 'off' })
  push.enableReminder.mockRejectedValue(new DOMException('push service error', 'AbortError'))
  render(<ReadingReminder />)
  fireEvent.click(await screen.findByRole('button', { name: '이 기기 연결' }))
  expect((await screen.findByRole('alert')).textContent).toContain('알림을 등록하지 못했어요')
  expect(screen.getByRole('button', { name: '알림 끄기', pressed: true })).toBeTruthy()
})

test('계정 탈퇴 중에는 설정을 변경하거나 권한을 요청하지 못한다', async () => {
  push.getReminderState.mockResolvedValue({ enabled: true, device: 'permission' })
  render(<ReadingReminder disabled />)
  expect(await screen.findByRole('button', { name: '알림 끄기' })).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: '이 기기 알림 허용' })).toHaveProperty('disabled', true)
})
