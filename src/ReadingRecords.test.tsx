// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError } from './lib/api'
import type { GoalProgress, ReadingLogEntry, ReadingNoteEntry } from './lib/api'
import ReadingRecords from './ReadingRecords'

const mocks = vi.hoisted(() => ({ getReadingLogs: vi.fn(), getReadingCompletions: vi.fn(), getReadingStatistics: vi.fn(), getAllLibraryBooks: vi.fn(), checkReadingDate: vi.fn(), saveGoals: vi.fn(), getNoteTimeline: vi.fn() }))

vi.mock('./lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/api')>(),
  getReadingLogs: mocks.getReadingLogs,
  getReadingCompletions: mocks.getReadingCompletions,
  getReadingStatistics: mocks.getReadingStatistics,
  getAllLibraryBooks: mocks.getAllLibraryBooks,
  checkReadingDate: mocks.checkReadingDate,
  saveGoals: mocks.saveGoals,
  getNoteTimeline: mocks.getNoteTimeline,
}))
// 환경변수 없는 CI에서도 실제 Supabase 클라이언트를 만들지 않는다.
vi.mock('./lib/supabase', () => ({ supabase: { auth: {} } }))
vi.mock('./lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/auth')>(),
  withAccessToken: (request: (token: string) => Promise<unknown>) => request('test-token'),
}))

function log(id: string, readDate: string, userBookId: string, title: string): ReadingLogEntry {
  return {
    id, user_book_id: userBookId, read_date: readDate, created_at: `${readDate}T00:00:00Z`,
    book_id: `book-${userBookId}`, title, authors: [], thumbnail_url: null,
  }
}

const renderRecords = () => render(<MemoryRouter><ReadingRecords /></MemoryRouter>)

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getReadingCompletions.mockResolvedValue([])
  mocks.getAllLibraryBooks.mockResolvedValue([])
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-28T03:00:00Z'))
})

test('선택한 최근 날짜를 체크하면 달력과 월 요약을 다시 조회한다', async () => {
  let saved = false
  mocks.getReadingLogs.mockImplementation(() => Promise.resolve(saved ? [log('1', '2026-10-27', 'own-a', '어제의 책')] : []))
  mocks.getAllLibraryBooks.mockResolvedValue([{ id: 'own-a', book_id: 'common', title: '어제의 책', status: 'reading', authors: [], thumbnail_url: null }])
  mocks.checkReadingDate.mockImplementation(() => { saved = true; return Promise.resolve() })
  renderRecords()
  await screen.findByText('이 달에는 체크하거나 완독한 기록이 없습니다.')
  fireEvent.click(screen.getByRole('button', { name: '2026년 10월 27일' }))
  fireEvent.click(screen.getByRole('button', { name: '체크·취소하기' }))
  fireEvent.click(await screen.findByRole('button', { name: '어제의 책 체크' }))
  await screen.findByText('1일 동안 1권을 읽었어요.')
  expect(mocks.checkReadingDate).toHaveBeenCalledWith('test-token', 'own-a', '2026-10-27')
  await screen.findByRole('button', { name: '어제의 책 체크 취소' })
})

test('독서 알림으로 들어오면 알림 날짜의 체크 편집기를 읽는 중 필터로 바로 연다', async () => {
  mocks.getReadingLogs.mockResolvedValue([log('1', '2026-10-27', 'own-b', '이미 읽은 책')])
  mocks.getAllLibraryBooks.mockResolvedValue([{ id: 'own-a', title: '오늘의 책', status: 'reading', authors: [], thumbnail_url: null }])
  render(<MemoryRouter initialEntries={['/records?check=2026-10-27']}><ReadingRecords /></MemoryRouter>)
  expect(await screen.findByRole('button', { name: '오늘의 책 체크' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '이미 읽은 책 체크 취소' })).toBeTruthy()
  // 체크한 책은 편집기 카드에만 나오고 아래 목록에 다시 나오지 않는다.
  await waitFor(() => expect(screen.getAllByRole('link', { name: /이미 읽은 책/ })).toHaveLength(1))
  expect(screen.getByRole('button', { name: '2026년 10월 27일, 1권: 이미 읽은 책', pressed: true })).toBeTruthy()
  expect(mocks.getAllLibraryBooks).toHaveBeenCalledWith('test-token', { status: 'reading' })
  await waitFor(() => expect(document.activeElement?.textContent).toBe('2026년 10월 27일'))
})

test('편집기가 불러오는 중이거나 편집할 수 없는 날로 옮기면 그날 읽은 책을 목록에서 숨기지 않는다', async () => {
  mocks.getReadingLogs.mockImplementation((_token: string, start: string, end: string) =>
    start === end ? new Promise(() => {}) : Promise.resolve([log('1', '2026-10-27', 'own-b', '읽은 책'), log('2', '2026-10-15', 'own-c', '지난 책')]))
  render(<MemoryRouter initialEntries={['/records?check=2026-10-27']}><ReadingRecords /></MemoryRouter>)
  // 편집기의 날짜별 조회가 끝나지 않아도 월 기록의 읽은 책은 보인다.
  expect(await screen.findByRole('link', { name: /읽은 책/ })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '2026년 10월 15일, 1권: 지난 책' }))
  expect(screen.getByRole('link', { name: /지난 책/ })).toBeTruthy()
  // 닫기 버튼이 없는 날에 편집기 안내만 남지 않도록 편집을 닫는다.
  expect(screen.queryByText('오늘을 포함한 최근 7일만 체크하거나 취소할 수 있어요.')).toBeNull()
})

