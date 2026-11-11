// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { ReadingNote } from './lib/api'
import NotePhoto from './NotePhoto'

const note = (patch: Partial<ReadingNote> = {}): ReadingNote => ({
  id: 'n1', user_book_id: 'b1', note_date: '2026-11-01', quote: null, thought: null, page: null,
  has_photo: true, photo_url: 'https://private.example/photo?signature=old',
  created_at: '', updated_at: '', ...patch,
})
afterEach(cleanup)

test('photo-only notes with unavailable URLs show retry, and notes without photos show nothing', () => {
  const { rerender, container } = render(<NotePhoto note={note({ photo_url: null })} onRefresh={vi.fn()} />)
  expect(screen.getByText('사진을 불러오지 못했어요')).toBeTruthy()
  expect(screen.getByRole('button', { name: '사진 다시 불러오기' })).toBeTruthy()
  rerender(<NotePhoto note={note({ has_photo: false, photo_url: null })} />)
  expect(container.textContent).toBe('')
})

test('automatically refreshes once, keeps failure after caught parent failure, permits manual retry', async () => {
  const refresh = vi.fn().mockResolvedValue(undefined)
  render(<NotePhoto note={note()} onRefresh={refresh} />)
  await act(async () => fireEvent.error(screen.getByRole('img')))
  expect(refresh).toHaveBeenCalledTimes(1)
  await act(async () => fireEvent.error(screen.getByRole('img')))
  expect(refresh).toHaveBeenCalledTimes(1)
  expect(screen.getByText('사진을 불러오지 못했어요')).toBeTruthy()
  await act(async () => fireEvent.click(screen.getByRole('button')))
  expect(refresh).toHaveBeenCalledTimes(2)
})

test('fresh URL failure does not loop; a successful load resets automatic recovery', async () => {
  const refresh = vi.fn().mockRejectedValue(new Error('unavailable'))
  const { rerender } = render(<NotePhoto note={note()} onRefresh={refresh} />)
  await act(async () => fireEvent.error(screen.getByRole('img')))
  rerender(<NotePhoto note={note({ photo_url: 'https://private.example/new' })} onRefresh={refresh} />)
  await act(async () => fireEvent.error(screen.getByRole('img')))
  expect(refresh).toHaveBeenCalledTimes(1)
  fireEvent.load(screen.getByRole('img'))
  expect(screen.queryByText('사진을 불러오지 못했어요')).toBeNull()
  await act(async () => fireEvent.error(screen.getByRole('img')))
  expect(refresh).toHaveBeenCalledTimes(2)
})

test('blocks requests, prevents duplicate in-flight retries, and safely finishes after unmount', async () => {
  let finish!: () => void
  const refresh = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
  const { rerender, unmount } = render(<NotePhoto note={note()} onRefresh={refresh} blocked />)
  fireEvent.error(screen.getByRole('img'))
  fireEvent.click(screen.getByRole('button'))
  expect(refresh).not.toHaveBeenCalled()
  rerender(<NotePhoto note={note()} onRefresh={refresh} />)
  fireEvent.click(screen.getByRole('button'))
  fireEvent.error(screen.getByRole('img'))
  expect(refresh).toHaveBeenCalledTimes(1)
  unmount()
  await act(async () => finish())
})

test('new note resets recovery and uses private image attributes', async () => {
  const refresh = vi.fn().mockResolvedValue(undefined)
  const { rerender } = render(<NotePhoto note={note()} onRefresh={refresh} />)
  const image = screen.getByRole('img')
  expect(image.getAttribute('alt')).toBe('독서 노트 첨부 사진')
  expect(image.getAttribute('loading')).toBe('lazy')
  expect(image.getAttribute('referrerpolicy')).toBe('no-referrer')
  await act(async () => fireEvent.error(image))
  rerender(<NotePhoto note={note({ id: 'n2' })} onRefresh={refresh} />)
  expect(screen.queryByText('사진을 불러오지 못했어요')).toBeNull()
  await act(async () => fireEvent.error(screen.getByRole('img')))
  expect(refresh).toHaveBeenCalledTimes(2)
})
