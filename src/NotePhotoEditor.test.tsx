// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import NotePhotoEditor from './NotePhotoEditor'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

test('편집 확정 전에는 사진을 넘기지 않고 취소 시 원본을 보존한다', () => {
  URL.createObjectURL = vi.fn(() => 'blob:editor')
  URL.revokeObjectURL = vi.fn()
  const confirm = vi.fn(), cancel = vi.fn()
  const { unmount } = render(<NotePhotoEditor file={new File(['x'], 'note.jpg', { type: 'image/jpeg' })} onConfirm={confirm} onCancel={cancel} />)
  expect(screen.getByRole('dialog', { name: '사진 편집' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '이 사진 사용' })).toHaveProperty('disabled', true)
  fireEvent.click(screen.getByRole('button', { name: '취소' }))
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(confirm).not.toHaveBeenCalled()
  unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:editor')
})

test.each(['invalid', 'oversized'])('읽을 수 없거나 4천만 픽셀 초과 사진은 확정하지 않는다: %s', (kind) => {
  const images: { onload: (() => void) | null; onerror: (() => void) | null }[] = []
  vi.stubGlobal('Image', class {
    naturalWidth = 10_000
    naturalHeight = 10_000
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    constructor() { images.push(this) }
  })
  URL.createObjectURL = vi.fn(() => 'blob:editor')
  URL.revokeObjectURL = vi.fn()
  const confirm = vi.fn()
  render(<NotePhotoEditor file={new File(['x'], 'note.jpg', { type: 'image/jpeg' })} onConfirm={confirm} onCancel={vi.fn()} />)
  act(() => { if (kind === 'invalid') images[0].onerror!(); else images[0].onload!() })
  expect(screen.getByRole('alert').textContent).toContain(kind === 'invalid' ? '읽을 수 없어요' : '4천만')
  expect(screen.getByRole('button', { name: '이 사진 사용' })).toHaveProperty('disabled', true)
  expect(confirm).not.toHaveBeenCalled()
})
