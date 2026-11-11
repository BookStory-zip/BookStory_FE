import { useCallback, useEffect, useRef, useState } from 'react'
import { getReviewSettings, updateReviewSettings } from './lib/api'
import { SessionMissingError, withAccessToken } from './lib/auth'
import { commonErrorMessage } from './lib/errors'

export default function ReviewSettings({ disabled = false }: { disabled?: boolean }) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const active = useRef(true)
  const writing = useRef(false)
  const readVersion = useRef(0)

  const load = useCallback(() => {
    const version = ++readVersion.current
    return withAccessToken(getReviewSettings).then(
      (value) => { if (active.current && version === readVersion.current) { setEnabled(value); setError(null) } },
      (failure: unknown) => {
        if (active.current && version === readVersion.current) { setEnabled(null); setError(commonErrorMessage(failure, '후기 공개 설정을 불러오지 못했습니다')) }
      },
    ).finally(() => { if (active.current && version === readVersion.current) setLoading(false) })
  }, [])

  useEffect(() => {
    active.current = true
    void load()
    return () => { active.current = false; readVersion.current += 1 }
  }, [load])

  async function toggle() {
    if (enabled === null || disabled || writing.current) return
    const next = !enabled
    writing.current = true
    readVersion.current += 1
    setSaving(true)
    setError(null)
    try {
      await withAccessToken((token) => {
        if (!active.current) throw new SessionMissingError()
        return updateReviewSettings(token, next)
      })
      if (active.current) setEnabled(next)
    } catch (failure) {
      if (!active.current) return
      // 응답 유실·서버 오류 뒤에는 다시 쓰지 않고 실제 공개 여부를 읽는다.
      try {
        const current = await withAccessToken(getReviewSettings)
        if (active.current) {
          setEnabled(current)
          setError(`${commonErrorMessage(failure, '후기 공개 설정을 변경하지 못했습니다')} 현재 설정을 다시 확인했습니다.`)
        }
      } catch {
        if (active.current) {
          setEnabled(null)
          setError('후기 공개 설정을 확인하지 못했습니다. 다시 확인한 뒤 변경해주세요.')
        }
      }
    } finally {
      writing.current = false
      if (active.current) setSaving(false)
    }
  }

  return (
    <section id="review-settings" tabIndex={-1} className="detail-card" aria-labelledby="review-settings-title" aria-busy={loading || saving}>
      <h2 id="review-settings-title">후기·별점 공개</h2>
      <p className="result-note">공개를 켜면 이전에 작성한 내용을 포함해 모든 책의 후기와 별점이 공개됩니다. 끄면 모두 비공개로 바뀌며 개인 기록은 유지됩니다.</p>
      {loading ? <p role="status">후기 공개 설정을 불러오는 중…</p> : enabled === null ? (
        <button type="button" className="secondary" disabled={disabled || saving} onClick={() => { setLoading(true); setError(null); void load() }}>다시 확인</button>
      ) : (
        <>
          <p role="status">{enabled ? '후기·별점 공개 중' : '후기·별점 비공개'}</p>
          <button type="button" className="secondary" aria-pressed={enabled} disabled={disabled || saving} onClick={() => void toggle()}>
            {enabled ? '후기·별점 공개 끄기' : '후기·별점 공개 켜기'}
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
