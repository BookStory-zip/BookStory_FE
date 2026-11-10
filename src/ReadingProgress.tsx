import { useState } from 'react'
import type { SubmitEvent } from 'react'
import type { LibraryBookDetail, ProgressPatch } from './lib/api'
import { buildProgressPatch, canEditCurrentPage, progressInputFrom, totalPagesOf, typedTotalOf } from './lib/progress'
import type { ProgressInput } from './lib/progress'

type Props = {
  book: LibraryBookDetail
  busy: boolean
  saving: boolean
  // 저장 뒤 상세를 다시 조회한다. 서버 진도 값이 바뀌면 부모가 key로 이 카드를 새로 만들어 입력을 맞춘다.
  onSave: (patch: ProgressPatch) => Promise<void>
  onNoChange: () => void
}

// 전체 쪽수를 모르면 진도(%)를 표시하지 않는다. 계산은 서버 progress_percent를 쓴다.
export default function ReadingProgress({ book, busy, saving, onSave, onNoChange }: Props) {
  const [input, setInput] = useState<ProgressInput>(() => ({ ...progressInputFrom(book), total: String(totalPagesOf(book) ?? '') }))
  const [editingTotal, setEditingTotal] = useState(book.page_count === null)
  const [errors, setErrors] = useState<Partial<Record<'total' | 'current', string>>>({})
  const total = totalPagesOf(book)
  const editable = canEditCurrentPage(book.status)
  const percent = book.progress_percent
  const current = book.current_page ?? (book.status === 'completed' ? total : null)

  function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    // 표시용 도서 쪽수를 그대로 저장해 개인 쪽수로 만들지 않는다.
    const result = buildProgressPatch(book, { ...input, total: total !== null && input.total === String(total) ? progressInputFrom(book).total : input.total })
    if ('errors' in result) {
      setErrors(result.errors)
      document.getElementById(result.errors.total ? 'progress-total' : 'progress-current')?.focus()
      return
    }
    setErrors({})
    if (!Object.keys(result.patch).length) onNoChange()
    else void onSave(result.patch)
  }

  return (
    <form className="detail-card progress-card" onSubmit={save} aria-labelledby="progress-title" noValidate>
      <h2 id="progress-title">읽기 진도</h2>
      {percent !== null ? (
        <>
          <p className="goal-value">
            <strong>{percent}%</strong>
            {current !== null && total !== null && <span>· {current}/{total}쪽</span>}
          </p>
          <progress max={100} value={percent} aria-labelledby="progress-title" />
        </>
      ) : (
        <p className="result-note">
          {total === null
            ? '전체 쪽수를 몰라 진도를 표시하지 않아요. 전체 쪽수를 입력하면 진도를 기록할 수 있어요.'
            : book.status === 'want_to_read' ? '읽기 시작하면 현재 쪽을 기록할 수 있어요.' : '현재 쪽을 입력하면 진도를 보여 드려요.'}
        </p>
      )}

      <div>
        <label htmlFor="progress-total">전체 쪽수</label>
        <input id="progress-total" inputMode="numeric" autoComplete="off" value={input.total} disabled={busy} readOnly={!editingTotal}
          aria-invalid={errors.total ? true : undefined}
          aria-describedby={`progress-total-hint${errors.total ? ' progress-total-error' : ''}`}
          onChange={(event) => setInput({ ...input, total: event.target.value })} />
        {!editingTotal && <button type="button" className="secondary" disabled={busy} onClick={() => {
          setEditingTotal(true)
          document.getElementById('progress-total')?.focus()
        }}>직접 수정</button>}
        <p id="progress-total-hint" className="result-note">
          {book.page_count !== null
            ? editingTotal ? `비워 두면 도서 정보의 ${book.page_count}쪽을 써요.` : '도서 정보와 다르면 직접 수정할 수 있어요.'
            : '페이지 정보를 직접 입력해주세요.'}
        </p>
        {errors.total && <p id="progress-total-error" className="result-note is-error">{errors.total}</p>}
      </div>

      {editable ? (
        <div>
          <fieldset className="progress-unit" disabled={busy}>
            <legend>현재 위치</legend>
            {(['page', 'percent'] as const).map((unit) => (
              <label key={unit} className="review-toggle">
                <input type="radio" name="progress-unit" checked={input.unit === unit}
                  // %는 입력 중인 전체 쪽수(비우면 도서 정보 쪽수)를 알 때만 쪽으로 바꿀 수 있다.
                  disabled={unit === 'percent' && typedTotalOf(book, input.total) === null}
                  onChange={() => { setInput({ ...progressInputFrom(book, unit), total: input.total }); setErrors({}) }} />
                {unit === 'page' ? '쪽' : '%'}
              </label>
            ))}
          </fieldset>
          <label htmlFor="progress-current" className="visually-hidden">{input.unit === 'page' ? '현재 쪽' : '현재 진도(%)'}</label>
          <input id="progress-current" inputMode="numeric" autoComplete="off" value={input.current} disabled={busy}
            aria-invalid={errors.current ? true : undefined}
            aria-describedby={`progress-current-hint${errors.current ? ' progress-current-error' : ''}`}
            onChange={(event) => setInput({ ...input, current: event.target.value })} />
          <p id="progress-current-hint" className="result-note">
            {input.unit === 'page' ? '0쪽부터 전체 쪽수까지 입력할 수 있어요.' : '0~100%를 입력하면 해당 쪽으로 바꿔 저장해요.'} 비우면 현재 쪽을 지워요.
          </p>
          {errors.current && <p id="progress-current-error" className="result-note is-error">{errors.current}</p>}
        </div>
      ) : (
        <p className="result-note">
          {book.status === 'completed'
            ? total === null ? '완독한 책은 전체 쪽수를 입력하면 100%로 표시돼요.' : '완독한 책은 100%로 표시돼요.'
            : '현재 쪽은 읽는 중·중단·포기 상태에서 기록할 수 있어요.'}
        </p>
      )}

      <button type="submit" disabled={busy}>{saving ? '저장하는 중…' : '진도 저장'}</button>
    </form>
  )
}
