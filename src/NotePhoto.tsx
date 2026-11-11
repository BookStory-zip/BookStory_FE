import { useEffect, useRef, useState } from 'react'
import type { ReadingNote } from './lib/api'

type Props = { note: ReadingNote; onRefresh?: () => Promise<void>; blocked?: boolean }

export default function NotePhoto(props: Props) {
  return <Photo key={props.note.id} {...props} />
}

function Photo({ note, onRefresh, blocked = false }: Props) {
  const [failed, setFailed] = useState(false)
  const [pending, setPending] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const mounted = useRef(false)
  const inFlight = useRef(false)
  const automaticAttempted = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  async function refresh() {
    if (!onRefresh || blocked || inFlight.current) return
    inFlight.current = true
    setPending(true)
    try {
      await onRefresh()
    } catch {
      // Keep the retry available even when the parent propagates its request error.
    } finally {
      inFlight.current = false
      if (mounted.current) {
        setPending(false)
        setAttempt((value) => value + 1)
      }
    }
  }

  if (!note.has_photo) return null
  return (
    <div className="note-photo">
      {note.photo_url && (
        <img key={`${note.photo_url}-${attempt}`} className="note-photo-image" src={note.photo_url}
          alt="독서 노트 첨부 사진" loading="lazy" referrerPolicy="no-referrer"
          onLoad={() => { setFailed(false); automaticAttempted.current = false }}
          onError={() => {
            setFailed(true)
            if (!automaticAttempted.current && !blocked && onRefresh) {
              automaticAttempted.current = true
              void refresh()
            }
          }} />
      )}
      {(!note.photo_url || failed) && (
        <div className="note-photo-error" role="status">
          <p>사진을 불러오지 못했어요</p>
          {onRefresh && <button type="button" className="secondary" disabled={blocked || pending}
            onClick={() => void refresh()}>{pending ? '사진 불러오는 중…' : '사진 다시 불러오기'}</button>}
        </div>
      )}
    </div>
  )
}
