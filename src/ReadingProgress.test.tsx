// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { LibraryBookDetail } from './lib/api'
import ReadingProgress from './ReadingProgress'

const book: LibraryBookDetail = {
  id: 'own-a', book_id: 'common-a', isbn13: '9788936433598', title: '소년이 온다', authors: ['한강'],
  thumbnail_url: null, status: 'reading', created_at: '2026-10-01T00:00:00Z',
  page_count: 301, total_pages: null, current_page: 120, progress_percent: 39,
  publisher: null, published_date: null, description: null, source_url: 'https://example.test',
  started_at: null, last_read_at: null, last_read_date: null, completed_at: null,
  stopped_at: null, stop_reason: null, rating: null, memo: null, is_review_public: false,
  review_published_at: null, review_updated_at: null, has_completed: false,
  updated_at: '2026-10-01T00:00:00Z', allowed_statuses: ['reading', 'completed'], shelves: [], past_log_range: null,
}

function setup(overrides: Partial<LibraryBookDetail> = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined)
  const onNoChange = vi.fn()
  const current = { ...book, ...overrides }
  const view = render(<ReadingProgress book={current} busy={false} saving={false} onSave={onSave} onNoChange={onNoChange} />)
  return { ...view, current, onSave, onNoChange }
}

afterEach(cleanup)

test('도서 쪽수는 읽기 전용으로 보이고 현재 쪽만 바꾸면 전체 쪽수를 보내지 않는다', () => {
  const { onSave, onNoChange } = setup()
  expect(screen.getByLabelText('전체 쪽수')).toHaveProperty('value', '301')
  expect(screen.getByLabelText('전체 쪽수')).toHaveProperty('readOnly', true)
  fireEvent.click(screen.getByRole('button', { name: '진도 저장' }))
  expect(onNoChange).toHaveBeenCalledOnce()
  expect(onSave).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('현재 쪽'), { target: { value: '150' } })
  fireEvent.click(screen.getByRole('button', { name: '진도 저장' }))
  expect(onSave).toHaveBeenCalledWith({ current_page: 150 })
})

test('직접 수정하면 기존 개인 쪽수를 편집하고 새 쪽수로 %를 환산한다', () => {
  const { onSave } = setup({ total_pages: 320 })
  expect(screen.getByLabelText('전체 쪽수')).toHaveProperty('value', '320')
  expect(screen.getByLabelText('전체 쪽수')).toHaveProperty('readOnly', true)
  fireEvent.click(screen.getByRole('button', { name: '직접 수정' }))
  expect(document.activeElement).toBe(screen.getByLabelText('전체 쪽수'))
  expect(screen.getByLabelText('전체 쪽수')).toHaveProperty('value', '320')
  expect(screen.getByLabelText('전체 쪽수')).toHaveProperty('readOnly', false)
  fireEvent.change(screen.getByLabelText('전체 쪽수'), { target: { value: '333' } })
  fireEvent.click(screen.getByRole('radio', { name: '%' }))
  fireEvent.change(screen.getByLabelText('현재 진도(%)'), { target: { value: '50' } })
  fireEvent.click(screen.getByRole('button', { name: '진도 저장' }))
  expect(onSave).toHaveBeenCalledWith({ total_pages: 333, current_page: 167 })
})

test('공급자 쪽수가 없으면 저장된 개인 쪽수도 계속 편집할 수 있다', () => {
  const { onSave } = setup({ page_count: null, total_pages: 320 })
  expect(screen.getByLabelText('전체 쪽수')).toHaveProperty('readOnly', false)
  expect(screen.getByText('페이지 정보를 직접 입력해주세요.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '직접 수정' })).toBeNull()
  fireEvent.change(screen.getByLabelText('전체 쪽수'), { target: { value: '350' } })
  fireEvent.click(screen.getByRole('button', { name: '진도 저장' }))
  expect(onSave).toHaveBeenCalledWith({ total_pages: 350 })
})

test('도서 쪽수를 처음 수정할 때 표시되던 값에서 시작하며 비우면 공급자 값으로 돌아간다', () => {
  const { onSave, onNoChange } = setup()
  fireEvent.click(screen.getByRole('button', { name: '직접 수정' }))
  expect(screen.getByLabelText('전체 쪽수')).toHaveProperty('value', '301')
  fireEvent.click(screen.getByRole('button', { name: '진도 저장' }))
  expect(onNoChange).toHaveBeenCalledOnce()
  fireEvent.change(screen.getByLabelText('전체 쪽수'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: '진도 저장' }))
  expect(onSave).not.toHaveBeenCalled()
})

test('잘못된 쪽수는 범위를 안내하고 서버 값이 바뀌지 않은 저장 뒤에는 수정 입력을 보존한다', () => {
  const { rerender, current, onSave, onNoChange } = setup()
  fireEvent.click(screen.getByRole('button', { name: '직접 수정' }))
  fireEvent.change(screen.getByLabelText('전체 쪽수'), { target: { value: '100000' } })
  fireEvent.click(screen.getByRole('button', { name: '진도 저장' }))
  expect(screen.getByText('전체 쪽수는 1~99999 사이 정수로 입력해주세요.')).toBeTruthy()
  expect(onSave).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('전체 쪽수'), { target: { value: '400' } })
  fireEvent.click(screen.getByRole('button', { name: '진도 저장' }))
  expect(onSave).toHaveBeenCalledWith({ total_pages: 400 })
  rerender(<ReadingProgress book={current} busy saving onSave={onSave} onNoChange={onNoChange} />)
  rerender(<ReadingProgress book={current} busy={false} saving={false} onSave={onSave} onNoChange={onNoChange} />)
  expect(screen.getByLabelText('전체 쪽수')).toHaveProperty('value', '400')
  expect(screen.getByLabelText('전체 쪽수')).toHaveProperty('readOnly', false)
})

test.each([100, 87])('진도는 서버 값(%s)을 표시하고 완독의 현재 쪽이 없으면 전체 쪽수를 쓴다', (progress_percent) => {
  setup({ status: 'completed', total_pages: 320, current_page: null, progress_percent })
  expect(screen.getByText(`${progress_percent}%`)).toBeTruthy()
  expect(screen.getByText('· 320/320쪽')).toBeTruthy()
  expect(screen.queryByLabelText('현재 쪽')).toBeNull()
})

test('쪽수 정보가 없는 책에도 잘못된 입력을 생략하지 않고 검증한다', () => {
  const { onSave, onNoChange } = setup({ page_count: null, total_pages: null, current_page: null, progress_percent: null })
  fireEvent.change(screen.getByLabelText('전체 쪽수'), { target: { value: 'null' } })
  fireEvent.click(screen.getByRole('button', { name: '진도 저장' }))
  expect(screen.getByText('전체 쪽수는 1~99999 사이 정수로 입력해주세요.')).toBeTruthy()
  expect(onSave).not.toHaveBeenCalled()
  expect(onNoChange).not.toHaveBeenCalled()
})

test('전체 쪽수를 모르는 완독 책에 쪽수나 진도를 만들어 표시하지 않는다', () => {
  setup({ status: 'completed', total_pages: null, page_count: null, current_page: null, progress_percent: null })
  expect(screen.queryByRole('progressbar')).toBeNull()
  expect(screen.queryByText('100%')).toBeNull()
})