test.each(['2026-10-21', '2026-10-29', 'today', '2026-10-99'])('알림 날짜 %s가 최근 7일 밖이거나 형식이 틀리면 편집기를 열지 않는다', async (date) => {
  mocks.getReadingLogs.mockResolvedValue([])
  render(<MemoryRouter initialEntries={[`/records?check=${date}`]}><ReadingRecords /></MemoryRouter>)
  await screen.findByText('이 달에는 체크하거나 완독한 기록이 없습니다.')
  expect(screen.queryByLabelText('선택한 날짜 체크 편집')).toBeNull()
})

test('KST 날짜가 바뀌면 7일 범위 밖이 된 편집을 막는다', async () => {
  mocks.getReadingLogs.mockResolvedValue([])
  mocks.getAllLibraryBooks.mockResolvedValue([{ id: 'own-a', title: '어제의 책', status: 'reading', authors: [], thumbnail_url: null }])
  renderRecords()
  await screen.findByText('이 달에는 체크하거나 완독한 기록이 없습니다.')
  fireEvent.click(screen.getByRole('button', { name: '2026년 10월 22일' }))
  fireEvent.click(screen.getByRole('button', { name: '체크·취소하기' }))
  await screen.findByRole('button', { name: '어제의 책 체크' })
  await act(async () => {
    vi.setSystemTime(new Date('2026-10-28T15:00:01Z'))
    fireEvent.focus(window)
  })
  expect(screen.queryByRole('button', { name: '어제의 책 체크' })).toBeNull()
  expect(screen.queryByRole('button', { name: '편집 닫기' })).toBeNull()
  expect(screen.getByText('오늘을 포함한 최근 7일만 체크하거나 취소할 수 있어요.')).toBeTruthy()
})

