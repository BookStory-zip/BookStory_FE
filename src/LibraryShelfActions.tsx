import { useEffect, useRef, useState } from 'react'
import { addBookToShelf, ApiError, removeBookFromShelf } from './lib/api'
import type { LibraryBookItem, Shelf } from './lib/api'
import { withAccessToken } from './lib/auth'
import { commonErrorMessage, isUnclearWrite } from './lib/errors'

type Props = {
  books: LibraryBookItem[]
  shelves: Shelf[] | null
  currentShelfId?: string
  blocked: boolean
  onChanged: (successfulIds: string[]) => Promise<boolean>
  onBusyChange: (busy: boolean) => void
}

export default function LibraryShelfActions({ books, shelves, currentShelfId, blocked, onChanged, onBusyChange }: Props) {
  const [target, setTarget] = useState('')
  const [pending, setPending] = useState(false)
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [results, setResults] = useState<string[]>([])
  const active = useRef(true)
  const busy = useRef(false)
  const locked = pending || needsRefresh || blocked
  // 담을 책장이 삭제·재조회로 목록에서 빠지면 선택을 비운다.
  const targetId = shelves?.some((shelf) => shelf.id === target) ? target : ''

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      onBusyChange(false)
    }
  }, [onBusyChange])

  async function refresh(successfulIds: string[]) {
    let fresh = false
    try { fresh = await onChanged(successfulIds) } catch { /* 재확인 버튼으로 복구한다. */ }
    if (!active.current) return
    setNeedsRefresh(!fresh)
    onBusyChange(!fresh)
  }

  async function change(remove: boolean) {
    const shelfId = remove ? currentShelfId : targetId
    if (busy.current || locked || !shelfId || books.length === 0) return
    busy.current = true
    setPending(true)
    onBusyChange(true)
    setResults([])
    const successfulIds: string[] = []
    const messages: string[] = []
    try {
      for (const [index, book] of books.entries()) {
        if (!active.current) return
        try {
          await withAccessToken((token) => remove
            ? removeBookFromShelf(token, shelfId, book.id)
            : addBookToShelf(token, shelfId, book.id))
          successfulIds.push(book.id)
        } catch (error) {
          messages.push(`${book.title}: ${isUnclearWrite(error)
            ? '저장 여부를 확인하지 못했습니다. 책장에서 확인해주세요.'
            : `처리하지 못했습니다. ${commonErrorMessage(error, '책장 변경에 실패했습니다')}`}`)
          // 책마다 다른 404·409·422가 아니면(인증·서버 기동·요청 제한·연결) 남은 책도 같으므로 보내지 않는다.
          const bookSpecific = error instanceof ApiError && [404, 409, 422].includes(error.status)
          if (!bookSpecific && index < books.length - 1) {
            messages.push(`남은 ${books.length - index - 1}권은 보내지 않았습니다. 잠시 후 다시 시도해주세요.`)
            break
          }
        }
      }
      if (!active.current) return
      setResults([`${successfulIds.length}권을 ${remove ? '책장에서 뺐습니다.' : '책장에 담았습니다.'}`, ...messages])
      await refresh(successfulIds)
    } finally {
      busy.current = false
      if (active.current) setPending(false)
    }
  }

  return <div className="library-shelf-actions" aria-busy={pending}>
    <p>{books.length}권 선택</p>
    {shelves?.length === 0 && <p className="result-note">책장 관리에서 먼저 책장을 만들어 주세요.</p>}
    <div className="shelf-action-controls">
      <label htmlFor="shelf-destination">담을 책장</label>
      <select id="shelf-destination" value={targetId} disabled={locked || !shelves?.length} onChange={(event) => setTarget(event.target.value)}>
        <option value="">책장 선택</option>
        {shelves?.map((shelf) => <option key={shelf.id} value={shelf.id}>{shelf.name}</option>)}
      </select>
      <button type="button" disabled={locked || !targetId || !books.length} onClick={() => void change(false)}>{pending ? '처리 중…' : '책장에 담기'}</button>
      {currentShelfId && <button type="button" className="secondary" disabled={locked || !books.length} onClick={() => void change(true)}>책장에서 빼기</button>}
    </div>
    <div aria-live="polite">{results.map((message, index) => <p key={index} className="result-note">{message}</p>)}</div>
    {needsRefresh && <div role="alert"><p>최신 책장 정보를 확인하기 전에는 다시 변경할 수 없습니다.</p>
      <button type="button" className="secondary" disabled={pending} onClick={() => void refresh([])}>책장 정보 다시 확인</button>
    </div>}
  </div>
}
