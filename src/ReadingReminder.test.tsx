// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ApiError } from './lib/api'
import ReadingReminder from './ReadingReminder'

const push = vi.hoisted(() => ({ getReminderState: vi.fn(), enableReminder: vi.fn(), disableReminder: vi.fn() }))
vi.mock('./lib/push', () => push)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

test.each([
  ['unsupported', 'iOS 16.4 이상에서 BookStory를 홈 화면에 추가한 뒤'],
  ['denied', '브라우저 설정에서 이 사이트의 알림을 허용해주세요'],
])('%s 상태는 버튼 대신 안내만 보여 준다', async (state, note) => {
  push.getReminderState.mockResolvedValue(state)
  render(<ReadingReminder />)
  expect(await screen.findByText(new RegExp(note))).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
})

test('켜기가 503이면 로그아웃 없이 다시 시도할 수 있는 안내를 보여 준다', async () => {
  push.getReminderState.mockResolvedValue('off')
  push.enableReminder.mockRejectedValue(new ApiError(503))
  render(<ReadingReminder />)
  fireEvent.click(await screen.findByRole('button', { name: '알림 켜기' }))
  expect((await screen.findByRole('alert')).textContent).toBe('지금은 알림을 사용할 수 없어요. 잠시 후 다시 시도해주세요.')
  expect(screen.getByRole('button', { name: '알림 켜기' })).toHaveProperty('disabled', false)
})

test('푸시 서비스가 구독을 실패시키면(AbortError) 시간 초과가 아닌 등록 실패로 안내한다', async () => {
  push.getReminderState.mockResolvedValue('off')
  push.enableReminder.mockRejectedValue(new DOMException('push service error', 'AbortError'))
  render(<ReadingReminder />)
  fireEvent.click(await screen.findByRole('button', { name: '알림 켜기' }))
  expect((await screen.findByRole('alert')).textContent).toBe('알림을 등록하지 못했어요. 잠시 후 다시 시도해주세요.')
})

test('켜고 끄면 서버 결과에 따라 버튼 상태가 바뀐다', async () => {
  push.getReminderState.mockResolvedValue('off')
  push.enableReminder.mockResolvedValue('on')
  push.disableReminder.mockResolvedValue(undefined)
  render(<ReadingReminder />)
  fireEvent.click(await screen.findByRole('button', { name: '알림 켜기' }))
  fireEvent.click(await screen.findByRole('button', { name: '알림 끄기', pressed: true }))
  expect(await screen.findByRole('button', { name: '알림 켜기', pressed: false })).toBeTruthy()
  expect(push.disableReminder).toHaveBeenCalledTimes(1)
})
