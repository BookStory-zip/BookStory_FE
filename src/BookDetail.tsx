import { useEffect, useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  ApiError,
  cancelReadingToday,
  checkReadingToday,
  deleteLibraryBook,
  getReadingLogs,
  getLibraryBook,
  readingStatuses,
  statusLabels,
  updateLibraryRecord,
  updateLibraryStatus,
  updateReadingProgress,
} from './lib/api'
import type { LibraryBookDetail, ProgressPatch, ReadingStatus, StatusChange } from './lib/api'
import { withAccessToken } from './lib/auth'
import { codeMessage, commonErrorMessage, isAuthFailure, isUnclearWrite, RELOGIN_MESSAGE } from './lib/errors'
import {
  buildRecordPatch,
  formatKstDate,
  kstDateOf,
  recordFormFrom,
} from './lib/record'
import type { RecordForm } from './lib/record'
import CabinIcon from './CabinIcon'
import ConfirmDialog from './ConfirmDialog'
import DatePicker from './DatePicker'
import { spokenDate } from './lib/dates'
import { useKstToday } from './useKstToday'
import ReadingNotes from './ReadingNotes'
import PastReadingDays from './PastReadingDays'
import ReadingProgress from './ReadingProgress'

type Pending = 'status' | 'record' | 'progress' | 'delete' | 'check' | 'refresh' | null
// conflict: 409. 화면이 오래된 상태라 서버 기준으로 다시 불러와야 한다.
type WriteResult = 'ok' | 'failed' | 'unclear' | 'conflict'

function loadErrorMessage(error: unknown) {
  // 타인 기록과 없는 기록은 같은 404이므로 구분하지 않는다.
  if (error instanceof ApiError && error.status === 404) return '서재에서 이 책을 찾을 수 없습니다.'
  return commonErrorMessage(error, '책 정보를 불러오지 못했습니다')
}

function saveErrorMessage(error: unknown) {
  if (isAuthFailure(error)) return RELOGIN_MESSAGE
  if (isUnclearWrite(error)) {
    return '저장 결과를 확인하지 못했습니다. 최신 상태를 다시 불러오고 있으니 확인 후 다시 시도해주세요.'
  }
  const byCode = codeMessage(error)
  if (byCode) return byCode
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return '지금 상태에서는 바꿀 수 없거나 날짜가 기존 기록과 맞지 않습니다.'
    }
    // 서버 검증 문구는 영어이므로 그대로 보여 주지 않는다.
    if (error.status === 422) return '입력값을 확인해주세요. 날짜와 글자 수를 다시 확인해주세요.'
    if (error.status === 404) return '서재에서 이 책을 찾을 수 없습니다.'
    if (error.status === 503) {
      return '서버가 잠시 응답할 수 없습니다. 입력은 그대로 두었으니 잠시 후 다시 시도해주세요.'
    }
  }
  return commonErrorMessage(error, '저장하지 못했습니다')
}

const sameForm = (a: RecordForm, b: RecordForm) =>
  a.rating === b.rating && a.memo === b.memo && a.stopReason === b.stopReason

// 다른 책으로 이동하면 새로 마운트해 이전 책의 늦은 응답과 입력을 버린다.
export default function BookDetailPage({ userId }: { userId: string }) {
  const { userBookId = '' } = useParams()
  return <BookDetail key={`${userId}:${userBookId}`} userBookId={userBookId} />
}

