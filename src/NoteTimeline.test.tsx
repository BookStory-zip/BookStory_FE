// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ReadingNoteEntry } from './lib/api'
import NoteTimeline from './NoteTimeline'

const mocks = vi.hoisted(() => ({ getNoteTimeline: vi.fn() }))
vi.mock('./lib/api', () => mocks)
vi.mock('./lib/auth', () => ({ withAccessToken: (request: (token: string) => Promise<unknown>) => request('test-token') }))
vi.mock('./ReadingNotes', () => ({ NoteText: ({ note, onRefresh }: { note: ReadingNoteEntry; onRefresh: () => Promise<void> }) =>
  <button onClick={() => void onRefresh()}>{note.id}:{note.photo_url}</button>,
}))

const note = (index: number): ReadingNoteEntry => ({
  id: `n${index}`, user_book_id: 'b1', note_date: '2026-11-01', quote: null, thought: null, page: null,
  has_photo: true, photo_url: 'old', created_at: '', updated_at: '', title: '책', authors: [], thumbnail_url: null,
})
beforeEach(() => vi.resetAllMocks())
afterEach(cleanup)
const timeline = (month = '2026-11') => <MemoryRouter><NoteTimeline month={month} today="2026-11-11" onMove={vi.fn()} /></MemoryRouter>

test('refreshes a resident note after 100 without dropping loaded notes', async () => {
  let items = Array.from({ length: 121 }, (_, index) => note(index))
  mocks.getNoteTimeline.mockImplementation((_token, _start, _end, limit: number, offset: number) => Promise.resolve(items.slice(offset, offset + limit)))
  render(timeline())
  await screen.findByRole('button', { name: 'n19:old' })
  for (let index = 1; index <= 5; index++) {
    fireEvent.click(screen.getByRole('button', { name: '노트 더 보기' }))
    await screen.findByRole('button', { name: `n${index * 20 + 19}:old` })
  }
  items = items.map((item) => item.id === 'n119' ? { ...item, photo_url: 'fresh' } : item)
  fireEvent.click(screen.getByRole('button', { name: 'n119:old' }))
  await screen.findByRole('button', { name: 'n119:fresh' })
  expect(screen.getByRole('button', { name: 'n0:old' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'n100:old' })).toBeTruthy()
  expect(mocks.getNoteTimeline).toHaveBeenLastCalledWith('test-token', '2026-11-01', '2026-11-30', 100, 100)
})

test('reconciles a deleted target without removing another loaded note', async () => {
  mocks.getNoteTimeline.mockResolvedValueOnce([note(1), note(2)]).mockResolvedValueOnce([note(2)])
  render(timeline())
  fireEvent.click(await screen.findByRole('button', { name: 'n1:old' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'n1:old' })).toBeNull())
  expect(screen.getByRole('button', { name: 'n2:old' })).toBeTruthy()
})

test('ignores a photo refresh that finishes after the month changes', async () => {
  let finish!: (notes: ReadingNoteEntry[]) => void
  mocks.getNoteTimeline.mockResolvedValueOnce([note(1)])
    .mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    .mockResolvedValueOnce([{ ...note(1), photo_url: 'october', note_date: '2026-10-01' }])
  const { rerender } = render(timeline())
  fireEvent.click(await screen.findByRole('button', { name: 'n1:old' }))
  rerender(timeline('2026-10'))
  await screen.findByRole('button', { name: 'n1:october' })
  await act(async () => finish([{ ...note(1), photo_url: 'stale' }]))
  expect(screen.getByRole('button', { name: 'n1:october' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'n1:stale' })).toBeNull()
})