test('KST 자정을 넘겨 끝난 저장도 잠금을 유지하고 결과를 재조회한다', async () => {
  let finish!: () => void
  let saved = false
  mocks.getReadingLogs.mockImplementation(() => Promise.resolve(saved ? [log('1', '2026-10-27', 'own-a', '어제의 책')] : []))
  mocks.getAllLibraryBooks.mockResolvedValue([{ id: 'own-a', title: '어제의 책', status: 'reading', authors: [], thumbnail_url: null }])
  mocks.checkReadingDate.mockReturnValue(new Promise<void>((resolve) => { finish = () => { saved = true; resolve() } }))
  renderRecords()
  await screen.findByText('이 달에는 체크하거나 완독한 기록이 없습니다.')
  fireEvent.click(screen.getByRole('button', { name: '2026년 10월 27일' }))
  fireEvent.click(screen.getByRole('button', { name: '체크·취소하기' }))
  fireEvent.click(await screen.findByRole('button', { name: '어제의 책 체크' }))
  await act(async () => {
    vi.setSystemTime(new Date('2026-10-28T15:00:01Z'))
    fireEvent.focus(window)
  })
  expect(screen.getByRole('button', { name: '이전 달' })).toHaveProperty('disabled', true)
  await act(async () => finish())
  await screen.findByText('1일 동안 1권을 읽었어요.')
  expect(await screen.findByRole('button', { name: '어제의 책 체크 취소' })).toHaveProperty('disabled', false)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

test('이번 달 한국 날짜 범위를 조회하고 체크한 날만 표시한다', async () => {
  mocks.getReadingLogs.mockResolvedValue([
    log('1', '2026-10-03', 'ub-a', '소년이 온다'),
    log('2', '2026-10-03', 'ub-b', '데미안'),
    log('3', '2026-10-05', 'ub-a', '소년이 온다'),
  ])
  renderRecords()

  await screen.findByText('2일 동안 2권을 읽었어요.')
  expect(mocks.getReadingLogs).toHaveBeenCalledWith('test-token', '2026-10-01', '2026-10-31')
  fireEvent.click(screen.getByRole('button', { name: '달력' }))
  expect(screen.getByText('2일 동안 2권을 읽었어요.')).toBeTruthy()
  expect(screen.getByRole('button', { name: '2026년 10월 3일, 2권: 소년이 온다, 데미안' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '2026년 10월 4일' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '2026년 10월 29일' })).toHaveProperty('disabled', true)

  fireEvent.click(screen.getByRole('button', { name: '2026년 10월 3일, 2권: 소년이 온다, 데미안' }))
  expect(screen.getByRole('link', { name: /데미안/ }).getAttribute('href')).toBe('/books/ub-b')
})

test('이전 달로 옮기면 그 달 범위를 조회하고, 늦게 온 이전 응답은 버린다', async () => {
  let resolveOctober!: (logs: ReadingLogEntry[]) => void
  mocks.getReadingLogs
    .mockReturnValueOnce(new Promise((resolve) => { resolveOctober = resolve }))
    .mockResolvedValueOnce([log('9', '2026-09-30', 'ub-a', '9월의 책')])
  renderRecords()

  fireEvent.click(screen.getByRole('button', { name: '이전 달' }))
  await screen.findByText('1일 동안 1권을 읽었어요.')
  expect(mocks.getReadingLogs).toHaveBeenLastCalledWith('test-token', '2026-09-01', '2026-09-30')

  resolveOctober([log('1', '2026-10-03', 'ub-a', '10월의 책')])
  await waitFor(() => expect(screen.getByText('2026년 9월')).toBeTruthy())
  expect(screen.queryByText(/10월의 책/)).toBeNull()
  expect(screen.getByRole('button', { name: '다음 달' })).toHaveProperty('disabled', false)
})

test('조회 실패를 빈 달로 바꾸지 않고 다시 시도할 수 있다', async () => {
  mocks.getReadingLogs.mockRejectedValueOnce(new ApiError(503)).mockResolvedValueOnce([])
  renderRecords()

  expect((await screen.findByRole('alert')).textContent).toContain('잠시 응답할 수 없습니다')
  expect(screen.queryByText('이 달에는 체크하거나 완독한 기록이 없습니다.')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  await screen.findByText('이 달에는 체크하거나 완독한 기록이 없습니다.')
})

const monthlyStatistics = {
  library: {
    total_books: 5,
    status_counts: { want_to_read: 1, reading: 1, completed: 1, paused: 1, abandoned: 1 },
    completed_books: 2,
  },
  period: {
    year: 2026, month: 10, start_date: '2026-10-01', end_date: '2026-10-31', reading_days: 3, reading_minutes: 42, goals: [] as GoalProgress[],
  },
}

test('통계는 탭을 열 때 조회하고 연간 합계와 서재 현황을 구분한다', async () => {
  mocks.getReadingLogs.mockResolvedValue([])
  mocks.getReadingStatistics.mockResolvedValueOnce(monthlyStatistics)
  renderRecords()
  await screen.findByText('이 달에는 체크하거나 완독한 기록이 없습니다.')
  expect(mocks.getReadingStatistics).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: '통계' }))
  await screen.findByText('3')
  expect(goalItem('독서 시간').textContent).toContain('42분')
  expect(mocks.getReadingStatistics).toHaveBeenLastCalledWith('test-token', 2026, 10)
  expect(screen.getByText('서재 현황', { selector: 'summary' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /2026년 10월 3일/ })).toBeNull()

  mocks.getReadingStatistics.mockResolvedValueOnce({
    ...monthlyStatistics,
    period: {
      year: 2026, month: null, start_date: '2026-01-01', end_date: '2026-12-31', reading_days: 17, reading_minutes: 300, goals: [],
    },
  })
  fireEvent.click(screen.getByRole('button', { name: '연간' }))
  await screen.findByText('17')
  expect(mocks.getReadingStatistics).toHaveBeenLastCalledWith('test-token', 2026, undefined)
  expect(screen.getByRole('button', { name: '다음 해' })).toHaveProperty('disabled', true)
})

test('달력에서 선택한 월을 통계에서도 유지하고 과거 연도를 조회한다', async () => {
  mocks.getReadingLogs.mockResolvedValue([])
  mocks.getReadingStatistics.mockResolvedValue(monthlyStatistics)
  renderRecords()
  await screen.findByText('이 달에는 체크하거나 완독한 기록이 없습니다.')
  fireEvent.click(screen.getByRole('button', { name: '이전 달' }))
  await screen.findByRole('heading', { name: '2026년 9월' })
  fireEvent.click(screen.getByRole('button', { name: '통계' }))
  await screen.findByText('3')
  expect(mocks.getReadingStatistics).toHaveBeenLastCalledWith('test-token', 2026, 9)

  fireEvent.click(screen.getByRole('button', { name: '연간' }))
  fireEvent.click(screen.getByRole('button', { name: '이전 해' }))
  await screen.findByRole('heading', { name: '2025년 독서 기록' })
  expect(mocks.getReadingStatistics).toHaveBeenLastCalledWith('test-token', 2025, undefined)

  fireEvent.click(screen.getByRole('button', { name: '달력' }))
  await screen.findByRole('heading', { name: '2025년 9월' })
})

