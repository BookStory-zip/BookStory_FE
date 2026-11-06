import { useEffect, useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import { ApiError, createShelf, deleteShelf, moveShelf, renameShelf } from './lib/api'
import type { Shelf } from './lib/api'
import { withAccessToken } from './lib/auth'
import { commonErrorMessage, isUnclearWrite } from './lib/errors'
import { SHELF_NAME_LIMIT, shelfName } from './lib/shelves'
import ConfirmDialog from './ConfirmDialog'
import OrderHandle from './OrderHandle'

type Props = {
  shelves: Shelf[]
  // 책장 목록을 다시 조회한다. 쓰기 결과는 항상 서버 목록으로 확인한다(보던 책장이 없어지면 부모가 전체로 돌린다).
  refresh: () => Promise<boolean>
  onBusyChange: (busy: boolean) => void
  onClose: () => void
}

export default function ShelfManager({ shelves, refresh, onBusyChange, onClose }: Props) {
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [remove, setRemove] = useState<Shelf | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const active = useRef(true)
  const busy = useRef(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const pane = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const drag = useRef<{ from: number; to: number; pointerId: number; x: number; y: number; started: boolean } | null>(null)
  const [dragTarget, setDragTarget] = useState<number | null>(null)
  const focusAfterMove = useRef<string | null>(null)
  const dragging = dragTarget !== null
  const locked = saving || dragging

  useEffect(() => {
    if (saving || !focusAfterMove.current) return
    list.current?.querySelector<HTMLButtonElement>(`[data-shelf-id="${focusAfterMove.current}"]`)?.focus()
    focusAfterMove.current = null
  }, [saving])

  function cancelDrag() { drag.current = null; setDragTarget(null) }

  function updateDrag(event: { clientX: number; clientY: number }) {
    if (!drag.current) return
    if (!drag.current.started && Math.hypot(event.clientX - drag.current.x, event.clientY - drag.current.y) <= 6) return
    drag.current.started = true
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-shelf-index]')
    drag.current.x = event.clientX
    drag.current.y = event.clientY
    drag.current.to = target && list.current?.contains(target) ? Number(target.dataset.shelfIndex) : drag.current.from
    setDragTarget(drag.current.to)
  }

  useEffect(() => {
    if (!dragging) return
    let frame = requestAnimationFrame(function scroll() {
      const current = drag.current
      const element = pane.current
      if (!current || !element) return
      const rect = element.getBoundingClientRect()
      const dy = current.y < rect.top + 48 ? -12 : current.y > rect.bottom - 48 ? 12 : 0
      if (dy) { element.scrollBy(0, dy); updateDrag({ clientX: current.x, clientY: current.y }) }
      frame = requestAnimationFrame(scroll)
    })
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); cancelDrag() }
    }
    document.addEventListener('keydown', cancel)
    return () => { cancelAnimationFrame(frame); document.removeEventListener('keydown', cancel) }
  }, [dragging])

  useEffect(() => {
    const element = dialog.current!
    const root = document.documentElement
    const overflow = root.style.overflow
    const gutter = root.style.scrollbarGutter
    if (root.clientWidth < window.innerWidth && !getComputedStyle(root).scrollbarGutter?.includes('stable')) root.style.scrollbarGutter = 'stable'
    root.style.overflow = 'hidden'
    if (typeof element.showModal === 'function') element.showModal()
    else element.setAttribute('open', '')
    return () => {
      root.style.overflow = overflow
      root.style.scrollbarGutter = gutter
      if (typeof element.showModal === 'function') element.close()
      else element.removeAttribute('open')
    }
  }, [])

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      // 저장 중에 사라져도 부모의 잠금을 풀어 둔다.
      if (busy.current) onBusyChange(false)
    }
  }, [onBusyChange])

  // 고치던 책장이 목록에서 사라졌으면(404·다른 탭 삭제) 편집 상태를 버린다.
  const renaming = editing && shelves.some((shelf) => shelf.id === editing.id) ? editing : null

  // 성공하면 true. 결과가 불명확하거나 대상이 없으면 다시 보내지 않고 목록만 다시 확인한다.
  async function write(request: (token: string) => Promise<unknown>, done: string, failed: string): Promise<boolean> {
    if (busy.current) return false
    busy.current = true
    setSaving(true)
    onBusyChange(true)
    setError('')
    setNotice('')
    try {
      await withAccessToken(request)
      if (!active.current) return false
      // 안내는 목록을 다시 받은 뒤에 띄워 화면과 어긋나지 않게 한다.
      const refreshed = await refresh()
      if (!active.current) return true
      if (refreshed) setNotice(done)
      else setError('저장했지만 최신 책장 목록을 확인하지 못했습니다. 잠시 후 다시 확인해주세요.')
      return true
    } catch (writeError) {
      if (!active.current) return false
      const unclear = isUnclearWrite(writeError)
      const missing = writeError instanceof ApiError && writeError.status === 404
      setError(unclear ? '저장 결과를 확인하지 못했습니다. 최신 책장 목록을 불러왔어요.'
        : missing ? '책장을 찾을 수 없습니다. 최신 책장 목록을 불러왔어요.'
          : writeError instanceof ApiError && writeError.code === 'invalid_position' ? '책장을 자기 자신 뒤로 옮길 수 없습니다.'
            : commonErrorMessage(writeError, failed))
      if (unclear || missing) await refresh()
      return false
    } finally {
      busy.current = false
      if (active.current) {
        setSaving(false)
        onBusyChange(false)
      }
    }
  }

  async function create(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = shelfName(newName)
    if ('error' in parsed) return setError(parsed.error)
    if (await write((token) => createShelf(token, parsed.name), `‘${parsed.name}’ 책장을 만들었습니다.`, '책장을 만들지 못했습니다') && active.current) setNewName('')
  }

  async function rename(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!renaming) return
    const target = renaming
    const parsed = shelfName(target.name)
    if ('error' in parsed) return setError(parsed.error)
    // 대소문자만 바꾸는 것은 보낸다. 완전히 같으면 요청하지 않는다.
    if (parsed.name === shelves.find((shelf) => shelf.id === target.id)?.name) return setEditing(null)
    if (await write((token) => renameShelf(token, target.id, parsed.name), '책장 이름을 바꿨습니다.', '책장 이름을 바꾸지 못했습니다') && active.current) setEditing(null)
  }

  function move(from: number, to: number) {
    if (busy.current || renaming || from === to || to < 0 || to >= shelves.length) return
    const moved = shelves[from]
    focusAfterMove.current = moved.id
    const remaining = shelves.filter((shelf) => shelf.id !== moved.id)
    const anchor = to === 0 ? null : remaining[to - 1].id
    void write((token) => moveShelf(token, moved.id, anchor), '책장 순서를 바꿨습니다.', '책장 순서를 바꾸지 못했습니다')
  }

  async function confirmRemove() {
    const target = remove
    setRemove(null)
    if (!target) return
    await write((token) => deleteShelf(token, target.id), `‘${target.name}’ 책장을 삭제했습니다. 책은 서재에 그대로 있어요.`, '책장을 삭제하지 못했습니다')
  }

  return (
    <dialog ref={dialog} className="shelf-manager-dialog" aria-labelledby="shelf-manager-title" aria-busy={saving}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        if (drag.current) cancelDrag()
        else if (!busy.current && !remove) onClose()
      }}>
      <div className="shelf-manager-header">
        <h2 id="shelf-manager-title">책장 관리</h2>
        <button type="button" className="secondary compact" aria-label="책장 관리 닫기" disabled={locked || remove !== null}
          onClick={() => { if (!busy.current) onClose() }}>닫기</button>
      </div>
      <div ref={pane} className="shelf-manager">
      <details className="inline-help"><summary>책장 사용법</summary>
        <p id="shelf-order-help">한 책을 여러 책장에 넣을 수 있습니다. 책장 안의 책 순서는 전체 서재 순서를 따릅니다. 책장 손잡이를 끌거나 눌러 이동 메뉴를 열 수 있으며 방향키로도 옮길 수 있습니다. 이동할 때마다 저장됩니다.</p>
      </details>
      <form className="search-form" onSubmit={(event) => void create(event)}>
        <label htmlFor="new-shelf" className="visually-hidden">새 책장 이름</label>
        <input id="new-shelf" value={newName} disabled={locked} placeholder={`새 책장 이름(${SHELF_NAME_LIMIT}자까지)`} autoComplete="off"
          onChange={(event) => setNewName(event.target.value)} />
        <button type="submit" disabled={locked}>만들기</button>
      </form>
      {error && <p className="library-note" role="alert">{error}</p>}
      <p aria-live="polite" className="result-note">{saving ? '변경 사항을 저장하고 목록을 확인하는 중…' : notice}</p>
      {shelves.length === 0 ? <p className="result-note">아직 만든 책장이 없습니다.</p> : (
        <ul ref={list} className="shelf-list">
          {shelves.map((shelf, index) => (
            <li key={shelf.id} data-shelf-index={index} className={dragTarget === index ? 'order-target' : undefined}>
              {renaming?.id === shelf.id ? (
                <form className="search-form" onSubmit={(event) => void rename(event)}>
                  <label htmlFor={`rename-${shelf.id}`} className="visually-hidden">{shelf.name} 새 이름</label>
                  <input id={`rename-${shelf.id}`} value={renaming.name} disabled={saving} autoComplete="off"
                    onChange={(event) => setEditing({ id: shelf.id, name: event.target.value })} />
                  <button type="submit" disabled={saving}>저장</button>
                  <button type="button" className="link-button" disabled={saving} onClick={() => { setEditing(null); setError('') }}>취소</button>
                </form>
              ) : (
                <>
                  <span className="shelf-name">{shelf.name} <small>{shelf.book_count}권</small></span>
                  <span className="shelf-actions">
                    <OrderHandle label={shelf.name} previous={!dragging && index > 0} next={!dragging && index < shelves.length - 1}
                      disabled={saving || renaming !== null} aria-describedby="shelf-order-help" data-shelf-id={shelf.id} onMove={(direction) => move(index, index + direction)}
                      onPointerDown={(event) => {
                        if (busy.current || renaming || !event.isPrimary || event.button !== 0) return
                        event.currentTarget.setPointerCapture(event.pointerId)
                        drag.current = { from: index, to: index, pointerId: event.pointerId, x: event.clientX, y: event.clientY, started: false }
                      }} onPointerMove={(event) => { if (drag.current?.pointerId === event.pointerId) updateDrag(event) }}
                      onPointerUp={(event) => {
                        if (drag.current?.pointerId !== event.pointerId) return
                        updateDrag(event)
                        const current = drag.current!
                        cancelDrag()
                        if (current.started) move(current.from, current.to)
                      }} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag} />
                    <button type="button" className="link-button" aria-label={`${shelf.name} 이름 바꾸기`} disabled={locked || renaming !== null} onClick={() => { setEditing({ id: shelf.id, name: shelf.name }); setError('') }}>이름</button>
                    <button type="button" className="link-button" aria-label={`${shelf.name} 삭제`} disabled={locked || renaming !== null} onClick={() => setRemove(shelf)}>삭제</button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={remove !== null} title={`‘${remove?.name ?? ''}’ 책장을 삭제할까요?`}
        message="책장만 삭제하며 책은 서재에 그대로 남습니다. 책장에 넣은 정보는 되돌릴 수 없습니다." confirmLabel="책장 삭제" danger
        onConfirm={() => void confirmRemove()} onCancel={() => setRemove(null)} />
      </div>
    </dialog>
  )
}
