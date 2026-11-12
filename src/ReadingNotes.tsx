import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, SubmitEvent } from 'react'
import { ApiError, createReadingNote, createReadingPhotoNote, deleteReadingNote, deleteNotePhoto, getReadingNotes, updateNotePhoto, updateReadingNote } from './lib/api'
import type { NoteInput, ReadingNote } from './lib/api'
import { withAccessToken } from './lib/auth'
import { spokenDate } from './lib/dates'
import { commonErrorMessage, isUnclearWrite } from './lib/errors'
import { charCount, noteForm, noteInput, notePatch, notePhotoError, validateNotePhoto, refreshNotePhotos, NOTE_REFRESH_PAGE_SIZE, QUOTE_LIMIT, THOUGHT_LIMIT } from './lib/notes'
import type { NoteForm } from './lib/notes'
import ConfirmDialog from './ConfirmDialog'
import DatePicker from './DatePicker'
import NotePhoto from './NotePhoto'
import NotePhotoEditor from './NotePhotoEditor'

// blocked: 책 상세의 다른 저장·타이머 저장·재확인 중에는 노트를 쓰지 않는다.
type Props = { userBookId: string; today: string; blocked: boolean; onBusyChange: (busy: boolean) => void }
type List = { items: ReadingNote[]; offset: number; more: boolean }
// initial: 편집을 연 순간의 값. 자정에 오늘이 바뀌어도 미저장 판단 기준이 흔들리지 않는다.
type Editor = { note: ReadingNote | null; form: NoteForm; initial: NoteForm }
const PAGE_SIZE = 20
// 저장 후에는 이미 불러온 범위를 한 번에 다시 받는다(API 최대 100개).
const RELOAD_MAX = 100

// 책 상세와 기록 타임라인이 같은 모양으로 노트 내용을 보여 준다.
export function NoteText({ note, onRefresh, blocked = false }: { note: ReadingNote; onRefresh?: () => Promise<void>; blocked?: boolean }) {
  return <>
    <NotePhoto note={note} onRefresh={onRefresh} blocked={blocked} />
    {note.quote && <blockquote className="note-quote">{note.quote}</blockquote>}
    {note.thought && <p className="note-thought">{note.thought}</p>}
    {note.page !== null && <p className="result-note">{note.page}쪽</p>}
  </>
}