test('과거 12월에서 다음 해로 이동해도 월간 통계와 달력은 현재 월을 넘지 않는다', async () => {
  vi.setSystemTime(new Date('2026-10-30T03:00:00Z'))
  mocks.getReadingLogs.mockResolvedValue([])
  mocks.getReadingStatistics.mockResolvedValue(monthlyStatistics)
  renderRecords()
  await screen.findByText('이 달에는 체크하거나 완독한 기록이 없습니다.')
  for (let index = 0; index < 10; index += 1) {
    fireEvent.click(screen.getByRole('button', { name: '이전 달' }))
  }
  await screen.findByRole('heading', { name: '2025년 12월' })
  fireEvent.click(screen.getByRole('button', { name: '통계' }))
  await screen.findByText('3')
  fireEvent.click(screen.getByRole('button', { name: '연간' }))
  fireEvent.click(screen.getByRole('button', { name: '다음 해' }))
  await screen.findByRole('heading', { name: '2026년 독서 기록' })

  fireEvent.click(screen.getByRole('button', { name: '월간' }))
  await screen.findByRole('heading', { name: '2026년 10월 독서 기록' })
  expect(mocks.getReadingStatistics).toHaveBeenLastCalledWith('test-token', 2026, 10)
  expect(mocks.getReadingStatistics).not.toHaveBeenCalledWith('test-token', 2026, 12)
  expect(screen.getByRole('button', { name: '다음 달' })).toHaveProperty('disabled', true)

  fireEvent.click(screen.getByRole('button', { name: '달력' }))
  await screen.findByRole('heading', { name: '2026년 10월' })
  expect(mocks.getReadingLogs).toHaveBeenLastCalledWith('test-token', '2026-10-01', '2026-10-31')
  expect(screen.getByRole('button', { name: '2026년 10월 30일' })).toHaveProperty('disabled', false)
})

test('월을 바꾸면 늦게 온 이전 통계가 최신 통계를 덮지 않는다', async () => {
  let resolveOctober!: (data: typeof monthlyStatistics) => void
  mocks.getReadingLogs.mockResolvedValue([])
  mocks.getReadingStatistics
    .mockReturnValueOnce(new Promise((resolve) => { resolveOctober = resolve }))
    .mockResolvedValueOnce({
      ...monthlyStatistics,
      period: { ...monthlyStatistics.period, month: 9, reading_days: 4 },
    })
  renderRecords()
  fireEvent.click(screen.getByRole('button', { name: '통계' }))
  fireEvent.click(screen.getByRole('button', { name: '이전 달' }))
  await screen.findByText('4')

  await act(async () => { resolveOctober(monthlyStatistics) })

  expect(screen.getByRole('heading', { name: '2026년 9월 독서 기록' })).toBeTruthy()
  expect(screen.getByText('4')).toBeTruthy()
  expect(screen.queryByText('3')).toBeNull()
})

test('통계 오류는 빈 기록과 구분하고 재시도 후 실제 0일을 표시한다', async () => {
  mocks.getReadingLogs.mockResolvedValue([])
  mocks.getReadingStatistics
    .mockRejectedValueOnce(new ApiError(503))
    .mockResolvedValueOnce({
      ...monthlyStatistics,
      period: { ...monthlyStatistics.period, reading_days: 0 },
    })
  renderRecords()
  fireEvent.click(screen.getByRole('button', { name: '통계' }))

  expect((await screen.findByRole('alert')).textContent).toContain('잠시 응답할 수 없습니다')
  expect(screen.queryByText('이 기간에는 체크한 날이 없습니다.')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  await screen.findByText('이 기간에는 체크한 날이 없습니다.')
  expect(screen.getByText('0')).toBeTruthy()
})

test('체크 없이 완독한 날도 표시하고, 같은 날 체크·완독한 책은 하나로 합친다', async () => {
  mocks.getReadingLogs.mockResolvedValue([log('1', '2026-10-15', 'ub-a', '소년이 온다')])
  mocks.getReadingCompletions.mockResolvedValue([
    { user_book_id: 'ub-a', book_id: 'book-ub-a', title: '소년이 온다', authors: [], thumbnail_url: null, status: 'completed', completed_at: '2026-10-15T05:00:00Z', completed_date: '2026-10-15' },
    { user_book_id: 'ub-b', book_id: 'book-ub-b', title: '데미안', authors: [], thumbnail_url: null, status: 'reading', completed_at: '2026-10-20T05:00:00Z', completed_date: '2026-10-20' },
  ])
  renderRecords()

  await screen.findByText('1일 동안 1권을 읽었어요. 완독 2권.')
  expect(mocks.getReadingCompletions).toHaveBeenCalledWith('test-token', '2026-10-01', '2026-10-31')
  // 같은 책·같은 날은 1권으로 합치고, 재독 중이어도 저장된 완독일을 표시한다.
  expect(screen.getByRole('button', { name: '2026년 10월 15일, 1권: 소년이 온다(완독)' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '2026년 10월 20일, 1권: 데미안(완독)' })).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: /10월 15일/ }))
  expect(screen.getByText('읽은 날 · 완독한 날')).toBeTruthy()
})

const withGoals = (goals: GoalProgress[], period: object = {}) =>
  ({ ...monthlyStatistics, period: { ...monthlyStatistics.period, ...period, goals } })
const goalItem = (label: string) => screen.getByRole('heading', { name: label }).closest('li') as HTMLElement

async function openStatistics() {
  mocks.getReadingLogs.mockResolvedValue([])
  renderRecords()
  fireEvent.click(screen.getByRole('button', { name: '통계' }))
  await screen.findByRole('heading', { name: '독서 실적과 목표' })
}

