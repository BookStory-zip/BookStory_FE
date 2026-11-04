import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { addBookToShelf, ApiError, getShelves, removeBookFromShelf } from './lib/api'
import type { LibraryBookDetail, Shelf } from './lib/api'
import { withAccessToken } from './lib/auth'
import { commonErrorMessage, isUnclearWrite } from './lib/errors'

type Props = {
  userBookId: string
  // 소속은 서버 상세 응답 기준으로만 표시한다(성공 전 체크 표시 없음).
  current: LibraryBookDetail['shelves']
  blocked: boolean
  // 상세를 다시 조회한다.
  onChanged: () => Promise<unknown>
  onBusyChange: (busy: boolean) => void
}

// 부모가 책 key로 다시 그린다.
export default function BookShelves({ userBookId, current, blocked, onChanged, onBusyChange }: Props) {
  const [shelves, setShelves] = useState<Shelf[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState('')
  const active = useRef(true)
  const version = useRef(0)

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      version.current += 1
    }
  }, [])

  const load = useCallback(() => {
    const run = ++version.current
    return withAccessToken(getShelves).then((list) => {
      if (version.current === run) { setShelves(list); setLoadError('') }
    }, (failure: unknown) => {
      if (version.current === run) setLoadError(commonErrorMessage(failure, '책장을 불러오지 못했습니다'))
    })
  }, [])

  useEffect(() => { void load() }, [load])

  async function toggle(shelf: Shelf, inShelf: boolean) {
    if (pending || blocked) return
    setPending(shelf.id)
    onBusyChange(true)
    setError('')
    try {
      await withAccessToken((token) => inShelf ? removeBookFromShelf(token, shelf.id, userBookId) : addBookToShelf(token, shelf.id, userBookId))
      if (!active.current) return
      // 소속은 상세가 알려 준다. 책장 목록(권수)은 이 화면에 표시하지 않으므로 다시 받지 않는다.
      await onChanged()
    } catch (failure) {
      if (!active.current) return
      const unclear = isUnclearWrite(failure)
      const missing = failure instanceof ApiError && failure.status === 404
      setError(unclear ? '저장 결과를 확인하지 못했습니다. 최신 책장 정보를 불러왔어요.'
        : missing ? '책장이나 이 책을 찾을 수 없습니다. 최신 정보를 불러왔어요.'
          : commonErrorMessage(failure, inShelf ? '책장에서 빼지 못했습니다' : '책장에 넣지 못했습니다'))
      if (unclear || missing) await Promise.all([onChanged().catch(() => null), load()])
    } finally {
      if (active.current) {
        setPending(null)
        onBusyChange(false)
      }
    }
  }

  const ids = new Set(current.map((shelf) => shelf.id))
  return (
    <section className="detail-card book-shelves" aria-labelledby="book-shelves-title">
      <h2 id="book-shelves-title">책장</h2>
      {current.length > 0 && <p className="result-note">들어 있는 책장: {current.map((shelf) => shelf.name).join(', ')}</p>}
      {loadError && <div role="alert"><p>{loadError}</p><button type="button" className="secondary compact" onClick={() => void load()}>책장 다시 불러오기</button></div>}
      {!shelves && !loadError && <p className="result-note">책장을 불러오는 중…</p>}
      {shelves?.length === 0 && <p className="result-note">아직 만든 책장이 없습니다. <Link to="/">서재의 책장 관리</Link>에서 만들 수 있어요.</p>}
      {shelves && shelves.length > 0 && (
        <fieldset className="shelf-options" disabled={pending !== null || blocked}>
          <legend className="visually-hidden">이 책을 넣을 책장</legend>
          {shelves.map((shelf) => (
            <label key={shelf.id} className="review-toggle">
              <input type="checkbox" checked={ids.has(shelf.id)} onChange={() => void toggle(shelf, ids.has(shelf.id))} />
              <span>{shelf.name}{pending === shelf.id && ' (저장하는 중…)'}</span>
            </label>
          ))}
        </fieldset>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
