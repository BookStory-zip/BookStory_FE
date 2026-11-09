// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import OrderHandle from './OrderHandle'

afterEach(cleanup)

function pointer(button: HTMLElement, type: string, isPrimary = true) {
  const event = new Event(type, { bubbles: true })
  Object.assign(event, { pointerType: 'touch', pointerId: 1, isPrimary, button: 0, clientX: 10, clientY: 10 })
  fireEvent(button, event)
}

test('보조 손가락이나 취소된 터치로 이동 메뉴를 열지 않는다', () => {
  render(<OrderHandle label="책" previous next disabled={false} onMove={vi.fn()} />)
  const handle = screen.getByRole('button', { name: '책 이동 손잡이' })
  pointer(handle, 'pointerdown', false)
  pointer(handle, 'pointerup', false)
  expect(screen.queryByRole('group', { name: '책 이동' })).toBeNull()
  pointer(handle, 'pointerdown')
  pointer(handle, 'pointercancel')
  pointer(handle, 'pointerup')
  expect(screen.queryByRole('group', { name: '책 이동' })).toBeNull()
})

test('터치 후 click은 중복 토글하지 않고 스크린리더 click으로도 메뉴를 쓴다', () => {
  const move = vi.fn()
  render(<OrderHandle label="책" previous next disabled={false} onMove={move} />)
  const handle = screen.getByRole('button', { name: '책 이동 손잡이' })
  pointer(handle, 'pointerdown')
  pointer(handle, 'pointerup')
  fireEvent.click(screen.getByRole('button', { name: '책 뒤로' }), { detail: 1 })
  expect(move).not.toHaveBeenCalled()
  expect(screen.getByRole('group', { name: '책 이동' })).toBeTruthy()
  const next = screen.getByRole('button', { name: '책 뒤로' })
  pointer(next, 'pointerdown')
  pointer(next, 'pointerup')
  fireEvent.click(next, { detail: 1 })
  expect(move).toHaveBeenCalledWith(1)
  fireEvent.click(handle, { detail: 0 })
  fireEvent.keyDown(screen.getByRole('button', { name: '책 앞으로' }), { key: 'Escape' })
  expect(document.activeElement).toBe(handle)
  fireEvent.click(handle, { detail: 0 })
  fireEvent.click(screen.getByRole('button', { name: '책 뒤로' }))
  expect(move).toHaveBeenCalledWith(1)
  expect(screen.queryByRole('group', { name: '책 이동' })).toBeNull()
})

test('Safari처럼 메뉴 버튼 탭이 포커스를 바깥 조상으로 옮겨도 이동 명령을 받는다', () => {
  const move = vi.fn()
  render(<div tabIndex={-1} data-testid="outer"><OrderHandle label="책" previous next disabled={false} onMove={move} /></div>)
  fireEvent.click(screen.getByRole('button', { name: '책 이동 손잡이' }), { detail: 0 })
  fireEvent.focusOut(screen.getByRole('button', { name: '책 앞으로' }), { relatedTarget: screen.getByTestId('outer') })
  fireEvent.click(screen.getByRole('button', { name: '책 뒤로' }), { detail: 0 })
  expect(move).toHaveBeenCalledWith(1)
})
