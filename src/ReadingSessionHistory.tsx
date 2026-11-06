import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, deleteReadingSession, getReadingSessions } from './lib/api'
import type { ReadingSession } from './lib/api'
import { withAccessToken } from './lib/auth'
import { commonErrorMessage, isUnclearWrite } from './lib/errors'
import { spokenDate } from './lib/dates'
import ConfirmDialog from './ConfirmDialog'

type Props = { userBookId: string; blocked: boolean; onBusyChange: (busy: boolean) => void }
type History = { items: ReadingSession[]; offset: number; more: boolean }
const PAGE_SIZE = 20
const clock = (seconds: number) => [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':')

export default function ReadingSessionHistory({ userBookId, blocked, onBusyChange }: Props) {
  const [history, setHistory] = useState<History | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')
  const [remove, setRemove] = useState<string | null>(null)
  const active = useRef(true)
  const busy = useRef(false)
  const fetching = useRef(false)
  const version = useRef(0)

  const load = useCallback((offset: number) => {
    const run = ++version.current
    fetching.current = true
    return withAccessToken(token => getReadingSessions(token, userBookId, PAGE_SIZE, offset)).then(page => {
      if (!active.current || run !== version.current) return
      setHistory(previous => ({
        items: offset === 0 ? page : [...new Map([...(previous?.items ?? []), ...page].map(item => [item.id, item])).values()],
        offset: offset + page.length, more: page.length === PAGE_SIZE,
      }))
    }, (failure: unknown) => {
      if (active.current && run === version.current) setError(commonErrorMessage(failure, '시간 기록을 불러오지 못했습니다'))
    }).finally(() => {
      if (active.current && run === version.current) { setLoading(false); fetching.current = false }
    })
  }, [userBookId])

  useEffect(() => {
    active.current = true
    void load(0)
    return () => { active.current = false; version.current += 1; onBusyChange(false) }
  }, [load, onBusyChange])

  function refresh(offset = 0) { setLoading(true); setError(''); return load(offset) }

  async function confirmRemove() {
    const target = remove
    setRemove(null)
    if (!target || blocked || busy.current) return
    busy.current = true
    setSaving(true)
    onBusyChange(true)
    try {
      await withAccessToken(token => deleteReadingSession(token, target))
      if (!active.current) return
      setNote('시간 기록을 삭제했습니다. 독서 체크는 그대로 남습니다.')
      await refresh()
    } catch (failure) {
      if (!active.current) return
      setNote(isUnclearWrite(failure) ? '삭제 결과를 확인하지 못했습니다. 최신 시간 기록을 확인해주세요.' : commonErrorMessage(failure, '시간 기록을 삭제하지 못했습니다'))
      if (isUnclearWrite(failure) || (failure instanceof ApiError && failure.status === 404)) await refresh()
    } finally {
      busy.current = false
      if (active.current) { setSaving(false); onBusyChange(false) }
    }
  }

  return <div className="timer-history-content" aria-busy={saving}>
    <h3>저장한 시간</h3>
    {loading && !history && <p className="result-note">시간 기록을 불러오는 중…</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" className="secondary compact" disabled={loading || saving} onClick={() => void refresh()}>시간 기록 다시 확인</button></div>}
    {history?.items.length === 0 && <p className="result-note">아직 저장한 시간 기록이 없습니다.</p>}
    {history && history.items.length > 0 && <ul className="timer-history">{history.items.map(item => <li key={item.id}>
      <span><time dateTime={item.read_date}>{spokenDate(item.read_date)}</time><strong>{clock(item.duration_seconds)}</strong></span>
      <button type="button" className="link-button" disabled={blocked || saving} aria-label={`${spokenDate(item.read_date)} ${clock(item.duration_seconds)} 시간 기록 삭제`} onClick={() => setRemove(item.id)}>삭제</button>
    </li>)}</ul>}
    {history?.more && <button type="button" className="secondary" disabled={loading || saving} onClick={() => { if (!fetching.current) void refresh(history.offset) }}>{loading ? '불러오는 중…' : '시간 기록 더 보기'}</button>}
    <p aria-live="polite">{saving ? '시간 기록을 삭제하고 목록을 확인하는 중…' : note}</p>
    <ConfirmDialog open={remove !== null} title="시간 기록을 삭제할까요?" message="이 시간 기록만 삭제합니다. 그날의 독서 체크는 그대로 남습니다."
      confirmLabel="시간 기록 삭제" danger onConfirm={() => void confirmRemove()} onCancel={() => setRemove(null)} />
  </div>
}
