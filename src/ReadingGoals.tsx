import { useEffect, useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import { ApiError, deleteGoal, goalMetrics, updateGoal } from './lib/api'
import type { GoalKey, GoalMetric, GoalProgress } from './lib/api'
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

// unclear: 쓰기 결과를 모름(입력 유지). stale: 저장은 됐지만 재조회 실패.
type Failure = { text: string; recheck?: 'unclear' | 'stale' }

export default function ReadingGoals({ year, month, goals, refresh, onBusyChange }: Props) {
  const [editing, setEditing] = useState<GoalMetric | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  // 화면을 떠난 뒤 늦게 끝난 저장이 재조회·상태 변경을 하지 않게 한다.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const period = month === null ? `${year}년` : `${year}년 ${month}월`

  function changeBusy(next: boolean) {
    setBusy(next)
    onBusyChange(next)
  }

  // 요청 대상(기간·지표·값)은 호출 시점에 고정된다. 저장 중에는 기간 이동이 잠긴다.
  async function run(write: ((token: string) => Promise<void>) | null, closeOnSuccess: boolean) {
    const metric = editing
    if (busy || metric === null) return
    changeBusy(true)
    setFailure(null)
    if (write) {
      try {
        await withAccessToken(write)
      } catch (error) {
        if (!alive.current) return
        const { label, unit } = metricInfo[metric]
        setFailure(isUnclearWrite(error)
          ? { text: '목표가 저장됐는지 확인하지 못했습니다. 다시 보내기 전에 최신 상태를 확인해주세요.', recheck: 'unclear' }
          : error instanceof ApiError && error.status === 422
            ? { text: `${period} ${label} 목표는 최대 ${goalLimit(metric, year, month)}${unit}까지 정할 수 있어요.` }
            : { text: commonErrorMessage(error, '목표를 저장하지 못했습니다') })
        changeBusy(false)
        return
      }
      if (!alive.current) return
    }
    const ok = await refresh()
    if (!alive.current) return
    if (!ok) {
      setFailure(write || failure?.recheck === 'stale'
        ? { text: '설정은 저장됐지만 최신 상태를 확인하지 못했습니다.', recheck: 'stale' }
        : { text: '최신 상태를 확인하지 못했습니다. 다시 시도해주세요.', recheck: 'unclear' })
    } else if (closeOnSuccess) {
      setEditing(null)
    }
    changeBusy(false)
  }

  function key(): GoalKey {
    return { metric: editing as GoalMetric, year, month }
  }

  function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (editing === null) return
    const parsed = parseGoalTarget(input, goalLimit(editing, year, month))
    if ('error' in parsed) {
      setFailure({ text: parsed.error })
      return
    }
    const body = { ...key(), target: parsed.target }
    void run((token) => updateGoal(token, body), true)
  }

  return (
    <section className="statistics-goals" aria-labelledby="statistics-goals-title">
      <h3 id="statistics-goals-title">독서 목표</h3>
      <ul className="goal-list">
        {goalMetrics.map((metric) => {
          const goal = goals.find((item) => item.metric === metric)
          const { label, unit } = metricInfo[metric]
          const limit = goalLimit(metric, year, month)
          return (
            <li key={metric}>
              <div className="goal-head">
                <h4 id={`goal-${metric}`}>{label} 목표</h4>
                {editing !== metric && (
                  <button
                    type="button" className="secondary compact" disabled={busy || editing !== null}
                    aria-label={`${label} 목표 ${goal ? '수정' : '설정'}`}
                    onClick={() => {
                      setEditing(metric)
                      // 꺼진 목표의 0을 채우면 저장 한 번에 다시 끄게 되므로 비워 둔다.
                      setInput(goal && goal.target > 0 ? String(goal.target) : '')
                      setFailure(null)
                    }}
                  >{goal ? '수정' : '설정'}</button>
                )}
              </div>
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
              {editing === metric && (
                <form className="goal-form" onSubmit={save} noValidate>
                  <div>
                    <label htmlFor={`goal-input-${metric}`}>{period} {label} 목표({unit})</label>
                    <input
                      id={`goal-input-${metric}`} inputMode="numeric" autoComplete="off" value={input}
                      disabled={busy} aria-describedby={`goal-hint-${metric}`}
                      onChange={(event) => setInput(event.target.value)}
                    />
                    <p id={`goal-hint-${metric}`} className="result-note">
                      1~{limit}{unit}까지 정할 수 있어요.
                      {month === null
                        ? ' 연 목표를 직접 정하면 월 목표를 바꿔도 그대로 유지돼요.'
                        : ' 이 목표는 다음 달에도 이어집니다. 지난 달 목표를 바꾸면 이후 이어받던 달도 함께 바뀔 수 있어요.'}
                    </p>
                  </div>
                  {failure && <p role="alert">{failure.text}</p>}
                  {failure?.recheck && (
                    <button
                      type="button" className="secondary" disabled={busy}
                      onClick={() => void run(null, failure.recheck === 'stale')}
                    >최신 상태 확인</button>
                  )}
                  <div className="goal-actions">
                    <button type="submit" disabled={busy}>{busy ? '저장하는 중…' : '저장'}</button>
                    {goal && goal.target > 0 && (
                      <button
                        type="button" className="secondary" disabled={busy}
                        onClick={() => { const body = { ...key(), target: 0 }; void run((token) => updateGoal(token, body), true) }}
                      >목표 끄기</button>
                    )}
                    {goal?.source === 'set' && (
                      <button
                        type="button" className="secondary" disabled={busy}
                        onClick={() => { const body = key(); void run((token) => deleteGoal(token, body), true) }}
                      >{month === null ? '월 목표 합계로 전환' : '이전 목표 이어받기'}</button>
                    )}
                    <button type="button" className="link-button" disabled={busy} onClick={() => { setEditing(null); setFailure(null) }}>취소</button>
                  </div>
                </form>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
