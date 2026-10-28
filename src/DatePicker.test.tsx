// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import DatePicker from './DatePicker'

function Harness({ initial = '', onChange = vi.fn() }: { initial?: string; onChange?: (date: string) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <DatePicker
      label="시작일"
      value={value}
      max="2026-10-28"
      onChange={(date) => {
        setValue(date)
        onChange(date)
      }}
    />
  )
}

afterEach(cleanup)

test('값이 없으면 오늘(max)이 있는 달을 열고 미래 날짜는 고를 수 없다', () => {
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: /시작일 날짜 선택/ }))

  expect(screen.getByText('2026년 10월')).toBeTruthy()
  expect(screen.getByRole('button', { name: '2026년 10월 29일' })).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: '다음 달' })).toHaveProperty('disabled', true)
})

test('기존 값이 있으면 그 달을 열고 고른 날짜를 YYYY-MM-DD로 돌려준다', () => {
  const onChange = vi.fn()
  render(<Harness initial="2026-08-15" onChange={onChange} />)
  fireEvent.click(screen.getByRole('button', { name: /2026년 8월 15일/ }))

  expect(screen.getByRole('button', { name: '2026년 8월 15일' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: '2026년 8월 3일' }))

  expect(onChange).toHaveBeenCalledWith('2026-08-03')
  expect(screen.getByRole('button', { name: /시작일 2026년 8월 3일/ })).toBeTruthy()
})

test('화살표로 달을 넘어 이동하고 지우기는 빈 값으로 돌려준다', async () => {
  const onChange = vi.fn()
  render(<Harness initial="2026-10-01" onChange={onChange} />)
  fireEvent.click(screen.getByRole('button', { name: /2026년 10월 1일/ }))

  fireEvent.keyDown(screen.getByRole('button', { name: '2026년 10월 1일' }), { key: 'ArrowLeft' })
  await screen.findByText('2026년 9월')
  await waitFor(() => expect(document.activeElement?.getAttribute('data-date')).toBe('2026-09-30'))

  fireEvent.click(screen.getByRole('button', { name: '지우기' }))
  expect(onChange).toHaveBeenLastCalledWith('')
})

test('Esc로 닫고 날짜 버튼으로 포커스를 돌려준다', () => {
  render(<Harness initial="2026-10-01" />)
  const trigger = screen.getByRole('button', { name: /2026년 10월 1일/ })
  fireEvent.click(trigger)

  fireEvent.keyDown(screen.getByRole('button', { name: '2026년 10월 1일' }), { key: 'Escape' })
  expect(screen.queryByRole('group', { name: '시작일 달력' })).toBeNull()
  expect(document.activeElement).toBe(trigger)
})