test('기간 기록과 목표를 한곳에서 보여 주고 서재 현황은 접어 둔다', async () => {
  mocks.getReadingStatistics.mockResolvedValueOnce(withGoals([
    { metric: 'reading_days', target: 12, current: 15, source: 'inherited' },
    { metric: 'completed_books', target: 2, current: 1, source: 'set' },
  ], { reading_days: 15 }))
  await openStatistics()

  expect(screen.getByRole('heading', { name: '2026년 10월 독서 기록' })).toBeTruthy()
  const records = screen.getByRole('region', { name: '독서 실적과 목표' })
  expect(within(records).getAllByRole('listitem')).toHaveLength(3)
  expect(goalItem('읽은 날').textContent).toContain('15 / 12일')
  expect(goalItem('읽은 날').textContent).toContain('125%')
  expect(within(goalItem('읽은 날')).getByRole('progressbar')).toMatchObject({ value: 12, max: 12 })
  expect(goalItem('완독 권수').textContent).toContain('1 / 2권')
  expect(goalItem('완독 권수').textContent).toContain('50%')
  expect(goalItem('독서 시간').textContent).toContain('42분')
  expect(goalItem('독서 시간').textContent).toContain('목표를 설정해보세요')
  expect(within(goalItem('독서 시간')).queryByRole('progressbar')).toBeNull()
  expect(screen.getAllByRole('heading', { name: '읽은 날' })).toHaveLength(1)
  expect(screen.getAllByRole('heading', { name: '독서 시간' })).toHaveLength(1)

  const summary = screen.getByText('서재 현황', { selector: 'summary' })
  expect(summary.closest('details')?.open).toBe(false)
  fireEvent.click(summary)
  expect(summary.closest('details')?.open).toBe(true)
  expect(screen.getByText('선택한 기간과 관계없는 현재 현황입니다.')).toBeTruthy()
})

test('목표가 없거나 0이어도 받은 실제 기록을 남기고 완독 수를 서재에서 가져오지 않는다', async () => {
  mocks.getReadingStatistics.mockResolvedValueOnce(withGoals([
    { metric: 'reading_days', target: 0, current: 0, source: 'set' },
  ], { reading_days: 0, reading_minutes: 42 }))
  await openStatistics()

  expect(goalItem('읽은 날').textContent).toContain('0일')
  expect(goalItem('읽은 날').textContent).toContain('목표 꺼짐')
  expect(goalItem('독서 시간').textContent).toContain('42분')
  expect(goalItem('완독 권수').textContent).toContain('목표를 설정해보세요')
  expect(goalItem('완독 권수').textContent).not.toContain('2권')
  expect(screen.queryByRole('progressbar')).toBeNull()
  expect(screen.queryByText(/NaN|Infinity/)).toBeNull()
})

test('목표는 출처·꺼짐·미설정을 구분하고 초과 달성 수치를 그대로 보여 준다', async () => {
  mocks.getReadingStatistics.mockResolvedValueOnce(withGoals([
    { metric: 'reading_days', target: 12, current: 15, source: 'inherited' },
    { metric: 'completed_books', target: 2, current: 1, source: 'set' },
  ]))
  await openStatistics()

  expect(goalItem('읽은 날').textContent).toContain('15 / 12일')
  expect(goalItem('읽은 날').textContent).toContain('이전 달에서 이어받음')
  expect(goalItem('읽은 날').textContent).toContain('목표 달성')
  expect(within(goalItem('읽은 날')).getByRole('progressbar')).toMatchObject({ value: 12, max: 12 })
  // 기간 완독은 현재 서재의 완독 경험(2권)이 아니라 응답 current다.
  expect(goalItem('완독 권수').textContent).toContain('1 / 2권')
  expect(goalItem('완독 권수').textContent).toContain('직접 설정')
  expect(goalItem('독서 시간').textContent).toContain('목표를 설정해보세요')
  expect(within(goalItem('독서 시간')).queryByRole('progressbar')).toBeNull()

  mocks.getReadingStatistics.mockResolvedValueOnce(withGoals([
    { metric: 'reading_days', target: 0, current: 17, source: 'set' },
    { metric: 'completed_books', target: 119988, current: 4, source: 'sum' },
  ], { month: null, start_date: '2026-01-01', end_date: '2026-12-31' }))
  fireEvent.click(screen.getByRole('button', { name: '연간' }))
  await screen.findByText('월 목표 합계')
  expect(goalItem('읽은 날').textContent).toContain('목표 꺼짐')
  expect(within(goalItem('읽은 날')).queryByRole('progressbar')).toBeNull()
  expect(goalItem('완독 권수').textContent).toContain('4 / 119988권')
})