function BookDetail({ userBookId }: { userBookId: string }) {
  const navigate = useNavigate()
  const [book, setBook] = useState<LibraryBookDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [notesBusy, setNotesBusy] = useState(false)
  const [pastBusy, setPastBusy] = useState(false)
  const [form, setForm] = useState<RecordForm>({ rating: null, memo: '', stopReason: '' })
  const [nextStatus, setNextStatus] = useState<ReadingStatus | null>(null)
  const [startedDate, setStartedDate] = useState('')
  const [completedDate, setCompletedDate] = useState('')
  // 미리 채운 날짜를 그대로 두면 보내지 않아 서버의 원래 시각을 유지한다.
  const [prefilled, setPrefilled] = useState({ started: '', completed: '', completedIsToday: false })
  const [pending, setPending] = useState<Pending>(null)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [confirming, setConfirming] = useState<'reset' | 'delete' | 'catalog' | 'review-settings' | null>(null)
  const [todayLog, setTodayLog] = useState<'unknown' | 'checked' | 'unchecked' | 'error'>('unknown')
  const today = useKstToday()
  const todayRef = useRef(today)
  const todayLogVersion = useRef(0)
  const active = useRef(true)
  const pendingRef = useRef<Pending>(null)
  const bookRef = useRef<LibraryBookDetail | null>(null)

  // cleanForm과 같은(손대지 않은) 입력만 최신 값으로 맞추고, 그 뒤에 고친 입력은 보존한다.
  function applyFresh(fresh: LibraryBookDetail, cleanForm?: RecordForm) {
    if (!active.current) return
    const previous = bookRef.current
    const baseline = cleanForm ?? (previous ? recordFormFrom(previous) : null)
    bookRef.current = fresh
    setBook(fresh)
    setLoadError(null)
    setNeedsRefresh(false)
    setForm((current) =>
      baseline === null || sameForm(current, baseline) ? recordFormFrom(fresh) : current,
    )
  }

  function applyLoadError(error: unknown) {
    if (!active.current) return
    if (bookRef.current === null) setLoadError(loadErrorMessage(error))
    else {
      setNeedsRefresh(true)
      setNotice({ kind: 'error', text: loadErrorMessage(error) })
    }
  }

  // 저장 후에는 작은 응답 대신 상세 전체를 다시 조회한다.
  async function reload(cleanForm?: RecordForm) {
    try {
      applyFresh(await withAccessToken((token) => getLibraryBook(token, userBookId)), cleanForm)
      return true
    } catch (error) {
      applyLoadError(error)
      return false
    }
  }

  async function retryDetails() {
    if (pendingRef.current) return
    pendingRef.current = 'refresh'
    setPending('refresh')
    try {
      if (await reload() && active.current) setNotice(null)
    } finally {
      pendingRef.current = null
      if (active.current) setPending(null)
    }
  }

  useEffect(() => {
    active.current = true
    void reload()
    return () => {
      active.current = false
    }
    // 책 id가 바뀌면 key로 새로 마운트하므로 첫 조회는 마운트 때 한 번이면 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 오늘 체크 여부는 last_read_at이 아니라 오늘 기록(read_date + user_book_id)으로 판단한다.
  function loadTodayLog(day: string) {
    const version = ++todayLogVersion.current
    return withAccessToken((token) => getReadingLogs(token, day, day)).then(
      (logs) => {
        if (!active.current || day !== todayRef.current || version !== todayLogVersion.current) return
        setTodayLog(logs.some((log) => log.user_book_id === userBookId) ? 'checked' : 'unchecked')
      },
      () => {
        if (active.current && day === todayRef.current && version === todayLogVersion.current) setTodayLog('error')
      },
    )
  }

  useEffect(() => {
    todayRef.current = today
    void loadTodayLog(today)
    return () => { todayLogVersion.current += 1 }
    // 한국 날짜가 바뀌면 다시 확인한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today])

  async function handleCheck(cancel: boolean) {
    if (!book) return
    await run(
      'check',
      (token) => (cancel ? cancelReadingToday(token, book.id) : checkReadingToday(token, book.id)),
      cancel ? '오늘 체크를 취소했습니다.' : '오늘 읽은 날로 남겼습니다.',
      {
        conflict: '읽는 중인 책만 오늘 체크할 수 있습니다. 상태를 다시 불러왔습니다.',
        refresh: async () => {
          await Promise.all([loadTodayLog(todayRef.current), reload()])
        },
      },
    )
  }

  // 저장하지 않은 기록이 있으면 새로고침·창 닫기 전에 브라우저 확인을 띄워 입력을 지킨다.
  const recordDirty = book !== null && !sameForm(form, recordFormFrom(book))
  useEffect(() => {
    if (!recordDirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [recordDirty])

  async function run(
    kind: Exclude<Pending, null | 'refresh'>,
    write: (token: string) => Promise<unknown>,
    done: string,
    options: { conflict?: string; refresh?: (result: WriteResult) => Promise<void> } = {},
  ): Promise<WriteResult> {
    if (pendingRef.current || needsRefresh || notesBusy || pastBusy) return 'failed'
    pendingRef.current = kind
    setPending(kind)
    setNotice(null)
    try {
      let result: WriteResult
      try {
        await withAccessToken(write)
        if (active.current) setNotice({ kind: 'ok', text: done })
        result = 'ok'
      } catch (error) {
        const isConflict = error instanceof ApiError && error.status === 409
        const message = kind === 'check' && error instanceof ApiError && error.code === 'date_order'
          ? '현재 독서 시작일보다 이전 날짜에는 체크할 수 없어요.'
          : options.conflict && isConflict ? options.conflict : saveErrorMessage(error)
        if (active.current) setNotice({ kind: 'error', text: message })
        result = isConflict ? 'conflict' : isUnclearWrite(error) ? 'unclear' : 'failed'
      }
      // 재조회까지 한 작업으로 잠가 오래된 기준으로 다음 PATCH를 계산하지 않는다.
      if (active.current) await options.refresh?.(result)
      return result
    } finally {
      pendingRef.current = null
      if (active.current) setPending(null)
    }
  }

  // 재독 규칙(2026-10-28 확정): 읽고 싶음·완독·포기 → 읽는 중은 새 독서라 시작일을 채우지 않고,
  // 빈칸이면 서버가 오늘로 시작한다. 중단 후 재개·읽는 중 날짜 고치기·완독 전환은 기존 시작일을 채운다.
  // 읽는 중·중단에서 완독하면 완독일은 오늘(서버도 지금 시각을 씀)을 채운다.
  function chooseStatus(status: ReadingStatus) {
    if (!book) return
    const newReading =
      status === 'reading' && book.status !== 'reading' && book.status !== 'paused'
    const started = book.started_at && !newReading ? kstDateOf(book.started_at) : ''
    // 이미 완독한 책의 날짜 고치기는 기존 완독일을 채운다.
    const completed =
      status !== 'completed'
        ? ''
        : book.status === 'completed'
          ? book.completed_at
            ? kstDateOf(book.completed_at)
            : ''
          : book.status === 'reading' || book.status === 'paused'
            ? today
            : ''
    setNextStatus(status)
    setStartedDate(started)
    setCompletedDate(completed)
    setPrefilled({ started, completed, completedIsToday: completed !== '' && completed === today })
  }

  async function handleStatus(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!book || !nextStatus) return

    if (startedDate && completedDate && startedDate > completedDate) {
      setNotice({ kind: 'error', text: '시작일은 완독일보다 뒤일 수 없습니다.' })
      return
    }
    // 초기화가 따르는 되돌리기는 확인창에서 동의한 뒤 진행한다.
    if (nextStatus === 'want_to_read') setConfirming('reset')
    else await submitStatus()
  }

  async function submitStatus() {
    setConfirming(null)
    if (!book || !nextStatus) return
    const change: StatusChange = { status: nextStatus }
    // 미리 채운 시작일을 그대로 두면 보내지 않아 기존 시작일(또는 새 독서면 오늘)을 서버가 정한다.
    if (
      (nextStatus === 'reading' || nextStatus === 'completed') &&
      startedDate &&
      startedDate !== prefilled.started
    ) {
      change.started_date = startedDate
    }
    // 오늘로 채운 완독일을 연 채 한국 자정을 넘기면 화면에 보인 날짜를 그대로 보낸다.
    const staleToday = prefilled.completedIsToday && completedDate === prefilled.completed && completedDate !== today
    if (
      nextStatus === 'completed' &&
      completedDate &&
      (completedDate !== prefilled.completed || staleToday)
    ) {
      change.completed_date = completedDate
    }

    // 같은 상태로 보내면 BE가 날짜만 고친다. 바꾼 날짜가 없으면 보내지 않는다.
    const editingDates = nextStatus === book.status
    if (editingDates && !change.started_date && !change.completed_date) {
      setNotice({ kind: 'ok', text: '바뀐 날짜가 없습니다.' })
      return
    }

    const result = await run(
      'status',
      (token) => updateLibraryStatus(token, book.id, change),
      editingDates ? '날짜를 고쳤습니다.' : `상태를 ${statusLabels[nextStatus]}(으)로 바꿨습니다.`,
      { refresh: async (result) => { if (result !== 'failed') await reload() } },
    )
    if (result === 'ok') {
      setNextStatus(null)
      setStartedDate('')
      setCompletedDate('')
    }
  }

  // 숨겨진 중단 사유는 저장 대상에서 빼서 보이지 않는 값을 보내지 않는다.
  const showStopReason =
    book !== null &&
    (book.status === 'paused' || book.status === 'abandoned' || book.stop_reason !== null)

  async function handleRecord(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!book || pendingRef.current || needsRefresh) return
    const submitted = form
    const patch = buildRecordPatch(
      book,
      showStopReason ? submitted : { ...submitted, stopReason: book.stop_reason ?? '' },
    )
    if (Object.keys(patch).length === 0) {
      setNotice({ kind: 'ok', text: '바뀐 내용이 없습니다.' })
      return
    }
    await run(
      'record',
      (token) => updateLibraryRecord(token, book.id, patch),
      '기록을 저장했습니다.',
      { refresh: async (result) => {
        if (result === 'ok') await reload(submitted)
        else if (result === 'unclear') await reload()
      } },
    )
  }

  // 다시 보내지 않고 결과와 관계없이 상세를 다시 불러온다(2xx 뒤 응답 형식 오류도 저장됐을 수 있다).
  // 서버 진도 값이 그대로면 카드 key가 같아 입력이 남는다.
  async function saveProgress(patch: ProgressPatch) {
    if (!book) return
    await run(
      'progress',
      (token) => updateReadingProgress(token, book.id, patch),
      '진도를 저장했습니다.',
      { refresh: async () => { await reload() } },
    )
  }

  async function submitDelete() {
    setConfirming(null)
    if (!book) return
    const result = await run(
      'delete',
      (token) => deleteLibraryBook(token, book.id),
      '서재에서 뺐습니다.',
    )
    // 삭제 결과가 불명확하면 다시 보내지 않고 서재 목록에서 확인하게 한다.
    if (result === 'ok' || result === 'unclear') navigate('/', { replace: true })
  }

  if (loadError) {
    return (
      <section className="detail">
        <Link to="/" className="back-link">← 서재로</Link>
        <div className="library-note" role="alert">
          <p>{loadError}</p>
          <button type="button" className="secondary" disabled={pending !== null} onClick={() => void retryDetails()}>
            다시 시도
          </button>
        </div>
      </section>
    )
  }

  if (!book) {
    return (
      <section className="detail">
        <div className="cabin-loading">
          <CabinIcon className="cabin-icon" />
          <p>책을 꺼내는 중…</p>
        </div>
      </section>
    )
  }

  const busy = pending !== null || needsRefresh || notesBusy || pastBusy
  // BE는 읽는 중·완독 상태에 같은 상태로 날짜를 보내면 날짜만 고친다.
  const canEditDates = book.status === 'reading' || book.status === 'completed'

  return (
    <section className="detail" aria-labelledby="detail-title">
      <Link to="/" className="back-link">← 서재로</Link>

      <div className="detail-head">
        {book.thumbnail_url ? (
          <img className="detail-cover" src={book.thumbnail_url} alt="" width={120} height={174} fetchPriority="high" referrerPolicy="no-referrer" />
        ) : (
          <div className="detail-cover cover-empty" aria-hidden="true">{book.title.slice(0, 1)}</div>
        )}
        <div className="detail-info">
          <h1 id="detail-title">{book.title}</h1>
          <p className="book-authors">
            {[book.authors.join(', '), book.publisher, book.published_date]
              .filter(Boolean)
              .join(' · ') || '저자 정보 없음'}
          </p>
          <p className={`book-status status-${book.status}`}>{statusLabels[book.status]}</p>
          {book.has_completed && book.status !== 'completed' && (
            <p className="result-note">완독한 적이 있는 책입니다.</p>
          )}
          <Link to={`/catalog/${book.isbn13}`} onClick={(event) => {
            if (recordDirty) { event.preventDefault(); setConfirming('catalog') }
          }}>책 정보·공개 후기 보기</Link>
        </div>
      </div>

      <p className={`detail-notice ${notice?.kind === 'error' ? 'is-error' : ''}`} role="status">
        {notice?.text}
      </p>
      {needsRefresh && <div className="library-note">
        <p>최신 상태를 확인해야 다시 변경할 수 있습니다. 입력한 내용은 유지됩니다.</p>
        <button type="button" className="secondary" disabled={pending !== null} onClick={() => void retryDetails()}>
          {pending === 'refresh' ? '확인하는 중…' : '최신 상태 다시 확인'}
        </button>
      </div>}

      <dl className="detail-dates">
        <div><dt>시작일</dt><dd>{formatKstDate(book.started_at)}</dd></div>
        <div><dt>완독일</dt><dd>{formatKstDate(book.completed_at)}</dd></div>
        <div><dt>중단일</dt><dd>{formatKstDate(book.stopped_at)}</dd></div>
        <div><dt>최근 체크</dt><dd>{book.last_read_date ? spokenDate(book.last_read_date) : '없음'}</dd></div>
      </dl>

      {book.status !== 'reading' && todayLog === 'checked' && (
        <div className="today-actions">
          <button type="button" className="secondary compact" disabled={busy} onClick={() => void handleCheck(true)}>
            {pending === 'check' ? '취소하는 중…' : '오늘 체크 취소'}
          </button>
        </div>
      )}
      {book.status !== 'reading' && todayLog === 'error' && (
        <div className="today-actions">
          <p className="result-note">오늘 체크 여부를 확인하지 못했습니다.</p>
          <button type="button" className="secondary compact" disabled={busy} onClick={() => void loadTodayLog(today)}>다시 확인</button>
        </div>
      )}

      {book.status === 'reading' && <div className="detail-card today-card" aria-labelledby="today-title">
        <h2 id="today-title">오늘의 독서</h2>
        <p className="result-note">{spokenDate(today)} · 한국 시간 기준</p>
        {todayLog === 'unknown' && <p className="result-note">오늘 기록을 확인하는 중…</p>}
        {todayLog === 'error' && (
          <div className="today-actions">
            <p className="result-note">오늘 체크 여부를 확인하지 못했습니다.</p>
            <button type="button" className="secondary compact" onClick={() => void loadTodayLog(today)}>
              다시 확인
            </button>
          </div>
        )}
        {todayLog === 'checked' && (
          <div className="today-actions">
            <p className="today-done">오늘 읽은 날로 남겼어요</p>
            <button type="button" className="secondary compact" onClick={() => void handleCheck(true)} disabled={busy}>
              {pending === 'check' ? '취소하는 중…' : '체크 취소'}
            </button>
          </div>
        )}
        {todayLog === 'unchecked' && (
            <button type="button" onClick={() => void handleCheck(false)} disabled={busy}>
              {pending === 'check' ? '남기는 중…' : '오늘 읽었어요'}
            </button>
        )}
      </div>}

      <details className="detail-section" open={book.status !== 'reading'}>
      <summary>독서 상태</summary>
      <form className="detail-card" onSubmit={handleStatus} aria-labelledby="status-title">
        <h2 id="status-title">독서 상태</h2>
        <fieldset className="status-options" disabled={busy}>
          <legend className="visually-hidden">바꿀 상태</legend>
          {readingStatuses.map((status) => {
            // 고를 수 있는 상태는 서버가 준 allowed_statuses를 따른다. 현재 상태는 날짜 고치기용으로만 고른다.
            const blocked = status !== book.status && !book.allowed_statuses.includes(status)
            return (
              <label key={status} className={`status-option${status === book.status ? ' is-current' : ''}`}>
                <input
                  type="radio"
                  name="status"
                  value={status}
                  checked={(nextStatus ?? book.status) === status}
                  disabled={(status === book.status && !canEditDates) || blocked}
                  onClick={() => { if (nextStatus === null && status === book.status) chooseStatus(status) }}
                  onChange={() => chooseStatus(status)}
                />
                <span>{statusLabels[status]}</span>
                {status === book.status && <small>{canEditDates ? '현재 · 날짜 고치기' : '현재'}</small>}
                {blocked && <small>지금 상태에서는 고를 수 없습니다.</small>}
              </label>
            )
          })}
        </fieldset>

        {(nextStatus === 'reading' || nextStatus === 'completed') && (
          <DatePicker
            label="시작일 (선택)"
            value={startedDate}
            max={today}
            onChange={setStartedDate}
            disabled={busy}
          />
        )}
        {nextStatus === 'completed' && (
          <DatePicker
            label="완독일 (선택)"
            value={completedDate}
            max={today}
            onChange={setCompletedDate}
            disabled={busy}
          />
        )}
        {(nextStatus === 'reading' || nextStatus === 'completed') && (
          <p className="result-note">
            {nextStatus === book.status
              ? '바꾼 날짜만 고칩니다. 비워도 기존 날짜는 지워지지 않습니다. 날짜는 한국 시간 기준입니다.'
              : nextStatus === 'reading' && book.status !== 'paused'
                ? `새로 읽기 시작합니다. 시작일을 비워 두면 오늘부터 시작하고, 이전 완독일은 유지됩니다.${book.status === 'completed' || book.status === 'abandoned' ? ' 현재 쪽은 비워지고 전체 쪽수는 유지됩니다.' : ''} 날짜는 한국 시간 기준입니다.`
                : '그대로 두면 기존 날짜를 유지하고, 비우면 서버 규칙에 따라 비워 두거나 현재 시각으로 기록합니다. 날짜는 한국 시간 기준입니다.'}
          </p>
        )}

        <button type="submit" disabled={busy || nextStatus === null}>
          {pending === 'status'
            ? '바꾸는 중…'
            : nextStatus !== null && nextStatus === book.status
              ? '날짜 고치기'
              : '상태 바꾸기'}
        </button>
        <button type="button" className="secondary remove-book" onClick={() => setConfirming('delete')} disabled={busy}>
          {pending === 'delete' ? '빼는 중…' : '서재에서 빼기'}
        </button>
      </form>
      </details>

      <details className="detail-section" open={book.status !== 'reading'}>
      <summary>읽기 진도</summary>
      {/* 서버 진도 값이 바뀌면 새로 만들어 입력을 맞추고, 실패한 저장·상태만 바뀐 경우의 입력은 그대로 둔다. */}
      <ReadingProgress
        key={`${book.page_count}:${book.total_pages}:${book.current_page}`}
        book={book} busy={busy} saving={pending === 'progress'} onSave={saveProgress}
        onNoChange={() => setNotice({ kind: 'ok', text: '바뀐 진도가 없습니다.' })}
      />
      </details>

      {book.past_log_range && (
        <details className="detail-section" open={book.status !== 'reading'}>
          <summary>과거 읽은 날</summary>
          <PastReadingDays
            userBookId={book.id} range={book.past_log_range}
            blocked={pending !== null || needsRefresh || notesBusy}
            onChanged={reload} onBusyChange={setPastBusy}
          />
        </details>
      )}

      <details className="detail-section" open={book.status !== 'reading'}>
        <summary>나의 독서 노트</summary>
        <ReadingNotes key={book.id} userBookId={book.id} today={today} blocked={pending !== null || needsRefresh || pastBusy} onBusyChange={setNotesBusy} />
      </details>

      <details className="detail-section" open={book.status !== 'reading'}>
      <summary>나의 기록</summary>
      <form className="detail-card" onSubmit={handleRecord} aria-labelledby="record-title">
        <h2 id="record-title">나의 기록</h2>

        <fieldset className="rating" disabled={busy}>
          <legend>별점</legend>
          <div className="rating-stars">
            {[1, 2, 3, 4, 5].map((value) => (
              <label key={value} className="star">
                <input
                  type="radio"
                  name="rating"
                  value={value}
                  checked={form.rating === value}
                  onChange={() => setForm({ ...form, rating: value })}
                />
                <span aria-hidden="true">{form.rating !== null && value <= form.rating ? '★' : '☆'}</span>
                <span className="visually-hidden">{value}점</span>
              </label>
            ))}
            <button
              type="button"
              className="secondary compact"
              onClick={() => setForm({ ...form, rating: null })}
              disabled={form.rating === null}
            >
              별점 지우기
            </button>
          </div>
        </fieldset>

        <div>
          <label htmlFor="memo">후기</label>
          <textarea
            id="memo"
            rows={6}
            maxLength={10000}
            value={form.memo}
            onChange={(event) => setForm({ ...form, memo: event.target.value })}
            disabled={busy}
          />
          <small className="counter">{form.memo.length} / 10000</small>
        </div>

        <p className="result-note">공개 여부는 <Link to="/settings#review-settings" onClick={(event) => {
          if (recordDirty) { event.preventDefault(); setConfirming('review-settings') }
        }}>계정의 후기·별점 공개 설정</Link>을 따릅니다.</p>
        <p className="result-note">현재 저장된 기록: {book.is_review_public ? '공개' : '비공개'}</p>

        {showStopReason && (
          <div>
            <label htmlFor="stop-reason">중단 사유</label>
            <textarea
              id="stop-reason"
              rows={3}
              maxLength={1000}
              value={form.stopReason}
              onChange={(event) => setForm({ ...form, stopReason: event.target.value })}
              disabled={busy}
            />
            <small className="counter">{form.stopReason.length} / 1000</small>
          </div>
        )}

        <button type="submit" disabled={busy}>
          {pending === 'record' ? '저장하는 중…' : '기록 저장'}
        </button>
      </form>
      </details>

      <ConfirmDialog
        open={confirming === 'reset'}
        title="읽고 싶음으로 되돌릴까요?"
        message={
          book.has_completed
            ? '시작일·중단일·중단 사유와 현재 쪽이 초기화됩니다. 완독 경험이 있어 완독일·별점·후기, 전체 쪽수는 유지됩니다.'
            : '시작일·중단일·중단 사유·현재 쪽과 함께 완독일·별점·후기와 공개 후기도 초기화됩니다. 전체 쪽수는 유지됩니다.'
        }
        confirmLabel="되돌리기"
        onConfirm={() => void submitStatus()}
        onCancel={() => setConfirming(null)}
      />
      <ConfirmDialog
        open={confirming === 'delete'}
        title={`'${book.title}'을(를) 서재에서 뺄까요?`}
        message="이 책에 남긴 독서 체크·시간 기록·독서 노트와 공개 후기도 함께 삭제되고 책장에서도 빠지며 되돌릴 수 없습니다."
        confirmLabel="서재에서 빼기"
        danger
        onConfirm={() => void submitDelete()}
        onCancel={() => setConfirming(null)}
      />
      <ConfirmDialog
        open={confirming === 'catalog' || confirming === 'review-settings'}
        title="저장하지 않은 기록이 있습니다"
        message="수정한 후기·별점을 저장하지 않고 이동할까요?"
        confirmLabel="저장하지 않고 이동"
        onConfirm={() => navigate(confirming === 'review-settings' ? '/settings#review-settings' : `/catalog/${book.isbn13}`)}
        onCancel={() => setConfirming(null)}
      />
    </section>
  )
}
