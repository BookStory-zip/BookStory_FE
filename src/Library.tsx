import { useEffect, useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import { ApiError, getLibraryBooks, getShelves, moveLibraryBook, readingStatuses, statusLabels } from './lib/api'
import type { LibraryBookItem, LibraryFilter, LibrarySort, ReadingStatus, Shelf } from './lib/api'
import { withAccessToken } from './lib/auth'
import { codeMessage, commonErrorMessage, isUnclearWrite } from './lib/errors'
import { Link } from 'react-router'
import CabinIcon from './CabinIcon'
import ShelfManager from './ShelfManager'
import LibraryShelfActions from './LibraryShelfActions'
import OrderHandle from './OrderHandle'

export const PAGE_SIZE = 20
const MAX_LIMIT = 100
const SCROLL_EDGE = 80
const SCROLL_STEP = 12
// BE와 같이 앞뒤 공백 제거·NFC 정규화 뒤 코드 포인트로 센다.
const QUERY_LIMIT = 200
type Field = NonNullable<LibraryFilter['field']>
// 카드 제목 끝의 설명 괄호 하나. 숫자·(상)(중)(하)·(N권)·(제N권)·(Vol. N) 같은 권 표시는 남겨 권을 구분한다.
const TRAILING_NOTE = /\s*\((?!\s*(?:\d+|[상중하]|제?\s*\d+\s*권|vol\.?\s*\d+)\s*\))[^()]*\)\s*$/i

function makeFilter({ q, field, status, shelf_id, sort }: LibraryFilter): LibraryFilter {
  return { ...(q && { q, field: field ?? 'title' }), ...(status && { status }), ...(shelf_id && { shelf_id }), ...(sort && sort !== 'custom' && { sort }) }
}

// 조건 조회를 서버가 거부했을 때 되돌아갈 조건과 안내.
type Fallback = { filter: LibraryFilter; message: string; kind: 'search' | 'shelf' | 'sort' }

// 손가락·마우스 아래의 책 순번. 서재 밖이면 null.
function bookIndexAt(shelf: HTMLElement | null, x: number, y: number) {
  const target = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-book-index]')
  return target && shelf?.contains(target) ? Number(target.dataset.bookIndex) : null
}

function errorMessage(error: unknown) {
  return commonErrorMessage(error, '서재를 불러오지 못했습니다')
}

