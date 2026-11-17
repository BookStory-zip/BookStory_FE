import { useEffect, useRef, useState } from 'react'
import type { ReadingNote } from './lib/api'

type Props = { note: ReadingNote; onRefresh?: () => Promise<void>; blocked?: boolean }

export default function NotePhoto(props: Props) {
  return <Photo key={props.note.id} {...props} />
}

function Photo({ note, onRefresh, blocked = false }: Props) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const viewer = useRef<HTMLDialogElement>(null)
  const expandButton = useRef<HTMLButtonElement>(null)
  const mounted = useRef(false)
  const inFlight = useRef(false)
  const automaticAttempted = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    const dialog = viewer.current
    if (!dialog || !expanded) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
  }, [expanded])

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
  function closePhoto() {
    if (typeof viewer.current?.close === 'function') viewer.current.close()
    setExpanded(false)
    expandButton.current?.focus()
  }
  function imageFailed() {
    setFailedUrl(note.photo_url)
    if (!automaticAttempted.current && !blocked && onRefresh) {
      automaticAttempted.current = true
      void refresh()
    }
  }
  return (
    <div className="note-photo">
      {note.photo_url && (
        <img key={`${note.photo_url}-${attempt}`} className="note-photo-image" src={note.photo_url}
          alt="독서 노트 첨부 사진" loading="lazy" referrerPolicy="no-referrer"
          onLoad={() => { setFailedUrl(null); automaticAttempted.current = false }}
          onError={imageFailed} />
      )}
      {(!note.photo_url || failedUrl === note.photo_url) && (
        <div className="note-photo-error" role="status">
          <p>사진을 불러오지 못했어요</p>
          {onRefresh && <button type="button" className="secondary" disabled={blocked || pending}
            onClick={() => void refresh()}>{pending ? '사진 불러오는 중…' : '사진 다시 불러오기'}</button>}
        </div>
      )}
      {note.photo_url && failedUrl !== note.photo_url && <button ref={expandButton} type="button" className="link-button" onClick={() => setExpanded(true)}>사진 확대</button>}
      {expanded && <dialog ref={viewer} className="note-photo-viewer" aria-label="독서 노트 사진 확대"
        onCancel={(event) => { event.preventDefault(); closePhoto() }}>
        <button type="button" className="secondary compact" autoFocus onClick={closePhoto}>사진 닫기</button>
        {note.photo_url && <img key={`${note.photo_url}-${attempt}`} src={note.photo_url} alt="독서 노트 첨부 사진 확대" referrerPolicy="no-referrer"
          onLoad={() => { setFailedUrl(null); automaticAttempted.current = false }} onError={imageFailed} />}
        {(!note.photo_url || failedUrl === note.photo_url) && <div role="status"><p>사진을 불러오지 못했어요</p><button type="button" disabled={blocked || pending} onClick={() => void refresh()}>사진 다시 불러오기</button></div>}
      </dialog>}
    </div>
  )
}
