import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { ApiError } from './lib/api'
import { getBookAvailability, getRegions, rememberDistrict, savedDistrict } from './lib/book-availability'
import type { BookAvailability as Availability, OnlineStore, Region } from './lib/book-availability'
import { commonErrorMessage } from './lib/errors'

const RATE_LIMIT = 'rate_limited'
// IP 한도이므로 다른 책으로 이동하거나 계정을 바꿔도 대기 시간을 유지한다.
let blockedUntil = 0
const blockListeners = new Set<() => void>()
const getBlock = () => blockedUntil
function subscribeBlock(listener: () => void) {
  blockListeners.add(listener)
  return () => { blockListeners.delete(listener) }
}
function setBlock(until: number) {
  blockedUntil = until
  blockListeners.forEach(listener => listener())
}
function availabilityError(error: unknown, message: string) {
  if (error instanceof ApiError && error.status === 429) {
    const seconds = Math.max(1, Math.ceil(error.retryAfter ?? 60))
    setBlock(Math.max(blockedUntil, Date.now() + seconds * 1000))
    return RATE_LIMIT
  }
  return commonErrorMessage(error, message)
}

export default function BookAvailability({ isbn13, userId }: { isbn13: string; userId: string }) {
  const [tab, setTab] = useState<'online' | 'library'>('online')
  const [online, setOnline] = useState<OnlineStore[] | null>(null)
  const [onlineError, setOnlineError] = useState('')
  const [onlineLoading, setOnlineLoading] = useState(true)
  const [regions, setRegions] = useState<Region[] | null>(null)
  const [regionError, setRegionError] = useState('')
  const [regionsLoading, setRegionsLoading] = useState(false)
  const [province, setProvince] = useState('')
  const [district, setDistrict] = useState('')
  const [result, setResult] = useState<Availability | null>(null)
  const [libraryError, setLibraryError] = useState('')
  const [libraryLoading, setLibraryLoading] = useState(false)
  const retryAt = useSyncExternalStore(subscribeBlock, getBlock)
  const generation = useRef(0)
  const onlineBusy = useRef(false)
  const libraryBusy = useRef(false)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const loadOnline = useCallback(() => {
    if (onlineBusy.current) return
    const run = generation.current
    if (Date.now() < blockedUntil) return Promise.resolve().then(() => {
      if (run === generation.current) { setOnlineError(RATE_LIMIT); setOnlineLoading(false) }
    })
    onlineBusy.current = true
    return getBookAvailability(isbn13).then(data => {
      if (run === generation.current) setOnline(data.online)
    }, (error: unknown) => {
      const message = availabilityError(error, '온라인 서점 정보를 불러오지 못했습니다')
      if (run === generation.current) setOnlineError(message)
    }).finally(() => {
      if (run === generation.current) { onlineBusy.current = false; setOnlineLoading(false) }
    })
  }, [isbn13])

  useEffect(() => {
    const run = ++generation.current
    void loadOnline()
    return () => { generation.current = run + 1; onlineBusy.current = false; libraryBusy.current = false }
  }, [loadOnline])
  useEffect(() => {
    if (!retryAt) return
    const timer = window.setTimeout(() => {
      if (blockedUntil !== retryAt) return
      setBlock(0)
      setOnlineError(error => error === RATE_LIMIT ? '' : error)
      setRegionError(error => error === RATE_LIMIT ? '' : error)
      setLibraryError(error => error === RATE_LIMIT ? '' : error)
    }, Math.max(0, retryAt - Date.now()))
    return () => window.clearTimeout(timer)
  }, [retryAt])

  const loadRegions = useCallback(async () => {
    if (libraryBusy.current) return
    if (Date.now() < blockedUntil) { setRegionError(RATE_LIMIT); return }
    libraryBusy.current = true
    setRegionsLoading(true); setRegionError('')
    const run = generation.current
    try {
      const data = await getRegions()
      if (run !== generation.current) return
      setRegions(data)
      const saved = savedDistrict(userId)
      if (saved) {
        const parent = data.find(region => region.districts.some(item => item.code === saved))
        if (parent) { setProvince(parent.code); setDistrict(saved) }
        else { rememberDistrict(userId, ''); setLibraryError('이전에 선택한 지역이 없어졌습니다. 지역을 다시 선택해주세요.') }
      }
    } catch (error) {
      const message = availabilityError(error, '지역 목록을 불러오지 못했습니다')
      if (run === generation.current) setRegionError(message)
    } finally {
      if (run === generation.current) { libraryBusy.current = false; setRegionsLoading(false) }
    }
  }, [userId])
  function selectTab(value: 'online' | 'library') {
    setTab(value)
    if (value === 'library' && regions === null && !regionError) void loadRegions()
  }

  async function findLibraries(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!district || libraryBusy.current || Date.now() < blockedUntil) return
    libraryBusy.current = true
    setLibraryLoading(true); setLibraryError('')
    const run = generation.current
    try {
      const data = await getBookAvailability(isbn13, district)
      if (run !== generation.current) return
      setOnline(data.online); setOnlineError(''); setResult(data)
      rememberDistrict(userId, district)
    } catch (error) {
      const message = availabilityError(error, '도서관 정보를 불러오지 못했습니다')
      if (run !== generation.current) return
      if (error instanceof ApiError && error.code === 'region_not_found') {
        rememberDistrict(userId, ''); setProvince(''); setDistrict(''); setResult(null)
        setLibraryError('선택한 지역이 없어졌습니다. 지역을 다시 선택해주세요.')
      } else setLibraryError(message)
    } finally {
      if (run === generation.current) { libraryBusy.current = false; setLibraryLoading(false) }
    }
  }
  function changeTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index
    selectTab(next ? 'library' : 'online')
    tabs.current[next]?.focus()
  }
  const districts = regions?.find(item => item.code === province)?.districts ?? []
  const locked = libraryLoading || regionsLoading
  return <section className="detail-card book-availability" id="get-book" aria-labelledby="availability-title">
    <h2 id="availability-title">구매·대출</h2>
    <div className="availability-tabs" role="tablist" aria-label="책 구하는 방법">
      {(['online', 'library'] as const).map((value, index) => <button key={value} type="button" role="tab" id={`availability-tab-${value}`}
        ref={element => { tabs.current[index] = element }} aria-selected={tab === value} aria-controls={`availability-panel-${value}`}
        tabIndex={tab === value ? 0 : -1} onClick={() => selectTab(value)} onKeyDown={event => changeTab(event, index)}>{index ? '도서관' : '온라인'}</button>)}
    </div>
    {retryAt > 0 && <p className="result-note" role="status">요청이 잠시 제한되었습니다. 대기 후 직접 다시 시도해주세요.</p>}
    <div id="availability-panel-online" role="tabpanel" aria-labelledby="availability-tab-online" hidden={tab !== 'online'}>
      {online && <ul className="availability-stores">{online.map(store => <li key={store.store}><a href={store.url} target="_blank" rel="noreferrer">{store.name}에서 검색<span aria-hidden="true">↗</span></a></li>)}</ul>}
      {online?.length === 0 && <p className="result-note">온라인 서점 정보가 없습니다.</p>}
      {onlineLoading && <p className="result-note" role="status">온라인 서점을 불러오는 중…</p>}
      {onlineError && onlineError !== RATE_LIMIT && <p role="alert">{onlineError}</p>}
      {!onlineLoading && (online === null || !!onlineError) && <button type="button" className="secondary compact" disabled={retryAt > 0} onClick={() => { setOnlineLoading(true); setOnlineError(''); void loadOnline() }}>온라인 서점 다시 확인</button>}
    </div>
    <div id="availability-panel-library" role="tabpanel" aria-labelledby="availability-tab-library" hidden={tab !== 'library'}>
      {regionsLoading && <p className="result-note" role="status">지역 목록을 불러오는 중…</p>}
      {regionError && regionError !== RATE_LIMIT && <p role="alert">{regionError}</p>}
      {regions === null && !regionsLoading && <button type="button" className="secondary compact" disabled={retryAt > 0} onClick={() => void loadRegions()}>지역 목록 다시 확인</button>}
      {regions?.length === 0 && <p className="result-note">선택할 수 있는 지역이 없습니다.</p>}
      {regions !== null && regions.length > 0 && <form className="availability-region" onSubmit={event => void findLibraries(event)}>
        <label>시·도<select value={province} disabled={locked} required onChange={event => { setProvince(event.target.value); setDistrict(''); setResult(null); setLibraryError('') }}>
          <option value="">선택해 주세요</option>{regions.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
        </select></label>
        <label>시·군·구<select value={district} disabled={locked || !province} required onChange={event => { setDistrict(event.target.value); setResult(null); setLibraryError('') }}>
          <option value="">선택해 주세요</option>{districts.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
        </select></label>
        <button type="submit" disabled={locked || !district || retryAt > 0}>{libraryLoading ? '찾는 중…' : '도서관 찾기'}</button>
      </form>}
      {libraryError && libraryError !== RATE_LIMIT && <p role="alert">{libraryError}</p>}
      {result ? <>
        <div className="availability-basis"><span>{result.district?.name}</span><span>전일 집계 자료 · 실시간 정보 아님</span></div>
        {result.libraries === null ? <p role="status">도서관 정보를 불러오지 못했습니다. 다시 찾아주세요.</p>
          : result.libraries.length === 0 ? <p className="result-note" role="status">이 지역에는 이 책을 소장한 도서관이 없습니다.</p>
            : <ul className="availability-libraries">{result.libraries.map(item => <li key={item.lib_code}>
              <div className="availability-library-heading"><strong>{item.name}</strong><span className={item.loan_available === true ? 'loan-available' : 'result-note'}>{item.loan_available === true ? '대출 가능' : item.loan_available === false ? '대출 불가' : '대출 여부 미확인'}</span></div>
              {item.address && <p className="result-note">{item.address}</p>}
              {(item.operating_time || item.closed || item.tel) && <details className="availability-hours"><summary>운영 정보</summary><dl>
                {item.operating_time && <><dt>운영시간</dt><dd>{item.operating_time}</dd></>}
                {item.closed && <><dt>휴관일</dt><dd>{item.closed}</dd></>}
                {item.tel && <><dt>전화</dt><dd>{item.tel}</dd></>}
              </dl></details>}
              {item.homepage && <a href={item.homepage} target="_blank" rel="noreferrer">홈페이지<span className="visually-hidden"> · {item.name}</span><span aria-hidden="true"> ↗</span></a>}
            </li>)}</ul>}
        <p className="availability-credit result-note">자료: 도서관 정보나루</p>
      </> : !regionError && <p className="result-note">지역을 선택한 뒤 도서관 찾기를 눌러주세요.</p>}
    </div>
  </section>
}