// 부모가 책 key로 다시 그린다. 계정이 바뀌면 개인 화면 전체가 새로 그려져 작성 중 입력도 사라진다.
export default function ReadingNotes({ userBookId, today, blocked, onBusyChange }: Props) {
  const [list, setList] = useState<List | null>(null)
  const [listError, setListError] = useState('')
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [photo, setPhoto] = useState<File | null>(null)
  const [editingPhoto, setEditingPhoto] = useState<{ file: File; target?: ReadingNote } | null>(null)
  const [failedPhoto, setFailedPhoto] = useState<{ noteId: string; file: File } | null>(null)
  const [preview, setPreview] = useState('')
  const [pending, setPending] = useState<{ input: NoteInput; photo: File; id: string } | null>(null)
  const [reconciling, setReconciling] = useState(false)
  const reconciliation = useRef(false)
  const [remove, setRemove] = useState<ReadingNote | null>(null)
  const active = useRef(true)
  const busy = useRef(false)
  const version = useRef(0)
  const photoRefresh = useRef<Promise<void> | null>(null)

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      version.current += 1
      if (busy.current || reconciliation.current) onBusyChange(false)
    }
  }, [onBusyChange])

  const load = useCallback((offset: number, limit = PAGE_SIZE) => {
    const current = ++version.current
    return withAccessToken((token) => getReadingNotes(token, userBookId, limit, offset)).then((page) => {
      if (!active.current || version.current !== current) return
      setList((previous) => ({
        items: offset === 0 ? page : [...new Map([...(previous?.items ?? []), ...page].map((item) => [item.id, item])).values()],
        offset: offset + page.length, more: page.length === limit,
      }))
      if (reconciliation.current) {
        reconciliation.current = false
        setReconciling(false)
        onBusyChange(false)
      }
    }, (loadError: unknown) => {
      // 실패해도 이미 불러온 목록과 다음 위치를 지우지 않는다.
      if (version.current === current) setListError(commonErrorMessage(loadError, '노트를 불러오지 못했습니다'))
    }).finally(() => {
      if (version.current === current) setLoading(false)
    })
  }, [userBookId, onBusyChange])

  useEffect(() => {
    void load(0)
  }, [load])

  function reload(offset: number, limit = PAGE_SIZE) {
    setLoading(true)
    setListError('')
    return load(offset, limit)
  }

  // shortcut: 100개를 넘게 불러온 뒤 저장하면 앞 100개만 다시 받는다. 노트가 많아지면 범위별 재조회로 바꾼다.
  const reloadLoaded = () => reload(0, Math.min(RELOAD_MAX, Math.max(PAGE_SIZE, list?.offset ?? 0)))
  function refreshPhotos(): Promise<void> {
    if (photoRefresh.current) return photoRefresh.current
    const current = version.current
    const isCurrent = () => active.current && version.current === current
    const request = refreshNotePhotos(list?.items ?? [], (offset) =>
      withAccessToken((token) => getReadingNotes(token, userBookId, NOTE_REFRESH_PAGE_SIZE, offset)), isCurrent)
      .then((items) => {
        if (!items || !isCurrent()) return
        setList((previous) => !previous || !isCurrent() ? previous : { ...previous, items, offset: Math.max(0, previous.offset - (previous.items.length - items.length)) })
      }).finally(() => { photoRefresh.current = null })
    photoRefresh.current = request
    return request
  }
  const locked = saving || blocked || reconciling || pending !== null || editingPhoto !== null
  const formLocked = saving || pending !== null || reconciling

  const dirty = photo !== null || editingPhoto !== null || failedPhoto !== null || pending !== null || (editor !== null && JSON.stringify(editor.form) !== JSON.stringify(editor.initial))
  useEffect(() => {
    if (!editingPhoto) return
    onBusyChange(true)
    return () => { if (!busy.current && !reconciliation.current) onBusyChange(false) }
  }, [editingPhoto, onBusyChange])
  useEffect(() => {
    if (preview) return () => URL.revokeObjectURL(preview)
  }, [preview])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  async function write(request: (token: string) => Promise<unknown>, done: string, failed: (error: unknown, attempted: boolean) => string, photoWrite = false) {
    if (busy.current || blocked || reconciliation.current) return
    busy.current = true
    setSaving(true)
    onBusyChange(true)
    setError('')
    setMessage('')
    let attempted = false
    try {
      await withAccessToken((token) => { attempted = true; return request(token) })
      if (!active.current) return
      setEditor(null)
      setPhoto(null)
      setPreview('')
      setPending(null)
      setFailedPhoto(null)
      setMessage(done)
      if (photoWrite) { reconciliation.current = true; setReconciling(true) }
      await reloadLoaded()
    } catch (writeError) {
      if (!active.current) return
      setError(failed(writeError, attempted))
      const notFound = writeError instanceof ApiError && writeError.status === 404
      // 수정하던 노트가 사라졌으면 입력을 새 노트로 저장할 수 있게 한다.
      if (notFound && !photoWrite) setEditor((previous) => previous?.note ? { ...previous, note: null } : previous)
      // 결과가 불명확하거나 대상이 없으면 다시 보내지 않고 서버 목록만 확인한다.
      if ((attempted && isUnclearWrite(writeError)) || notFound || (photoWrite && writeError instanceof ApiError && writeError.status === 422)) {
        if (photoWrite) { reconciliation.current = true; setReconciling(true) }
        await reloadLoaded()
      }
    } finally {
      busy.current = false
      if (active.current) {
        setSaving(false)
        if (!reconciliation.current) onBusyChange(false)
      }
    }
  }

  function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor || busy.current || blocked || reconciling || pending) return
    const parsed = noteInput(editor.form, today, !!photo || !!editor.note?.has_photo)
    if ('error' in parsed) {
      setError(parsed.error)
      return
    }
    const target = editor.note
    if (target) {
      const patch = notePatch(target, parsed.input)
      if (Object.keys(patch).length === 0) {
        setEditor(null)
        setError('')
        setMessage('바뀐 내용이 없습니다.')
        return
      }
      void write((token) => updateReadingNote(token, target.id, patch), '노트를 수정했습니다.', (saveError) =>
        isUnclearWrite(saveError) ? '수정 결과를 확인하지 못했습니다. 작성한 내용은 그대로 두었어요. 목록을 확인한 뒤 필요하면 다시 저장해주세요.'
          : saveError instanceof ApiError && saveError.status === 404 ? '노트를 찾을 수 없습니다. 이미 삭제됐을 수 있어요. 작성한 내용은 새 노트로 저장할 수 있어요.'
            : commonErrorMessage(saveError, '노트를 수정하지 못했습니다'))
    } else if (photo) {
      const submission = { input: parsed.input, photo, id: crypto.randomUUID() }
      void savePhoto(submission)
    } else {
      void write((token) => createReadingNote(token, userBookId, parsed.input), '노트를 저장했습니다.', (saveError) =>
        isUnclearWrite(saveError) ? '저장 결과를 확인하지 못했습니다. 작성한 내용은 그대로 두었어요. 목록을 확인한 뒤 필요하면 다시 저장해주세요.'
          : saveError instanceof ApiError && saveError.status === 404 ? '서재에서 이 책을 찾을 수 없습니다.'
            : commonErrorMessage(saveError, '노트를 저장하지 못했습니다'))
    }
  }

  async function savePhoto(submission: { input: NoteInput; photo: File; id: string }) {
    if (busy.current || blocked || reconciliation.current) return
    setPending(submission)
    await write((token) => createReadingPhotoNote(token, userBookId, submission.input, submission.photo, submission.id), '노트를 저장했습니다.', (saveError, attempted) => {
      if (!attempted || !isUnclearWrite(saveError)) setPending(null)
      return attempted && isUnclearWrite(saveError)
        ? '저장 결과를 확인하지 못했습니다. 같은 내용으로 다시 확인해주세요. 확인 전에는 입력을 바꿀 수 없어요.'
        : notePhotoError(saveError)
    }, true)
  }

  function choosePhoto(file: File | undefined, target?: ReadingNote) {
    if (!file || busy.current || blocked || reconciling || pending || editingPhoto) return
    const invalid = validateNotePhoto(file)
    if (invalid) { setError(invalid); return }
    setError('')
    setEditingPhoto({ file, target })
  }

  function applyPhoto(file: File, target?: ReadingNote) {
    if (busy.current || blocked || reconciling || pending) return
    const invalid = validateNotePhoto(file)
    if (invalid) { setError(invalid); return }
    setEditingPhoto(null)
    if (target) {
      setFailedPhoto(null)
      void write((token) => updateNotePhoto(token, target.id, file), '사진을 저장했습니다.', (uploadError) => {
        setFailedPhoto({ noteId: target.id, file })
        return notePhotoError(uploadError)
      }, true)
    } else {
      setPhoto(file)
      setPreview(URL.createObjectURL(file))
    }
  }

  function photoInputs(target?: ReadingNote) {
    const disabled = target ? locked || editor !== null : formLocked || blocked
    const label = target ? `${spokenDate(target.note_date)} ${target.has_photo ? '사진 바꾸기' : '사진 추가'}` : '사진 선택'
    const onChange = (event: ChangeEvent<HTMLInputElement>) => { choosePhoto(event.target.files?.[0], target); event.target.value = '' }
    return <div className="note-photo-actions">
      <label>{label}<input type="file" accept="image/*" disabled={disabled} onChange={onChange} /></label>
    </div>
  }

  function confirmRemove() {
    const target = remove
    setRemove(null)
    if (!target || busy.current || blocked) return
    void write((token) => deleteReadingNote(token, target.id), '노트를 삭제했습니다.', (deleteError) =>
      isUnclearWrite(deleteError) ? '삭제 결과를 확인하지 못했습니다. 목록을 다시 불러왔어요.'
        : deleteError instanceof ApiError && deleteError.status === 404 ? '노트를 찾을 수 없습니다. 목록을 다시 불러왔어요.'
          : commonErrorMessage(deleteError, '노트를 삭제하지 못했습니다'))
  }

  const setForm = (patch: Partial<NoteForm>) => setEditor((previous) => previous && { ...previous, form: { ...previous.form, ...patch } })

  return <section className="detail-card reading-notes" aria-labelledby="notes-title">
    <h2 id="notes-title">독서 노트</h2>
    <p className="result-note">나만 보는 기록이에요. 공개 후기(메모)와 따로 저장되고, 노트를 남겨도 독서 체크는 생기지 않아요.</p>
    {editor ? (
      <form className="note-form" onSubmit={save} aria-label={editor.note ? '노트 수정' : '새 노트'} noValidate>
        <DatePicker label="날짜" value={editor.form.date} max={today} disabled={formLocked} onChange={(date) => setForm({ date })} />
        <div>
          <label htmlFor="note-quote">인상 깊은 문구</label>
          <textarea id="note-quote" rows={3} value={editor.form.quote} disabled={formLocked} onChange={(event) => setForm({ quote: event.target.value })} />
          <small className="counter">{charCount(editor.form.quote.trim())} / {QUOTE_LIMIT}</small>
        </div>
        <div>
          <label htmlFor="note-thought">생각</label>
          <textarea id="note-thought" rows={4} value={editor.form.thought} disabled={formLocked} onChange={(event) => setForm({ thought: event.target.value })} />
          <small className="counter">{charCount(editor.form.thought.trim())} / {THOUGHT_LIMIT}</small>
        </div>
        <div>
          <label htmlFor="note-page">페이지(선택)</label>
          <input id="note-page" inputMode="numeric" autoComplete="off" value={editor.form.page} disabled={formLocked} onChange={(event) => setForm({ page: event.target.value })} />
        </div>
        {!editor.note && <>
          {photoInputs()}
          {photo && <div><img className="note-photo-preview" src={preview} alt="저장할 사진 미리보기" /><p>{photo.name}</p><button type="button" disabled={formLocked} onClick={() => { setPhoto(null); setPreview('') }}>선택한 사진 빼기</button></div>}
        </>}
        {pending && <div><p>확인 없이 새로 저장하면 노트가 중복될 수 있어요.</p>
          <button type="button" disabled={saving || blocked || reconciling} onClick={() => void savePhoto(pending)}>같은 내용으로 다시 확인</button>
          <button type="button" disabled={saving || reconciling} onClick={() => { if (window.confirm('저장됐을 수 있습니다. 다시 저장하면 중복 노트가 생길 수 있어요. 확인을 중단할까요?')) setPending(null) }}>결과 확인 중단</button>
        </div>}
        {error && <p role="alert">{error}</p>}
        <div className="timer-actions">
          <button type="submit" disabled={locked}>{saving ? '저장하는 중…' : '노트 저장'}</button>
          <button type="button" className="link-button" disabled={formLocked} onClick={() => { setEditor(null); setPhoto(null); setPreview(''); setError('') }}>취소</button>
        </div>
      </form>
    ) : (
      <>
        {error && <p role="alert">{error}</p>}
        <button type="button" disabled={locked} onClick={() => { const form = noteForm(null, today); setEditor({ note: null, form, initial: form }); setError(''); setMessage('') }}>노트 쓰기</button>
      </>
    )}
    <p aria-live="polite">{message}</p>
    {failedPhoto && <div><p>선택한 사진: {failedPhoto.file.name}</p>
      {list?.items.some((item) => item.id === failedPhoto.noteId) && <button type="button" disabled={locked || editor !== null} onClick={() => {
        const target = list.items.find((item) => item.id === failedPhoto.noteId)
        if (target) applyPhoto(failedPhoto.file, target)
      }}>선택한 사진 다시 저장</button>}
      <button type="button" disabled={saving || reconciling} onClick={() => setFailedPhoto(null)}>선택한 사진 버리기</button>
    </div>}

    {loading && !list && <p className="result-note">노트를 불러오는 중…</p>}
    {list?.items.length === 0 && <p className="result-note">아직 남긴 노트가 없습니다.</p>}
    {list && list.items.length > 0 && <ul className="note-list">{list.items.map((item) => <li key={item.id}>
      <div className="note-head">
        <time dateTime={item.note_date}>{spokenDate(item.note_date)}</time>
        <span>
          <button type="button" className="link-button" disabled={locked || editor !== null} aria-label={`${spokenDate(item.note_date)} 노트 수정`}
            onClick={() => { const form = noteForm(item, today); setEditor({ note: item, form, initial: form }); setError(''); setMessage('') }}>수정</button>
          <button type="button" className="link-button" disabled={locked || editor !== null} aria-label={`${spokenDate(item.note_date)} 노트 삭제`}
            onClick={() => setRemove(item)}>삭제</button>
        </span>
      </div>
      <NoteText note={item} onRefresh={refreshPhotos} blocked={locked} />
      {photoInputs(item)}
      {item.has_photo && (item.quote || item.thought
        ? <button type="button" disabled={locked || editor !== null} onClick={() => void write((token) => deleteNotePhoto(token, item.id), '사진을 삭제했습니다.', (failure) => notePhotoError(failure, '삭제'), true)}>사진 삭제</button>
        : <p className="result-note">사진만 있는 노트는 사진을 따로 지울 수 없어요. 노트 삭제를 이용해주세요.</p>)}
    </li>)}</ul>}
    {listError && <div role="alert"><p>{listError}</p>
      <button type="button" className="secondary compact" disabled={loading} onClick={() => void (reconciling ? reloadLoaded() : reload(list?.offset ?? 0))}>노트 다시 불러오기</button></div>}
    {list?.more && !listError && <button type="button" className="secondary" disabled={loading || saving} onClick={() => void reload(list.offset)}>{loading ? '불러오는 중…' : '노트 더 보기'}</button>}
    {editingPhoto && <NotePhotoEditor file={editingPhoto.file} onCancel={() => setEditingPhoto(null)} onConfirm={(file) => applyPhoto(file, editingPhoto.target)} />}
    <ConfirmDialog open={remove !== null} title="노트를 삭제할까요?" message="이 노트만 삭제하며 되돌릴 수 없습니다. 독서 체크와 공개 후기는 그대로 남습니다." confirmLabel="노트 삭제" danger onConfirm={confirmRemove} onCancel={() => setRemove(null)} />
  </section>
}