function openGoalDialog(period = '2026년 10월') {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${period} 독서 목표 (설정|수정)$`) }))
  return screen.getByRole('dialog', { name: `${period} 독서 목표` })
}
const goalInput = (label: string) => screen.getByLabelText(label) as HTMLInputElement

test('한 팝업에서 세 목표를 검사하고, 바뀐 지표만 값·끄기(0)·해제(null)로 한 번에 보낸 뒤 다시 조회한다', async () => {
  let finish!: () => void
  mocks.getReadingStatistics.mockResolvedValueOnce(withGoals([
    { metric: 'reading_days', target: 10, current: 3, source: 'set' },
    { metric: 'completed_books', target: 2, current: 1, source: 'inherited' },
  ]))
  mocks.saveGoals.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve }))
  await openStatistics()

  const dialog = openGoalDialog()
  // 직접 정한 값만 채우고, 이어받은 값은 비워 둔 채 무엇을 따르는지 알려 준다.
  expect(goalInput('읽은 날(일)').value).toBe('10')
  expect(goalInput('완독 권수(권)').value).toBe('')
  expect(dialog.textContent).toContain('비워 두면 이전 달 목표(2권)를 이어받아요.')
  expect(dialog.textContent).toContain('비우면 이 달에 정한 값을 지우고, 이전 달 목표가 있으면 이어받아요.')
  expect(dialog.textContent).toContain('다음 달에도 이어집니다')

  fireEvent.change(goalInput('읽은 날(일)'), { target: { value: '32' } })
  fireEvent.change(goalInput('독서 시간(분)'), { target: { value: '1.5' } })
  fireEvent.click(within(dialog).getByRole('button', { name: '저장' }))
  expect(dialog.textContent).toContain('최대 31까지 정할 수 있어요.')
  expect(dialog.textContent).toContain('0 이상의 정수로 입력해주세요.')
  expect(document.activeElement).toBe(goalInput('읽은 날(일)'))
  expect(goalInput('독서 시간(분)').getAttribute('aria-invalid')).toBe('true')
  expect(mocks.saveGoals).not.toHaveBeenCalled()

  fireEvent.change(goalInput('읽은 날(일)'), { target: { value: ' ' } })
  fireEvent.change(goalInput('완독 권수(권)'), { target: { value: '0' } })
  fireEvent.change(goalInput('독서 시간(분)'), { target: { value: '600' } })
  fireEvent.click(within(dialog).getByRole('button', { name: '저장' }))
  fireEvent.click(within(dialog).getByRole('button', { name: '저장하는 중…' }))
  fireEvent(dialog, new Event('cancel', { cancelable: true }))
  expect(screen.getByRole('dialog')).toBe(dialog)
  expect(mocks.saveGoals).toHaveBeenCalledTimes(1)
  expect(mocks.saveGoals).toHaveBeenCalledWith('test-token', {
    year: 2026, month: 10,
    goals: [{ metric: 'reading_days', target: null }, { metric: 'completed_books', target: 0 }, { metric: 'reading_minutes', target: 600 }],
  })
  for (const name of ['이전 달', '연간', '월간', '달력']) {
    expect(screen.getByRole('button', { name, hidden: true })).toHaveProperty('disabled', true)
  }

  mocks.getReadingStatistics.mockResolvedValueOnce(withGoals([
    { metric: 'reading_days', target: 8, current: 3, source: 'inherited' },
    { metric: 'completed_books', target: 0, current: 1, source: 'set' },
    { metric: 'reading_minutes', target: 600, current: 42, source: 'set' },
  ]))
  await act(async () => { finish() })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  // 저장 뒤 초점은 여는 버튼으로 돌아오고, 이름은 보이는 글자(수정)를 포함한다.
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '2026년 10월 독서 목표 수정' }))
  expect(goalItem('읽은 날').textContent).toContain('3 / 8일')
  expect(goalItem('완독 권수').textContent).toContain('목표 꺼짐')
  expect(goalItem('독서 시간').textContent).toContain('42 / 600분')
  expect(mocks.getReadingStatistics).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('button', { name: '이전 달' })).toHaveProperty('disabled', false)
})

test('바꾼 값이 없으면 요청 없이 닫고, 취소하면 입력을 버린다', async () => {
  mocks.getReadingStatistics.mockResolvedValueOnce(withGoals([{ metric: 'reading_minutes', target: 0, current: 0, source: 'set' }]))
  await openStatistics()

  // 꺼 둔 목표는 0으로 보여 주므로 그대로 저장해도 다시 보내지 않는다.
  openGoalDialog()
  expect(goalInput('독서 시간(분)').value).toBe('0')
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  expect(screen.queryByRole('dialog')).toBeNull()

  openGoalDialog()
  fireEvent.change(goalInput('읽은 날(일)'), { target: { value: '5' } })
  fireEvent.click(screen.getByRole('button', { name: '취소' }))
  // 브라우저가 직접 닫아도(close 이벤트) 다시 열 수 있다.
  openGoalDialog()
  fireEvent(screen.getByRole('dialog'), new Event('close'))
  expect(screen.queryByRole('dialog')).toBeNull()
  openGoalDialog()
  expect(goalInput('읽은 날(일)').value).toBe('')
  expect(mocks.saveGoals).not.toHaveBeenCalled()
})

test('연 목표는 그 해 일수로 검사하고 비우면 월 목표 합계로 돌아간다', async () => {
  mocks.getReadingLogs.mockResolvedValue([])
  mocks.getReadingStatistics.mockResolvedValue(withGoals([]))
  renderRecords()
  fireEvent.click(screen.getByRole('button', { name: '통계' }))
  mocks.getReadingStatistics.mockResolvedValueOnce(withGoals([
    { metric: 'reading_days', target: 150, current: 17, source: 'set' },
    { metric: 'completed_books', target: 24, current: 4, source: 'sum' },
  ], { month: null, start_date: '2026-01-01', end_date: '2026-12-31' }))
  fireEvent.click(screen.getByRole('button', { name: '연간' }))
  await waitFor(() => expect(goalItem('읽은 날').textContent).toContain('17 / 150일'))

  const dialog = openGoalDialog('2026년')
  expect(dialog.textContent).not.toContain('다음 달에도 이어집니다')
  expect(dialog.textContent).toContain('비우면 직접 정한 값을 지우고 월 목표 합계로 돌아가요.')
  expect(dialog.textContent).toContain('비워 두면 월 목표 합계(24권)를 써요.')
  fireEvent.change(goalInput('읽은 날(일)'), { target: { value: '366' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  expect(dialog.textContent).toContain('최대 365까지 정할 수 있어요.')

  mocks.saveGoals.mockResolvedValueOnce(undefined)
  fireEvent.change(goalInput('읽은 날(일)'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(mocks.saveGoals).toHaveBeenCalledWith('test-token', { year: 2026, month: null, goals: [{ metric: 'reading_days', target: null }] })
})

test('목표 저장 422는 입력과 기존 통계를 보존하고 다시 조회하지 않는다', async () => {
  mocks.getReadingStatistics.mockResolvedValueOnce(withGoals([{ metric: 'reading_days', target: 10, current: 3, source: 'set' }]))
  mocks.saveGoals.mockRejectedValueOnce(new ApiError(422, 'invalid', 'validation_error'))
  await openStatistics()
  openGoalDialog()
  fireEvent.change(goalInput('읽은 날(일)'), { target: { value: '20' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))

  expect((await screen.findByRole('alert')).textContent).toContain('범위를 넘은 값')
  expect(goalInput('읽은 날(일)').value).toBe('20')
  expect(goalItem('읽은 날').textContent).toContain('3 / 10일')
  expect(mocks.getReadingStatistics).toHaveBeenCalledTimes(1)
})

test('결과가 불명확하면 다시 보내지 않고, 최신 상태 확인 뒤에는 이미 저장된 값을 또 보내지 않는다', async () => {
  mocks.getReadingStatistics.mockResolvedValueOnce(withGoals([]))
  mocks.saveGoals.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await openStatistics()
  openGoalDialog()
  fireEvent.change(goalInput('완독 권수(권)'), { target: { value: '3' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))

  expect((await screen.findByRole('alert')).textContent).toContain('저장됐는지 확인하지 못했습니다')
  expect(mocks.saveGoals).toHaveBeenCalledTimes(1)
  expect(goalInput('완독 권수(권)').value).toBe('3')

  mocks.getReadingStatistics.mockResolvedValueOnce(withGoals([{ metric: 'completed_books', target: 3, current: 0, source: 'set' }]))
  fireEvent.click(screen.getByRole('button', { name: '최신 상태 확인' }))
  await waitFor(() => expect(goalItem('완독 권수').textContent).toContain('0 / 3권'))
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(mocks.saveGoals).toHaveBeenCalledTimes(1)
})

test('저장 후 재조회가 실패하면 저장 실패와 구분하고 입력을 남긴 채 재조회를 제공한다', async () => {
  mocks.getReadingStatistics
    .mockResolvedValueOnce(withGoals([{ metric: 'reading_days', target: 10, current: 3, source: 'set' }]))
    .mockRejectedValueOnce(new ApiError(503))
  mocks.saveGoals.mockResolvedValueOnce(undefined)
  await openStatistics()
  openGoalDialog()
  fireEvent.change(goalInput('읽은 날(일)'), { target: { value: '20' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))

  expect((await screen.findByRole('alert')).textContent).toBe('설정은 저장됐지만 최신 상태를 확인하지 못했습니다.')
  expect(goalInput('읽은 날(일)').value).toBe('20')
  expect(goalItem('읽은 날').textContent).toContain('3 / 10일')

  mocks.getReadingStatistics.mockResolvedValueOnce(withGoals([{ metric: 'reading_days', target: 20, current: 3, source: 'set' }]))
  fireEvent.click(screen.getByRole('button', { name: '최신 상태 확인' }))
  await waitFor(() => expect(goalItem('읽은 날').textContent).toContain('3 / 20일'))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(mocks.saveGoals).toHaveBeenCalledTimes(1)
})

test('목표 저장 중 화면을 떠나면 늦은 성공 응답으로 다시 조회하지 않는다', async () => {
  let finish!: () => void
  mocks.getReadingStatistics.mockResolvedValueOnce(withGoals([]))
  mocks.saveGoals.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve }))
  await openStatistics()
  openGoalDialog()
  fireEvent.change(goalInput('읽은 날(일)'), { target: { value: '5' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))

  cleanup()
  await act(async () => { finish() })
  expect(mocks.getReadingStatistics).toHaveBeenCalledTimes(1)
})

const timelineNote = (id: string, date: string, userBookId: string, title: string, patch: Partial<ReadingNoteEntry> = {}): ReadingNoteEntry => ({
  id, user_book_id: userBookId, note_date: date, quote: `문구 ${id}`, thought: null, page: null,
  has_photo: false, photo_url: null,
  created_at: `${date}T01:00:00Z`, updated_at: `${date}T01:00:00Z`, title, authors: ['저자'], thumbnail_url: null, ...patch,
})

test('노트 탭은 선택한 달의 노트를 서버 순서대로 날짜별로 묶어 보여 준다', async () => {
  mocks.getReadingLogs.mockResolvedValue([])
  mocks.getNoteTimeline.mockResolvedValueOnce([
    timelineNote('a', '2026-10-27', 'ub-a', '소년이 온다', { thought: '생각 a', page: 41 }),
    timelineNote('b', '2026-10-27', 'ub-b', '데미안'),
    timelineNote('c', '2026-10-03', 'ub-a', '소년이 온다'),
  ])
  renderRecords()
  fireEvent.click(screen.getByRole('button', { name: '노트' }))

  await screen.findByText('문구 a')
  expect(mocks.getNoteTimeline).toHaveBeenCalledWith('test-token', '2026-10-01', '2026-10-31', 20, 0)
  const days = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)
  expect(days).toEqual(['2026년 10월 27일', '2026년 10월 3일'])
  const first = screen.getByRole('heading', { name: '2026년 10월 27일' }).closest('section') as HTMLElement
  expect(within(first).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/books/ub-a', '/books/ub-b'])
  expect(within(first).getByText('생각 a')).toBeTruthy()
  expect(within(first).getByText('41쪽')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '노트 더 보기' })).toBeNull()
})

test('노트 더 보기는 이어서 조회하고, 실패하면 기존 노트와 다음 위치를 유지한다', async () => {
  mocks.getReadingLogs.mockResolvedValue([])
  mocks.getNoteTimeline
    .mockResolvedValueOnce(Array.from({ length: 20 }, (_, index) => timelineNote(`n${index}`, '2026-10-20', 'ub-a', '책')))
    .mockRejectedValueOnce(new ApiError(503))
    .mockResolvedValueOnce([timelineNote('n20', '2026-10-02', 'ub-a', '책')])
  renderRecords()
  fireEvent.click(screen.getByRole('button', { name: '노트' }))
  await screen.findByText('문구 n19')
  fireEvent.click(screen.getByRole('button', { name: '노트 더 보기' }))
  expect((await screen.findByRole('alert')).textContent).toContain('잠시 응답할 수 없습니다')
  expect(screen.getByText('문구 n0')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  await screen.findByText('문구 n20')
  expect(mocks.getNoteTimeline).toHaveBeenLastCalledWith('test-token', '2026-10-01', '2026-10-31', 20, 20)
  expect(screen.getAllByText(/문구 n/)).toHaveLength(21)
})

test('노트 조회 오류는 빈 달과 구분하고, 달을 바꾸면 이전 달의 늦은 응답을 버린다', async () => {
  let resolveOctober!: (notes: ReadingNoteEntry[]) => void
  mocks.getReadingLogs.mockResolvedValue([])
  mocks.getNoteTimeline
    .mockReturnValueOnce(new Promise((resolve) => { resolveOctober = resolve }))
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce([])
  renderRecords()
  fireEvent.click(screen.getByRole('button', { name: '노트' }))
  fireEvent.click(screen.getByRole('button', { name: '이전 달' }))
  expect((await screen.findByRole('alert')).textContent).toContain('서버에 연결하지 못했습니다')
  expect(screen.queryByText('이 달에 남긴 노트가 없습니다.')).toBeNull()
  expect(mocks.getNoteTimeline).toHaveBeenLastCalledWith('test-token', '2026-09-01', '2026-09-30', 20, 0)

  await act(async () => { resolveOctober([timelineNote('late', '2026-10-27', 'ub-a', '책')]) })
  expect(screen.queryByText('문구 late')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  await screen.findByText('이 달에 남긴 노트가 없습니다.')
  expect(screen.getByRole('heading', { name: '2026년 9월' })).toBeTruthy()
})

test('새 달 노트를 받은 뒤 늦게 온 이전 달 노트가 화면을 덮지 않는다', async () => {
  let resolveOctober!: (notes: ReadingNoteEntry[]) => void
  mocks.getReadingLogs.mockResolvedValue([])
  mocks.getNoteTimeline
    .mockReturnValueOnce(new Promise((resolve) => { resolveOctober = resolve }))
    .mockResolvedValueOnce([timelineNote('sep', '2026-09-10', 'ub-a', '책')])
  renderRecords()
  fireEvent.click(screen.getByRole('button', { name: '노트' }))
  fireEvent.click(screen.getByRole('button', { name: '이전 달' }))
  await screen.findByText('문구 sep')

  await act(async () => { resolveOctober([timelineNote('late', '2026-10-27', 'ub-a', '책')]) })
  expect(screen.getByText('문구 sep')).toBeTruthy()
  expect(screen.queryByText('문구 late')).toBeNull()
})
