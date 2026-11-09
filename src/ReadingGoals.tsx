import { useEffect, useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import { ApiError, goalMetrics, saveGoals } from './lib/api'
import type { GoalChange, GoalMetric, GoalProgress } from './lib/api'
import { withAccessToken } from './lib/auth'
import { commonErrorMessage, isUnclearWrite } from './lib/errors'
import { goalLimit, parseGoalTarget } from './lib/goals'

const metricInfo: Record<GoalMetric, { label: string; unit: string }> = {
  reading_days: { label: '읽은 날', unit: '일' },
  completed_books: { label: '완독 권수', unit: '권' },
  reading_minutes: { label: '독서 시간', unit: '분' },
}

const sourceLabels: Record<GoalProgress['source'], string> = {
  set: '직접 설정',
  inherited: '이전 달에서 이어받음',
  sum: '월 목표 합계',
}

type Props = {
  year: number
  month: number | null
  goals: GoalProgress[]
  // 기간 통계를 다시 조회한다. 실패해도 기존 통계는 그대로 두고 false를 돌려준다.
  refresh: () => Promise<boolean>
  onBusyChange: (busy: boolean) => void
}

type Inputs = Record<GoalMetric, string>

// unclear: 쓰기 결과를 모름(입력 유지). stale: 저장은 됐지만 재조회 실패.
type Failure = { text: string; recheck?: 'unclear' | 'stale' }

// 입력칸에는 이 기간에 직접 정한 값만 채운다. 비어 있으면 이어받기·월 합계를 따른다.
function initialInputs(goals: GoalProgress[]): Inputs {
  const inputs = { reading_days: '', completed_books: '', reading_minutes: '' }
  for (const goal of goals) if (goal.source === 'set') inputs[goal.metric] = String(goal.target)
  return inputs
}

export default function ReadingGoals({ year, month, goals, refresh, onBusyChange }: Props) {
  const [open, setOpen] = useState(false)
  const [inputs, setInputs] = useState<Inputs>(() => initialInputs(goals))
  const [errors, setErrors] = useState<Partial<Record<GoalMetric, string>>>({})
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  // 화면을 떠난 뒤 늦게 끝난 저장이 재조회·상태 변경을 하지 않게 한다.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  useEffect(() => {
    const element = dialog.current
    const button = trigger.current
    if (!open || !element) return
    // jsdom 등 showModal이 없는 환경에서는 open 속성만 켠다.
    if (typeof element.showModal === 'function') element.showModal()
    else element.setAttribute('open', '')
    return () => {
      if (typeof element.close === 'function') element.close()
      else element.removeAttribute('open')
      // 팝업은 닫히면서 DOM에서 빠지므로 브라우저 기본 초점 복귀 대신 여는 버튼으로 돌려놓는다.
      button?.focus()
    }
  }, [open])

  const period = month === null ? `${year}년` : `${year}년 ${month}월`

  function changeBusy(next: boolean) {
    setBusy(next)
    onBusyChange(next)
  }

  function close() {
    if (busy) return
    setOpen(false)
    setFailure(null)
    setErrors({})
  }

  // 요청 대상(기간·값)은 호출 시점에 고정된다. 저장 중에는 기간 이동이 잠긴다.
  async function run(changes: GoalChange[] | null, closeOnSuccess: boolean) {
    if (busy) return
    changeBusy(true)
    setFailure(null)
    if (changes) {
      try {
        await withAccessToken((token) => saveGoals(token, { year, month, goals: changes }))
      } catch (error) {
        if (!alive.current) return
        // 한 번에 저장하므로 실패하면 하나도 바뀌지 않았다. 결과를 모를 때만 서버 상태를 확인한다.
        setFailure(isUnclearWrite(error)
          ? { text: '목표가 저장됐는지 확인하지 못했습니다. 다시 보내기 전에 최신 상태를 확인해주세요.', recheck: 'unclear' }
          : error instanceof ApiError && error.status === 422
            // ponytail: 입력 상한을 BE와 같게 미리 검사하므로 항목 위치(loc)는 읽지 않는다. 상한이 어긋나면 loc으로 칸을 짚는다.
            ? { text: `${period} 목표 중 정할 수 있는 범위를 넘은 값이 있어요. 입력을 확인해주세요.` }
            : { text: commonErrorMessage(error, '목표를 저장하지 못했습니다') })
        changeBusy(false)
        return
      }
      if (!alive.current) return
    }
    const ok = await refresh()
    if (!alive.current) return
    if (!ok) {
      setFailure(changes || failure?.recheck === 'stale'
        ? { text: '설정은 저장됐지만 최신 상태를 확인하지 못했습니다.', recheck: 'stale' }
        : { text: '최신 상태를 확인하지 못했습니다. 다시 시도해주세요.', recheck: 'unclear' })
    } else if (closeOnSuccess) {
      setOpen(false)
    }
    changeBusy(false)
  }

  function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    // 지금 통계와 다른 지표만 보낸다. 결과를 몰랐던 저장이 실제로 됐다면 다시 보내지 않는다.
    const initial = initialInputs(goals)
    const changes: GoalChange[] = []
    const nextErrors: Partial<Record<GoalMetric, string>> = {}
    for (const metric of goalMetrics) {
      const input = inputs[metric].trim()
      if (input === initial[metric]) continue
      if (!input) {
        changes.push({ metric, target: null })
        continue
      }
      const parsed = parseGoalTarget(input, goalLimit(metric, year, month))
      if ('error' in parsed) nextErrors[metric] = parsed.error
      else changes.push({ metric, target: parsed.target })
    }
    setErrors(nextErrors)
    const invalid = goalMetrics.find((metric) => nextErrors[metric])
    if (invalid) {
      setFailure(null)
      document.getElementById(`goal-input-${invalid}`)?.focus()
      return
    }
    if (!changes.length) {
      close()
      return
    }
    void run(changes, true)
  }

  function emptyHint(metric: GoalMetric) {
    const goal = goals.find((item) => item.metric === metric)
    const { unit } = metricInfo[metric]
    if (goal?.source === 'set') return month === null ? '비우면 직접 정한 값을 지우고 월 목표 합계로 돌아가요.' : '비우면 이 달에 정한 값을 지우고, 이전 달 목표가 있으면 이어받아요.'
    if (goal?.source === 'inherited') return `비워 두면 이전 달 목표(${goal.target ? `${goal.target}${unit}` : '꺼짐'})를 이어받아요.`
    if (goal?.source === 'sum') return `비워 두면 월 목표 합계(${goal.target}${unit})를 써요.`
    return '비워 두면 목표 없이 둬요.'
  }

  return (
    <section className="statistics-goals" aria-labelledby="statistics-goals-title">
      <div className="goal-head">
        <h3 id="statistics-goals-title">독서 목표</h3>
        <button
          ref={trigger} type="button" className="secondary compact" disabled={busy}
          aria-label={`${period} 독서 목표 ${goals.length ? '수정' : '설정'}`}
          onClick={() => {
            setInputs(initialInputs(goals))
            setErrors({})
            setFailure(null)
            setOpen(true)
          }}
        >{goals.length ? '수정' : '설정'}</button>
      </div>
      <ul className="goal-list">
        {goalMetrics.map((metric) => {
          const goal = goals.find((item) => item.metric === metric)
          const { label, unit } = metricInfo[metric]
          return (
            <li key={metric}>
              <h4 id={`goal-${metric}`}>{label} 목표</h4>
              {!goal ? (
                <p className="result-note">목표를 설정해보세요</p>
              ) : goal.target === 0 ? (
                <>
                  <p className="goal-value">목표 꺼짐</p>
                  <p className="result-note">{sourceLabels[goal.source]}</p>
                </>
              ) : (
                <>
                  <p className="goal-value">
                    <strong>{goal.current} / {goal.target}{unit}</strong>
                    {goal.current >= goal.target && <span className="goal-done">목표 달성</span>}
                  </p>
                  {/* 막대는 100%에서 멈추고, 실제 수치는 위 문구로 보여 준다. */}
                  <progress max={goal.target} value={Math.min(goal.current, goal.target)} aria-labelledby={`goal-${metric}`} />
                  <p className="result-note">{sourceLabels[goal.source]}</p>
                </>
              )}
            </li>
          )
        })}
      </ul>
      {open && (
        <dialog
          ref={dialog} className="confirm-dialog goal-dialog" aria-labelledby="goal-dialog-title" aria-busy={busy}
          onCancel={(event) => { event.preventDefault(); close() }}
          // 브라우저가 Esc 반복 등으로 직접 닫아도 상태를 맞춰 다시 열 수 있게 한다.
          onClose={() => setOpen(false)}
        >
          <form className="goal-form" onSubmit={save} noValidate>
            <h2 id="goal-dialog-title">{period} 독서 목표</h2>
            <p className="result-note">
              0을 입력하면 이 기간부터 목표를 꺼요.
              {month === null
                ? ' 연 목표를 직접 정하면 월 목표를 바꿔도 그대로 유지돼요.'
                : ' 이 목표는 다음 달에도 이어집니다. 지난 달 목표를 바꾸면 이후 이어받던 달도 함께 바뀔 수 있어요.'}
            </p>
            {goalMetrics.map((metric) => {
              const { label, unit } = metricInfo[metric]
              const error = errors[metric]
              return (
                <div key={metric}>
                  <label htmlFor={`goal-input-${metric}`}>{label}({unit})</label>
                  <input
                    id={`goal-input-${metric}`} inputMode="numeric" autoComplete="off" value={inputs[metric]}
                    disabled={busy} aria-invalid={error ? true : undefined}
                    aria-describedby={`goal-hint-${metric}${error ? ` goal-error-${metric}` : ''}`}
                    onChange={(event) => setInputs((current) => ({ ...current, [metric]: event.target.value }))}
                  />
                  <p id={`goal-hint-${metric}`} className="result-note">
                    0~{goalLimit(metric, year, month)}{unit}. {emptyHint(metric)}
                  </p>
                  {error && <p id={`goal-error-${metric}`} className="result-note is-error">{error}</p>}
                </div>
              )
            })}
            {failure && <p className="result-note is-error" role="alert">{failure.text}</p>}
            {failure?.recheck && (
              <button
                type="button" className="secondary" disabled={busy}
                onClick={() => void run(null, failure.recheck === 'stale')}
              >최신 상태 확인</button>
            )}
            <div className="goal-actions">
              <button type="button" className="secondary" disabled={busy} onClick={close}>취소</button>
              <button type="submit" disabled={busy}>{busy ? '저장하는 중…' : '저장'}</button>
            </div>
          </form>
        </dialog>
      )}
    </section>
  )
}
