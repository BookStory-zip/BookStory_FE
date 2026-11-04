import { useCallback, useEffect, useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import { ApiError, createReadingNote, deleteReadingNote, getReadingNotes, updateReadingNote } from './lib/api'
import type { ReadingNote } from './lib/api'
import { withAccessToken } from './lib/auth'
import { spokenDate } from './lib/dates'
import { commonErrorMessage, isUnclearWrite } from './lib/errors'
import { charCount, noteForm, noteInput, notePatch, QUOTE_LIMIT, THOUGHT_LIMIT } from './lib/notes'
import type { NoteForm } from './lib/notes'
import ConfirmDialog from './ConfirmDialog'
import DatePicker from './DatePicker'

// blocked: 책 상세의 다른 저장·타이머 저장·재확인 중에는 노트를 쓰지 않는다.
type Props = { userBookId: string; today: string; blocked: boolean; onBusyChange: (busy: boolean) => void }
type List = { items: ReadingNote[]; offset: number; more: boolean }
// initial: 편집을 연 순간의 값. 자정에 오늘이 바뀌어도 미저장 판단 기준이 흔들리지 않는다.
type Editor = { note: ReadingNote | null; form: NoteForm; initial: NoteForm }
const PAGE_SIZE = 20
// 저장 후에는 이미 불러온 범위를 한 번에 다시 받는다(API 최대 100개).
const RELOAD_MAX = 100

// 책 상세와 기록 타임라인이 같은 모양으로 노트 내용을 보여 준다.
export function NoteText({ note }: { note: ReadingNote }) {
  return <>
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
  const [remove, setRemove] = useState<ReadingNote | null>(null)
  const active = useRef(true)
  const busy = useRef(false)
  const version = useRef(0)

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      version.current += 1
    }
  }, [])

  const load = useCallback((offset: number, limit = PAGE_SIZE) => {
    const current = ++version.current
    return withAccessToken((token) => getReadingNotes(token, userBookId, limit, offset)).then((page) => {
      if (version.current !== current) return
      setList((previous) => ({
        items: offset === 0 ? page : [...new Map([...(previous?.items ?? []), ...page].map((item) => [item.id, item])).values()],
        offset: offset + page.length, more: page.length === limit,
      }))
    }, (loadError: unknown) => {
      // 실패해도 이미 불러온 목록과 다음 위치를 지우지 않는다.
      if (version.current === current) setListError(commonErrorMessage(loadError, '노트를 불러오지 못했습니다'))
    }).finally(() => {
      if (version.current === current) setLoading(false)
    })
  }, [userBookId])

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
  const locked = saving || blocked

  const dirty = editor !== null && JSON.stringify(editor.form) !== JSON.stringify(editor.initial)
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  async function write(request: (token: string) => Promise<unknown>, done: string, failed: (error: unknown) => string) {
    busy.current = true
    setSaving(true)
    onBusyChange(true)
    setError('')
    setMessage('')
    try {
      await withAccessToken(request)
      if (!active.current) return
      setEditor(null)
      setMessage(done)
      await reloadLoaded()
    } catch (writeError) {
      if (!active.current) return
      setError(failed(writeError))
      const notFound = writeError instanceof ApiError && writeError.status === 404
      // 수정하던 노트가 사라졌으면 입력을 새 노트로 저장할 수 있게 한다.
      if (notFound) setEditor((previous) => previous?.note ? { ...previous, note: null } : previous)
      // 결과가 불명확하거나 대상이 없으면 다시 보내지 않고 서버 목록만 확인한다.
      if (isUnclearWrite(writeError) || notFound) await reloadLoaded()
    } finally {
      busy.current = false
      if (active.current) {
        setSaving(false)
        onBusyChange(false)
      }
    }
  }

  function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor || busy.current || blocked) return
    const parsed = noteInput(editor.form, today)
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
    } else {
      void write((token) => createReadingNote(token, userBookId, parsed.input), '노트를 저장했습니다.', (saveError) =>
        isUnclearWrite(saveError) ? '저장 결과를 확인하지 못했습니다. 작성한 내용은 그대로 두었어요. 목록을 확인한 뒤 필요하면 다시 저장해주세요.'
          : saveError instanceof ApiError && saveError.status === 404 ? '서재에서 이 책을 찾을 수 없습니다.'
            : commonErrorMessage(saveError, '노트를 저장하지 못했습니다'))
    }
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
        <DatePicker label="날짜" value={editor.form.date} max={today} disabled={saving} onChange={(date) => setForm({ date })} />
        <div>
          <label htmlFor="note-quote">인상 깊은 문구</label>
          <textarea id="note-quote" rows={3} value={editor.form.quote} disabled={saving} onChange={(event) => setForm({ quote: event.target.value })} />
          <small className="counter">{charCount(editor.form.quote.trim())} / {QUOTE_LIMIT}</small>
        </div>
        <div>
          <label htmlFor="note-thought">생각</label>
          <textarea id="note-thought" rows={4} value={editor.form.thought} disabled={saving} onChange={(event) => setForm({ thought: event.target.value })} />
          <small className="counter">{charCount(editor.form.thought.trim())} / {THOUGHT_LIMIT}</small>
        </div>
        <div>
          <label htmlFor="note-page">페이지(선택)</label>
          <input id="note-page" inputMode="numeric" autoComplete="off" value={editor.form.page} disabled={saving} onChange={(event) => setForm({ page: event.target.value })} />
        </div>
        {error && <p role="alert">{error}</p>}
        <div className="timer-actions">
          <button type="submit" disabled={locked}>{saving ? '저장하는 중…' : '노트 저장'}</button>
          <button type="button" className="link-button" disabled={saving} onClick={() => { setEditor(null); setError('') }}>취소</button>
        </div>
      </form>
    ) : (
      <>
        {error && <p role="alert">{error}</p>}
        <button type="button" disabled={locked} onClick={() => { const form = noteForm(null, today); setEditor({ note: null, form, initial: form }); setError(''); setMessage('') }}>노트 쓰기</button>
      </>
    )}
    <p aria-live="polite">{message}</p>

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
      <NoteText note={item} />
    </li>)}</ul>}
    {listError && <div role="alert"><p>{listError}</p>
      <button type="button" className="secondary compact" disabled={loading} onClick={() => void reload(list?.offset ?? 0)}>노트 다시 불러오기</button></div>}
    {list?.more && !listError && <button type="button" className="secondary" disabled={loading || saving} onClick={() => void reload(list.offset)}>{loading ? '불러오는 중…' : '노트 더 보기'}</button>}
    <ConfirmDialog open={remove !== null} title="노트를 삭제할까요?" message="이 노트만 삭제하며 되돌릴 수 없습니다. 독서 체크와 공개 후기는 그대로 남습니다." confirmLabel="노트 삭제" danger onConfirm={confirmRemove} onCancel={() => setRemove(null)} />
  </section>
}