// 계정이 바뀌면 부모가 key로 새로 마운트하므로 이전 계정 목록이 남지 않는다.
export default function Library() {
  const [books, setBooks] = useState<LibraryBookItem[]>([])
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [slow, setSlow] = useState(false)
  const active = useRef(true)
  const busy = useRef(false)
  const loadVersion = useRef(0)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [notice, setNotice] = useState('')
  const [orderError, setOrderError] = useState('')
  const [dragTarget, setDragTarget] = useState<number | null>(null)
  const dragRef = useRef<{ from: number; to: number; pointerId: number; x: number; y: number; started: boolean } | null>(null)
  const dragging = dragTarget !== null
  const shelf = useRef<HTMLUListElement>(null)
  const listStart = useRef<HTMLDivElement>(null)
  const management = useRef<HTMLDetailsElement>(null)
  const searchButton = useRef<HTMLButtonElement>(null)
  const queryInput = useRef<HTMLInputElement>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [managementOpen, setManagementOpen] = useState(false)
  const listEnd = useRef<HTMLDivElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const editButton = useRef<HTMLButtonElement>(null)
  const refreshButton = useRef<HTMLButtonElement>(null)
  const focusAfterMove = useRef<string | null>(null)
  const locked = saving || loadingMore || needsRefresh
  // 적용 중인 조건. 요청은 ref로 읽어 조건을 바꾼 직후의 조회에도 새 조건을 쓴다.
  const [filter, setFilter] = useState<LibraryFilter>({})
  const filterRef = useRef<LibraryFilter>({})
  // 서버가 새 조건을 422로 거부하면 되돌아갈 직전 조건.
  const previousFilter = useRef<LibraryFilter>({})
  const [query, setQuery] = useState('')
  const [field, setField] = useState<Field>('title')
  const [searchError, setSearchError] = useState('')
  const [sortError, setSortError] = useState('')
  const [shelves, setShelves] = useState<Shelf[] | null>(null)
  const [shelvesError, setShelvesError] = useState('')
  const [managing, setManaging] = useState(false)
  const [shelfBusy, setShelfBusy] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const shelvesVersion = useRef(0)
  // 필터 결과의 순서를 전체 서재 순서로 오해해 저장하지 않도록 필터 중에는 순서 편집을 막는다.
  const filtered = Boolean(filter.q || filter.status || filter.shelf_id)
  const customOrder = !filter.sort || filter.sort === 'custom'
  const filterLocked = editing || selecting || saving || needsRefresh || shelfBusy

  // 빈 그리드에서도 실제 열 폭을 읽는다. 측정할 수 없으면 기존 20권을 쓴다.
  function visibleCapacity() {
    const grid = shelf.current
    if (!grid || !grid.clientWidth || !listStart.current) return PAGE_SIZE
    const style = getComputedStyle(grid)
    const tracks = style.gridTemplateColumns.split(' ').map(Number.parseFloat).filter(Number.isFinite)
    if (!tracks.length) return PAGE_SIZE
    const first = grid.children[0]?.getBoundingClientRect()
    const next = grid.children[tracks.length]?.getBoundingClientRect()
    const gap = Number.parseFloat(style.rowGap) || 0
    const rowHeight = first?.height || tracks[0] * 0.84 * 1.5 + 100
    const pitch = next && first ? next.top - first.top : rowHeight + gap
    const available = window.innerHeight - listStart.current.getBoundingClientRect().top - (Number.parseFloat(style.paddingTop) || 0)
    return tracks.length * Math.max(1, Math.ceil(available / Math.max(1, pitch)))
  }

  function initialLimit() {
    return Math.min(MAX_LIMIT, Math.max(PAGE_SIZE, visibleCapacity()))
  }

  function closeManagement() {
    setManagementOpen(false)
    if (management.current) {
      management.current.querySelector('summary')?.focus()
    }
  }

  useEffect(() => {
    if (!managementOpen) return
    const close = (event: PointerEvent) => {
      if (!management.current?.contains(event.target as Node)) setManagementOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [managementOpen])

  async function refreshShelfBooks(successfulIds: string[]) {
    setSelectedIds((current) => current.filter((id) => !successfulIds.includes(id)))
    const list = await loadShelves()
    if (!list || !active.current) return false
    if (filterRef.current.shelf_id && !list.some((item) => item.id === filterRef.current.shelf_id)) {
      apply(makeFilter({ ...filterRef.current, shelf_id: undefined }))
      setNotice('보던 책장이 목록에 없어 전체 책장으로 돌아왔어요.')
      return true
    }
    return await load(0, true, Math.max(books.length, PAGE_SIZE)) === true
  }

  // book_count는 서버 값만 쓴다. 실패하면 null, 더 새 요청에 밀렸으면 undefined(그 요청이 목록을 채운다).
  function loadShelves(): Promise<Shelf[] | null | undefined> {
    const run = ++shelvesVersion.current
    return withAccessToken(getShelves).then((list) => {
      if (!active.current || run !== shelvesVersion.current) return undefined
      setShelves(list)
      setShelvesError('')
      return list
    }, (failure: unknown) => {
      if (!active.current || run !== shelvesVersion.current) return undefined
      setShelvesError(commonErrorMessage(failure, '책장을 불러오지 못했습니다'))
      return null
    })
  }

  // 책장 쓰기 뒤의 재조회. 보던 책장이 목록에 없으면(삭제·다른 탭 변경) 전체 책장으로 돌아간다.
  async function refreshShelves() {
    const list = await loadShelves()
    if (list === null) return false
    const shelfId = filterRef.current.shelf_id
    if (list && shelfId && !list.some((shelf) => shelf.id === shelfId) && active.current) {
      apply(makeFilter({ ...filterRef.current, shelf_id: undefined }))
      setNotice('보던 책장이 목록에 없어 전체 책장으로 돌아왔어요.')
    }
    return true
  }

  // 첫 조회는 초기 상태가 이미 loading이므로 화면 상태 전환은 버튼 핸들러에서만 한다.
  // 조건 조회를 서버가 거부하면 되돌아갈 조건과 안내를 돌려준다(되돌리기는 apply가 한다).
  async function load(offset: number, preserve = false, limit = PAGE_SIZE): Promise<boolean | Fallback> {
    busy.current = true
    const version = ++loadVersion.current

    // Render 무료 인스턴스는 첫 응답이 늦을 수 있다.
    const slowTimer = setTimeout(() => {
      if (active.current && version === loadVersion.current) setSlow(true)
    }, 4000)
    try {
      const requestFilter = filterRef.current
      // API 최대치를 넘는 재조회는 구간을 나눠 동시에 받고, 짧은 구간 뒤는 버린다.
      const sizes = Array.from({ length: Math.ceil(limit / MAX_LIMIT) }, (_, index) => Math.min(MAX_LIMIT, limit - index * MAX_LIMIT))
      const page = await withAccessToken(async (token) => {
        const chunks = await Promise.all(sizes.map((size, index) => getLibraryBooks(token, size, offset + index * MAX_LIMIT, requestFilter)))
        const short = chunks.findIndex((chunk, index) => chunk.length < sizes[index])
        return (short === -1 ? chunks : chunks.slice(0, short + 1)).flat()
      })
      if (!active.current || version !== loadVersion.current) return false
      setBooks((current) => (offset === 0 ? page : [...current, ...page]))
      setHasMore((previous) => page.length === limit && (!preserve || previous))
      setError(null)
      setPhase('ready')
      return true
    } catch (loadError) {
      if (!active.current || version !== loadVersion.current) return false
      // 같은 조건을 다시 보내도 422이므로 재시도 대신 이전 조건으로 돌아가 입력란에 이유를 알린다.
      if (offset === 0 && !preserve && loadError instanceof ApiError && loadError.status === 422 && filterRef.current !== previousFilter.current) {
        if (filterRef.current.sort !== previousFilter.current.sort) {
          return { filter: previousFilter.current, message: '정렬 조건을 적용하지 못해 이전 정렬로 돌아왔어요.', kind: 'sort' }
        }
        return { filter: previousFilter.current, message: codeMessage(loadError) ?? '검색 조건을 확인해주세요.', kind: 'search' }
      }
      // 선택한 책장이 삭제됐으면 원인을 추정하지 않고 책장 목록을 다시 받은 뒤 전체 책장으로 돌아간다.
      if (offset === 0 && !preserve && loadError instanceof ApiError && loadError.status === 404 && filterRef.current.shelf_id) {
        return { filter: makeFilter({ ...filterRef.current, shelf_id: undefined }), message: '선택한 책장을 찾을 수 없어 전체 책장으로 돌아왔어요.', kind: 'shelf' }
      }
      setError(errorMessage(loadError))
      if (offset === 0 && !preserve) setPhase('error')
      return false
    } finally {
      clearTimeout(slowTimer)
      if (active.current && version === loadVersion.current) {
        busy.current = false
        setSlow(false)
        setLoadingMore(false)
      }
    }
  }

  // 조건이 바뀌면 처음부터 다시 조회한다. 이전 조건의 늦은 응답은 load의 version으로 버린다.
  function apply(next: LibraryFilter, remember = true) {
    if (remember) previousFilter.current = filterRef.current
    filterRef.current = next
    setFilter(next)
    setBooks([])
    setHasMore(false)
    setError(null)
    setOrderError('')
    setNotice('')
    setSearchError('')
    setSortError('')
    setSlow(false)
    setLoadingMore(false)
    setPhase('loading')
    loadFirstPage()
  }

  // 조건을 바꾸거나 다시 시도할 때 첫 페이지를 받는다. 서버가 조건을 거부하면 되돌아간다.
  function loadFirstPage() {
    void load(0, false, initialLimit()).then((fallback) => {
      if (typeof fallback !== 'object' || !active.current) return
      apply(fallback.filter, false)
      if (fallback.kind === 'search') { setSearchError(fallback.message); setSearchOpen(true) }
      else if (fallback.kind === 'sort') { setSortError(fallback.message); setFiltersOpen(true) }
      else {
        setNotice(fallback.message)
        void loadShelves()
      }
    })
  }

  function submitSearch(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (filterLocked) return
    const q = query.trim().normalize('NFC')
    if (!q) return setSearchError('검색어를 입력해주세요.')
    if ([...q].length > QUERY_LIMIT) return setSearchError(`검색어는 ${QUERY_LIMIT}자까지 입력할 수 있어요.`)
    apply(makeFilter({ ...filter, q, field }))
  }

  function clearSearch() {
    if (filterLocked) return
    setQuery('')
    apply(makeFilter({ ...filter, q: undefined }))
  }

  function retry() {
    if (busy.current) return
    setError(null)
    setPhase('loading')
    loadFirstPage()
  }

  function loadMore(limit = PAGE_SIZE) {
    if (!hasMore || busy.current || locked || dragRef.current?.started || shelfBusy) return
    setError(null)
    setLoadingMore(true)
    void load(books.length, false, limit)
  }

  // 페이지가 바뀔 때 관찰을 다시 시작해 화면이 덜 찼으면 다음 페이지도 이어 받는다.
  // loadMore가 읽는 값이 바뀔 때만 다시 만든다. 그 밖의 값은 ref라 최신이다.
  const booksLength = books.length
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !listEnd.current || phase !== 'ready' || !hasMore || error || locked || dragging || shelfBusy) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore()
    }, { rootMargin: '240px' })
    observer.observe(listEnd.current)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, hasMore, error, locked, dragging, shelfBusy, booksLength])

  useEffect(() => {
    if (phase !== 'ready' || !hasMore || error || locked || dragging || shelfBusy) return
    const fill = () => {
      const missing = visibleCapacity() - booksLength
      if (missing > 0) loadMore(Math.min(MAX_LIMIT, missing))
    }
    const frame = requestAnimationFrame(fill)
    window.addEventListener('resize', fill)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fill)
    if (shelf.current) observer?.observe(shelf.current)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', fill); observer?.disconnect() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, hasMore, error, locked, dragging, shelfBusy, booksLength, searchOpen, filtersOpen])

  useEffect(() => {
    active.current = true
    if (!busy.current) void load(0, false, initialLimit())
    void loadShelves()
    return () => {
      active.current = false
      loadVersion.current += 1
      busy.current = false
    }
    // 첫 마운트에서만 조회한다. 이후 조건 변경은 apply가 처리한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (saving || !focusAfterMove.current) return
    const handle = shelf.current?.querySelector<HTMLButtonElement>(`[data-user-book-id="${focusAfterMove.current}"]`)
    // 다시 불러온 범위 밖으로 옮겨진 책은 편집 버튼으로 포커스를 돌린다.
    const target = needsRefresh ? refreshButton.current : handle ?? editButton.current ?? title.current
    target?.focus()
    if (!needsRefresh) focusAfterMove.current = null
  }, [saving, needsRefresh])

  // 드래그 중 화면 가장자리에서 자동 스크롤하고, Safari처럼 손잡이에 포커스가 없어도 Escape로 취소한다.
  useEffect(() => {
    if (!dragging) return
    let frame = requestAnimationFrame(function step() {
      const current = dragRef.current
      if (!current) return
      const dy = current.y < SCROLL_EDGE ? -SCROLL_STEP : current.y > window.innerHeight - SCROLL_EDGE ? SCROLL_STEP : 0
      if (dy) {
        window.scrollBy(0, dy)
        current.to = bookIndexAt(shelf.current, current.x, current.y) ?? current.from
        setDragTarget(current.to)
      }
      frame = requestAnimationFrame(step)
    })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      dragRef.current = null
      setDragTarget(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [dragging])

  async function refreshOrder(message: string, count = books.length) {
    setNeedsRefresh(true)
    setError(null)
    // 더 보기로 불러온 범위까지 다시 읽어 옮긴 책이 화면에서 사라지지 않게 한다.
    if (await load(0, true, Math.max(count, PAGE_SIZE))) {
      if (!active.current) return
      setNeedsRefresh(false)
      setNotice(message)
    } else if (active.current) {
      setNotice('최신 순서를 확인한 뒤 다시 옮길 수 있어요.')
    }
  }

  async function move(from: number, to: number) {
    if (!customOrder || filtered || busy.current || locked || from === to || to < 0 || to >= books.length) return
    const moved = books[from]
    const remaining = books.filter((book) => book.id !== moved.id)
    const anchor = to === 0 ? null : remaining[to - 1].id
    busy.current = true
    focusAfterMove.current = moved.id
    setSaving(true)
    setNotice('')
    setOrderError('')
    const slowTimer = setTimeout(() => {
      if (active.current) setSlow(true)
    }, 4000)
    try {
      await withAccessToken((token) => moveLibraryBook(token, moved.id, anchor))
      clearTimeout(slowTimer)
      if (!active.current) return
      await refreshOrder('순서를 저장했습니다.')
    } catch (moveError) {
      if (!active.current) return
      if (isUnclearWrite(moveError) || (moveError instanceof ApiError && moveError.status === 404)) {
        await refreshOrder('최신 서재 순서를 불러왔습니다. 이동 결과를 확인해주세요.')
      } else {
        // 목록 조회 오류와 나눠 이어 받기·다시 불러오기를 막지 않는다.
        setOrderError(commonErrorMessage(moveError, '순서를 바꾸지 못했습니다'))
      }
    } finally {
      clearTimeout(slowTimer)
      if (active.current) {
        busy.current = false
        setSaving(false)
        setSlow(false)
      }
    }
  }

  async function retryOrder() {
    if (busy.current) return
    setSaving(true)
    try {
      await refreshOrder('최신 서재 순서를 확인했습니다.')
    } finally {
      if (active.current) setSaving(false)
    }
  }

  function cancelDrag() {
    dragRef.current = null
    setDragTarget(null)
  }

  function updateDrag(event: { pointerId: number; clientX: number; clientY: number }) {
    const current = dragRef.current
    if (!current || current.pointerId !== event.pointerId) return
    if (!current.started && Math.hypot(event.clientX - current.x, event.clientY - current.y) <= 6) return
    current.started = true
    current.x = event.clientX
    current.y = event.clientY
    current.to = bookIndexAt(shelf.current, current.x, current.y) ?? current.from
    setDragTarget(current.to)
  }

  return (
    <section className="library" aria-labelledby="library-title" aria-busy={phase === 'loading'}>
      <h1 id="library-title" ref={title} tabIndex={-1}>내 서재</h1>
      <div className="library-toolbar">
        <button ref={searchButton} type="button" className="secondary compact" aria-label="서재 검색"
          aria-expanded={searchOpen} aria-controls="library-search-panel" disabled={filterLocked}
          onClick={() => {
            setSearchOpen(!searchOpen)
            if (!searchOpen) requestAnimationFrame(() => queryInput.current?.focus())
            else searchButton.current?.focus()
          }}>검색</button>
        <button type="button" className="secondary compact library-filter-toggle" aria-expanded={filtersOpen}
          aria-controls="library-filter-panel" onClick={() => setFiltersOpen(!filtersOpen)}>필터·정렬</button>
        <div id="library-filter-panel" className={`library-filters${filtersOpen ? ' is-open' : ''}`}>
          <div className="library-filter">
            <label htmlFor="library-sort">서재 정렬</label>
            <select id="library-sort" value={filter.sort ?? 'custom'} disabled={filterLocked}
              aria-invalid={sortError ? true : undefined} aria-describedby={sortError ? 'library-sort-error' : undefined}
              onChange={(event) => apply(makeFilter({ ...filter, sort: event.target.value as LibrarySort }))}>
              <option value="custom">직접 정한 순서</option>
              <option value="created">서재 등록 최신순</option>
              <option value="started">읽기 시작 최신순</option>
            </select>
          </div>
          <div className="library-filter">
            <label htmlFor="library-status">읽기 상태</label>
            <select id="library-status" value={filter.status ?? ''} disabled={filterLocked}
              onChange={(event) => {
                if (filter.field) setField(filter.field)
                apply(makeFilter({ ...filter, status: (event.target.value || undefined) as ReadingStatus | undefined }))
              }}>
              <option value="">전체</option>
              {readingStatuses.filter((status) => status !== 'paused' && status !== 'abandoned').map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
            </select>
          </div>
          {shelves && shelves.length > 0 && <div className="library-filter">
            <label htmlFor="library-shelf">책장</label>
            <select id="library-shelf" value={filter.shelf_id ?? ''} disabled={filterLocked}
              onChange={(event) => {
                if (filter.field) setField(filter.field)
                apply(makeFilter({ ...filter, shelf_id: event.target.value || undefined }))
              }}>
              <option value="">전체</option>
              {shelves.map((shelf) => <option key={shelf.id} value={shelf.id}>{shelf.name} ({shelf.book_count}권)</option>)}
            </select>
          </div>}
        </div>
        {/* Safari는 탭한 버튼 대신 바깥 조상(#content, tabIndex -1)에 포커스를 줘서 click 전에 blur가 온다.
            그래서 Tab 순서에 있는 바깥 요소로 나갈 때만 blur로 닫고, 바깥 탭은 pointerdown, Escape는 키 처리로 닫는다. */}
        <details ref={management} open={managementOpen} className="library-management"
          onBlur={(event) => {
            const next = event.relatedTarget
            if (next instanceof HTMLElement && next.tabIndex >= 0 && !event.currentTarget.contains(next)) setManagementOpen(false)
          }} onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); closeManagement() }
        }}>
          <summary onClick={(event) => { event.preventDefault(); setManagementOpen(!managementOpen) }}>관리</summary>
          <div className="library-management-actions" hidden={!managementOpen}>
            <button type="button" className="secondary compact" disabled={editing || selecting || saving || shelfBusy}
              onClick={() => { closeManagement(); setManaging(!managing) }}>{managing ? '책장 관리 닫기' : '책장 관리'}</button>
            <button type="button" className="secondary compact"
              disabled={phase !== 'ready' || !books.length || !customOrder || filtered || selecting || saving || loadingMore || dragging || shelfBusy}
              onClick={() => { closeManagement(); setEditing(true); setNotice(''); setOrderError('') }}>순서 편집</button>
            <button type="button" className="secondary compact" disabled={phase !== 'ready' || !books.length || editing || saving || shelfBusy || needsRefresh}
              onClick={() => { closeManagement(); setSelecting(true); setManaging(false); setSelectedIds([]) }}>책 선택</button>
            {filtered && <p className="result-note">검색·상태·책장 필터를 해제하면 전체 서재 순서를 편집할 수 있어요.</p>}
            {!customOrder && <p className="result-note">직접 정한 순서를 선택하면 서재 순서를 편집할 수 있어요.</p>}
          </div>
        </details>
      </div>
      <div id="library-search-panel" hidden={!searchOpen}>
        <form className="search-form library-search" role="search" onSubmit={submitSearch}>
          <label htmlFor="library-field" className="visually-hidden">검색 기준</label>
          <select id="library-field" value={field} disabled={filterLocked} onChange={(event) => setField(event.target.value as Field)}>
            <option value="title">제목</option><option value="author">저자</option>
          </select>
          <label htmlFor="library-query" className="visually-hidden">서재 검색어</label>
          <input ref={queryInput} id="library-query" type="search" value={query} disabled={filterLocked} placeholder="내 서재에서 찾기"
            autoComplete="off" enterKeyHint="search" aria-invalid={searchError ? true : undefined}
            aria-describedby={searchError ? 'library-search-error' : undefined} onChange={(event) => setQuery(event.target.value)} />
          <button type="submit" disabled={filterLocked}>검색</button>
        </form>
        {searchError && <p id="library-search-error" className="library-note" role="alert">{searchError}</p>}
      </div>
      {filtered && <div className="library-conditions" aria-live="polite">
        {filter.q && <span><span>{filter.field === 'author' ? '저자' : '제목'} ‘{filter.q}’ 검색 결과</span>
          <button type="button" className="link-button" disabled={filterLocked} onClick={clearSearch}>검색 해제</button></span>}
        {filter.status && <span>{statusLabels[filter.status]}
          <button type="button" className="link-button" disabled={filterLocked} onClick={() => apply(makeFilter({ ...filter, status: undefined }))}>상태 해제</button></span>}
        {filter.shelf_id && <span>{shelves?.find((item) => item.id === filter.shelf_id)?.name ?? '선택한 책장'}
          <button type="button" className="link-button" disabled={filterLocked} onClick={() => apply(makeFilter({ ...filter, shelf_id: undefined }))}>책장 해제</button></span>}
      </div>}
      {sortError && <p id="library-sort-error" className="library-note" role="alert">{sortError}</p>}
      {shelvesError && <div className="library-note" role="alert"><p>{shelvesError}</p>
        <button type="button" className="secondary compact" onClick={() => void loadShelves()}>책장 다시 불러오기</button></div>}
      {managing && shelves && <ShelfManager shelves={shelves} refresh={refreshShelves} onBusyChange={setShelfBusy}
        onClose={() => {
          setManaging(false)
          requestAnimationFrame(() => management.current?.querySelector('summary')?.focus())
        }} />}
      {editing && <div className="library-order">
        <button ref={editButton} type="button" className="secondary compact" disabled={saving || loadingMore || dragging || needsRefresh}
          onClick={() => {
            setEditing(false); setNotice(''); setOrderError('')
            requestAnimationFrame(() => management.current?.querySelector('summary')?.focus())
          }}>편집 마치기</button>
        <details className="inline-help"><summary>순서 옮기는 방법</summary>
          <p id="order-help">손잡이를 끌거나 눌러 이동 메뉴를 열 수 있습니다. 손잡이에 초점을 두고 방향키로도 옮길 수 있으며 이동할 때마다 저장됩니다.</p>
        </details>
      </div>}
      {selecting && <div className="library-selection">
        <button type="button" className="secondary compact" disabled={saving || shelfBusy || needsRefresh}
          onClick={() => { setSelecting(false); setSelectedIds([]) }}>선택 마치기</button>
        <LibraryShelfActions books={books.filter((book) => selectedIds.includes(book.id))} shelves={shelves}
          currentShelfId={filter.shelf_id} blocked={loadingMore || saving || needsRefresh} onChanged={refreshShelfBooks} onBusyChange={setShelfBusy} />
      </div>}
      <p className="library-order-status" role="status">{saving ? (slow ? '서버 응답을 기다리는 중…' : needsRefresh ? '최신 순서를 확인하는 중…' : '순서를 저장하는 중…') : notice}</p>
      <div ref={listStart} />

      {phase === 'loading' && (
        <div className="cabin-loading">
          <CabinIcon className="cabin-icon" />
          <p>
            {slow ? '서버를 깨우는 중입니다. 처음 접속하면 30초 정도 걸릴 수 있습니다.' : '오두막 문을 여는 중…'}
          </p>
        </div>
      )}

      {phase === 'error' && (
        <div className="library-note" role="alert">
          <p>{error}</p>
          <button type="button" className="secondary" onClick={retry}>
            다시 시도
          </button>
        </div>
      )}

      {phase === 'ready' && books.length === 0 && filtered && (
        <div className="shelf-empty" role="status">
          <p>조건에 맞는 책이 없습니다.</p>
        </div>
      )}

      {phase === 'ready' && books.length === 0 && !filtered && (
        <div className="shelf-empty">
          <p>
            아직 서재에 담은 책이 없습니다. <Link to="/search">책 찾으러 가기</Link>
          </p>
        </div>
      )}

      <ul ref={shelf} className={`shelf${editing ? ' shelf-editing' : ''}`} aria-busy={saving}>
          {books.map((book, index) => (
            <li key={book.id} data-book-index={index} className={dragTarget === index ? 'order-target' : undefined}>
              {selecting && <label className="book-selection">
                <input type="checkbox" aria-label={`${book.title} 선택`} checked={selectedIds.includes(book.id)} disabled={shelfBusy}
                  onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, book.id] : current.filter((id) => id !== book.id))} />
                선택
              </label>}
              {/* 상세 경로에는 공통 책 id가 아닌 서재 id(user_book_id)를 쓴다 */}
              <Link to={`/books/${book.id}`} className="book" draggable={false} tabIndex={selecting ? -1 : undefined}
                onClick={(event) => {
                  if (!selecting) return
                  event.preventDefault()
                  if (!shelfBusy) setSelectedIds((current) => current.includes(book.id) ? current.filter((id) => id !== book.id) : [...current, book.id])
                }}>
              {book.thumbnail_url ? (
                <img
                  className="cover"
                  src={book.thumbnail_url}
                  alt=""
                  width={120}
                  height={174}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  draggable={false}
                />
              ) : (
                <div className="cover cover-empty" aria-hidden="true">
                  {book.title.slice(0, 1)}
                </div>
              )}
              <p className="book-title" title={book.title}>{book.title.replace(TRAILING_NOTE, '').trim() || book.title}</p>
              {book.authors.length > 0 && (
                <p className="book-authors">{book.authors.join(', ')}</p>
              )}
              <p className={`book-status status-${book.status}`}>
                {statusLabels[book.status]}
              </p>
              </Link>
              {editing && (
                <div className="book-order" role="group" aria-label={`${book.title} 순서`}>
                  <OrderHandle label={book.title} previous={!dragging && index > 0} next={!dragging && index < books.length - 1}
                    onMove={(direction) => void move(index, index + direction)} aria-describedby="order-help" disabled={locked}
                    data-user-book-id={book.id}
                    onPointerDown={(event) => {
                      if (locked || busy.current || !event.isPrimary || event.button !== 0) return
                      event.currentTarget.setPointerCapture(event.pointerId)
                      dragRef.current = { from: index, to: index, pointerId: event.pointerId, x: event.clientX, y: event.clientY, started: false }
                    }}
                    onPointerMove={updateDrag}
                    onPointerUp={(event) => {
                      if (dragRef.current?.pointerId !== event.pointerId) return
                      updateDrag(event)
                      const current = dragRef.current!
                      cancelDrag()
                      if (current.started) void move(current.from, current.to)
                    }}
                    onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag} />
                </div>
              )}
            </li>
          ))}
      </ul>

      {phase === 'ready' && (error || orderError) && (
        <p className="library-note" role="alert">{error ?? orderError}</p>
      )}

      {needsRefresh && !saving && (
        <button ref={refreshButton} type="button" className="secondary" onClick={() => void retryOrder()}>최신 순서 다시 확인</button>
      )}

      <div ref={listEnd} className="library-end" aria-hidden="true" />
      {phase === 'ready' && hasMore && (error || typeof IntersectionObserver === 'undefined') && (
        <button
          type="button"
          className="secondary more"
          onClick={() => loadMore()}
          disabled={locked || dragging || shelfBusy}
        >
          {loadingMore ? (slow ? '서버 응답을 기다리는 중…' : '불러오는 중…') : error ? '다시 불러오기' : '더 보기'}
        </button>
      )}
      {loadingMore && typeof IntersectionObserver !== 'undefined' && <p className="result-note">{slow ? '서버 응답을 기다리는 중…' : '책을 더 불러오는 중…'}</p>}
    </section>
  )
}
