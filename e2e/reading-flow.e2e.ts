import { expect, test } from '@playwright/test'
import { cover, json, mockBackend, signInWithMockSession } from './fixtures'
type ReadingSessionInput = { client_session_id: string; started_at: string; duration_seconds: number }
type ReadingSession = ReadingSessionInput & { id: string; user_book_id: string; read_date: string; created_at: string }

const book = {
  id: 'user-book-1',
  book_id: 'book-1',
  isbn13: '9788936434120',
  title: '소년이 온다',
  authors: ['한강'],
  thumbnail_url: cover('#e9e3d4'),
  status: 'reading',
  created_at: '2026-10-01T00:00:00Z',
}

const detail = {
  ...book,
  publisher: '창비',
  published_date: '2014-05-19',
  description: null,
  source_url: 'https://example.test',
  started_at: '2026-10-01T03:00:00Z',
  last_read_at: null,
  last_read_date: null,
  completed_at: null,
  stopped_at: null,
  stop_reason: null,
  rating: null,
  memo: null,
  is_review_public: false,
  review_published_at: null,
  review_updated_at: null,
  has_completed: false,
  updated_at: '2026-10-01T00:00:00Z',
  allowed_statuses: ['want_to_read', 'reading', 'completed', 'paused', 'abandoned'],
}

test('타이머 복원·1시간 확인·같은 요청 재시도·자동 체크·삭제·로그아웃이 이어진다', async ({ page }, testInfo) => {
  const start = Date.parse('2026-11-04T14:50:00Z')
  await page.clock.setFixedTime(new Date(start))
  await signInWithMockSession(page)
  const sent: ReadingSessionInput[] = []
  let sessions: ReadingSession[] = []
  let checked = false
  await mockBackend(page, async (route, url, method) => {
    if (url.pathname === `/library/books/${book.id}`) return json(route, {
      ...detail, last_read_at: checked ? new Date(start).toISOString() : null,
      last_read_date: checked ? '2026-11-04' : null,
    }).then(() => true)
    if (url.pathname === '/library/books') return json(route, [book]).then(() => true)
    if (url.pathname === '/reading-logs') return json(route, checked && url.searchParams.get('start_date')! <= '2026-11-04' && url.searchParams.get('end_date')! >= '2026-11-04' ? [{
      id: 'timer-log', user_book_id: book.id, book_id: book.book_id, title: book.title,
      authors: book.authors, thumbnail_url: book.thumbnail_url, read_date: '2026-11-04', created_at: new Date(start).toISOString(),
    }] : []).then(() => true)
    if (url.pathname === `/library/books/${book.id}/reading-sessions`) {
      if (method === 'GET') return json(route, sessions).then(() => true)
      const body = route.request().postDataJSON() as ReadingSessionInput
      sent.push(body)
      checked = true
      const session = { ...body, id: 'timer-session', user_book_id: book.id, read_date: '2026-11-04', created_at: new Date(start).toISOString() }
      sessions = [session]
      if (sent.length === 1) return route.abort('failed').then(() => true)
      return json(route, session, 200).then(() => true)
    }
    if (url.pathname === '/reading-sessions/timer-session' && method === 'DELETE') {
      sessions = []
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }).then(() => true)
    }
    return false
  })
  const jump = async (ms: number) => {
    await page.clock.setFixedTime(new Date(start + ms))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  }
  await page.goto(`/books/${book.id}`)
  await page.getByRole('button', { name: '타이머 시작' }).click()
  await jump(90_000)
  await page.getByRole('button', { name: '일시정지', exact: true }).click()
  await jump(1890_000)
  await page.reload()
  await expect(page.getByRole('timer')).toHaveText('00:01:30')
  await page.getByRole('button', { name: '다시 읽기' }).click()
  await jump(5400_000)
  await expect(page.getByRole('timer')).toHaveText('01:00:00')
  expect(sent).toHaveLength(0)
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`timer-${width}.png`), fullPage: true })
  }
  await page.getByRole('button', { name: '계속 읽기', exact: true }).click()
  await expect(page.getByText(/저장 결과를 확인하지 못했습니다/)).toBeVisible()
  await page.getByRole('button', { name: '계속 읽기', exact: true }).click()
  await expect(page.getByRole('timer')).toHaveText('00:00:00')
  expect(sent).toHaveLength(2)
  expect(sent[1]).toEqual(sent[0])
  expect(sent[0].duration_seconds).toBe(3600)
  await page.getByRole('button', { name: /시간 기록 삭제/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: '시간 기록 삭제' }).click()
  await expect(page.getByText('시간 기록을 삭제했습니다. 독서 체크는 그대로 남습니다.')).toBeVisible()
  expect(checked).toBe(true)
  await page.getByRole('link', { name: '기록', exact: true }).click()
  await expect(page.getByRole('button', { name: /2026년 11월 4일, 1권:/ })).toBeVisible()
  await page.getByRole('button', { name: '로그아웃', exact: true }).click()
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('bookstory-reading-timer:')))).toEqual([])
})

test('지난 날짜 체크 → 새로고침 → 최근 체크 날짜 → 완독 후 취소가 이어진다', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-11-03T03:00:00Z'))
  await signInWithMockSession(page)
  let checked = false
  let completed = false
  const requests: string[] = []
  const readDate = '2026-11-02'
  const log = { id: 'past-log', user_book_id: book.id, read_date: readDate, created_at: '2026-11-03T03:00:00Z', book_id: book.book_id, title: book.title, authors: book.authors, thumbnail_url: book.thumbnail_url }
  await mockBackend(page, async (route, url, method) => {
    const current = { ...book, status: completed ? 'completed' : 'reading' }
    if (url.pathname === '/library/books') return json(route, [current]).then(() => true)
    if (url.pathname === `/library/books/${book.id}`) return json(route, { ...detail, ...current, last_read_at: checked ? log.created_at : null, last_read_date: checked ? readDate : null }).then(() => true)
    if (url.pathname === '/reading-logs') {
      const start = url.searchParams.get('start_date')!
      const end = url.searchParams.get('end_date')!
      return json(route, checked && readDate >= start && readDate <= end ? [log] : []).then(() => true)
    }
    if (url.pathname === `/library/books/${book.id}/reading-logs/${readDate}`) {
      requests.push(method)
      checked = method === 'PUT'
      if (method === 'DELETE') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }).then(() => true)
      return json(route, log).then(() => true)
    }
    return false
  })
  await page.goto('/records')
  await page.getByRole('button', { name: '2026년 11월 2일', exact: true }).click()
  await page.getByRole('button', { name: '체크·취소하기' }).click()
  const check = page.getByRole('button', { name: '소년이 온다 체크', exact: true })
  await check.focus()
  await check.press('Enter')
  await expect(page.getByText('1일 동안 1권을 읽었어요.')).toBeVisible()
  await expect(page.getByRole('button', { name: '소년이 온다 체크 취소' })).toBeEnabled()
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`past-check-${width}.png`), fullPage: true })
  }
  await page.reload()
  await expect(page.getByRole('button', { name: '2026년 11월 2일, 1권: 소년이 온다' })).toBeVisible()
  await page.getByRole('link', { name: /소년이 온다/ }).click()
  await expect(page.locator('.detail-dates div').filter({ has: page.getByText('최근 체크', { exact: true }) })).toContainText('2026년 11월 2일')
  completed = true
  await page.goto('/records')
  await page.getByRole('button', { name: '체크·취소하기' }).click()
  await page.getByRole('button', { name: '소년이 온다 체크 취소' }).click()
  await expect(page.getByText('이 달에는 체크하거나 완독한 기록이 없습니다.')).toBeVisible()
  expect(requests).toEqual(['PUT', 'DELETE'])
})

test('책 검색 → 공통 상세 → 후기 공개·수정·비공개가 연결된다', async ({ page }, testInfo) => {
  const saved = { ...detail, memo: '마음에 남은 문장', rating: 4, is_review_public: false,
    review_published_at: null as string | null, review_updated_at: null as string | null }
  const patches: object[] = []
  await signInWithMockSession(page)
  await mockBackend(page, async (route, url, method) => {
    if (url.pathname === '/books/search') return json(route, {
      documents: [{ ...book, isbn13: book.isbn13, thumbnail: book.thumbnail_url, publisher: '창비' }], meta: { is_end: true },
    }).then(() => true)
    if (url.pathname === `/books/${book.isbn13}`) return json(route, {
      isbn13: book.isbn13, title: book.title, authors: book.authors, thumbnail_url: book.thumbnail_url,
      publisher: '창비', published_date: '2014-05-19', source_url: 'https://example.test/book',
      description: '오래 기억하고 싶은 이야기.\n함께 읽으며 각자의 감상을 남겨보세요.',
      reviews: { total_reviews: saved.is_review_public ? 1 : 0, rating_count: saved.is_review_public ? 1 : 0, average_rating: saved.is_review_public ? saved.rating : null },
    }).then(() => true)
    if (url.pathname === `/books/${book.isbn13}/reviews`) return json(route, saved.is_review_public ? [{
      id: book.id, author_name: '독서가', memo: saved.memo, rating: saved.rating, published_at: saved.review_published_at,
      updated_at: saved.review_updated_at, is_mine: true,
    }] : []).then(() => true)
    if (url.pathname === `/library/books/by-isbn/${book.isbn13}` || url.pathname === `/library/books/${book.id}`) return json(route, saved).then(() => true)
    if (url.pathname === '/reading-logs') return json(route, []).then(() => true)
    if (url.pathname === `/library/books/${book.id}/record` && method === 'PATCH') {
      const patch = route.request().postDataJSON()
      patches.push(patch)
      Object.assign(saved, patch)
      saved.review_published_at = saved.is_review_public ? '2026-11-02T00:00:00Z' : null
      saved.review_updated_at = saved.is_review_public ? '2026-11-02T01:00:00Z' : null
      return json(route, { id: saved.id }).then(() => true)
    }
    return false
  })
  await page.goto('/search')
  await page.getByRole('searchbox').fill('소년이 온다')
  await page.getByRole('button', { name: '검색', exact: true }).click()
  await page.getByRole('link', { name: '소년이 온다', exact: true }).click()
  await expect(page.getByRole('heading', { name: '소년이 온다' })).toBeVisible()
  await expect(page.getByText('아직 공개된 후기가 없습니다.')).toBeVisible()
  await page.getByRole('link', { name: '내 기록 수정', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: '메모와 별점 공개' })).not.toBeChecked()
  await page.getByRole('checkbox', { name: '메모와 별점 공개' }).check()
  await page.getByRole('button', { name: '기록 저장', exact: true }).click()
  await expect(page.getByText('저장된 상태: 공개', { exact: false })).toBeVisible()
  expect(patches).toEqual([{ is_review_public: true }])
  await page.getByRole('link', { name: '책 정보·공개 후기 보기' }).click()
  const reviews = page.getByRole('region', { name: '함께 읽은 이야기' })
  await expect(reviews.getByText('마음에 남은 문장')).toBeVisible()
  await expect(page.getByText('★ 4.0 / 5 · 1명 평가')).toBeVisible()
  for (const [name, width, height] of [['mobile', 390, 844], ['tablet', 768, 1024], ['desktop', 1440, 900]] as const) {
    await page.setViewportSize({ width, height })
    await page.screenshot({ path: testInfo.outputPath(`catalog-${name}.png`), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  await page.getByRole('link', { name: '후기 수정', exact: true }).click()
  await page.getByLabel('메모', { exact: true }).fill('다시 읽으며 달라진 감상')
  await page.getByRole('button', { name: '기록 저장', exact: true }).click()
  await expect(page.getByText('기록을 저장했습니다.')).toBeVisible()
  await page.getByRole('link', { name: '책 정보·공개 후기 보기' }).click()
  await expect(reviews.getByText('다시 읽으며 달라진 감상')).toBeVisible()
  await page.getByRole('link', { name: '후기 수정', exact: true }).click()
  await page.getByRole('checkbox', { name: '메모와 별점 공개' }).uncheck()
  await page.getByRole('button', { name: '기록 저장', exact: true }).click()
  await expect(page.getByText('저장된 상태: 비공개')).toBeVisible()
  await page.getByRole('link', { name: '책 정보·공개 후기 보기' }).click()
  await expect(reviews.getByText('아직 공개된 후기가 없습니다.')).toBeVisible()
  await expect(page.getByText('다시 읽으며 달라진 감상')).toBeVisible()
  expect(patches.at(-1)).toEqual({ is_review_public: false })
})

test('서재 → 상세 → 오늘 체크 → 기록 달력까지 이어진다', async ({ page }) => {
  const logs: object[] = []
  await signInWithMockSession(page)
  await mockBackend(page, async (route, url, method) => {
    if (url.pathname === '/library/books') return json(route, [book]).then(() => true)
    if (url.pathname === '/library/books/user-book-1') return json(route, detail).then(() => true)
    if (url.pathname === '/library/books/user-book-1/reading-logs/today' && method === 'PUT') {
      // 서버가 정한 한국 날짜를 그대로 쓴다.
      const readDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
      const log = { id: 'log-1', user_book_id: book.id, read_date: readDate, created_at: new Date().toISOString() }
      logs.push({ ...log, book_id: book.book_id, title: book.title, authors: book.authors, thumbnail_url: book.thumbnail_url })
      return json(route, log).then(() => true)
    }
    if (url.pathname === '/reading-logs') {
      const start = url.searchParams.get('start_date')!
      const end = url.searchParams.get('end_date')!
      return json(route, logs.filter((log) => {
        const date = (log as { read_date: string }).read_date
        return date >= start && date <= end
      })).then(() => true)
    }
    return false
  })

  await page.goto('/')
  await page.getByRole('link', { name: /소년이 온다/ }).click()
  await expect(page.getByRole('heading', { name: '소년이 온다' })).toBeVisible()

  // 상세 주소에서 새로고침해도 같은 화면이 열린다(SPA 경로).
  await page.reload()
  await expect(page.getByRole('heading', { name: '소년이 온다' })).toBeVisible()

  await page.getByRole('button', { name: '오늘 읽었어요' }).click()
  await expect(page.getByText('오늘 읽은 날로 남겼어요')).toBeVisible()

  await page.getByRole('link', { name: '기록' }).click()
  await expect(page.getByText('1일 동안 1권을 읽었어요.')).toBeVisible()
  await expect(page.getByRole('button', { name: /1권: 소년이 온다/ })).toBeVisible()
})

test('서버 확인이 503이면 로그아웃하지 않고 다시 시도로 들어간다', async ({ page }) => {
  let meCalls = 0
  await signInWithMockSession(page)
  await mockBackend(page, async (route, url) => {
    if (url.pathname === '/me') {
      meCalls += 1
      if (meCalls === 1) return json(route, { detail: 'Service unavailable' }, 503).then(() => true)
      return false
    }
    if (url.pathname === '/library/books') return json(route, []).then(() => true)
    return false
  })

  await page.goto('/')
  await expect(page.getByRole('form', { name: '로그인' })).toHaveCount(0)
  await page.getByRole('button', { name: '다시 시도' }).click()
  await expect(page.getByText(/아직 서재에 담은 책이 없습니다/)).toBeVisible()
})

test('검색해서 서재에 담으면 서재에서 보인다', async ({ page }) => {
  const shelf: object[] = []
  await signInWithMockSession(page)
  await mockBackend(page, async (route, url, method) => {
    if (url.pathname === '/books/search') {
      return json(route, {
        documents: [
          { title: '소년이 온다', authors: ['한강'], publisher: '창비', thumbnail: '', isbn: '8936434128 9788936434120', isbn13: '9788936434120' },
          { title: 'ISBN10만 있는 책', authors: [], publisher: null, thumbnail: null, isbn: '8936434128', isbn13: null },
        ],
        meta: { is_end: true },
      }).then(() => true)
    }
    if (url.pathname === '/library/books' && method === 'POST') {
      shelf.push(book)
      return json(route, { id: book.id, book_id: book.book_id, status: 'want_to_read' }, 201).then(() => true)
    }
    if (url.pathname === '/library/books') return json(route, shelf).then(() => true)
    return false
  })

  await page.goto('/search')
  await page.getByRole('searchbox').fill('한강')
  await page.getByRole('button', { name: '검색' }).click()
  await expect(page.getByText('13자리 ISBN이 없어 서재에 담을 수 없습니다.')).toBeVisible()

  await page.getByRole('button', { name: '서재에 담기' }).click()
  await expect(page.getByText('서재에 담았습니다.')).toBeVisible()
  await page.getByRole('link', { name: '서재로 가기' }).click()
  await expect(page.getByRole('link', { name: /소년이 온다/ })).toBeVisible()
})

test('기록에서 월간·연간 통계를 보고 다시 달력으로 돌아온다', async ({ page }, testInfo) => {
  const requests: URLSearchParams[] = []
  const goalWrites: unknown[] = []
  let monthGoal: number | null = null
  await signInWithMockSession(page)
  await mockBackend(page, async (route, url, method) => {
    if (url.pathname === '/reading-logs') return json(route, []).then(() => true)
    if (url.pathname === '/me/goals' && method === 'PUT') {
      const body = route.request().postDataJSON()
      goalWrites.push(body)
      monthGoal = body.target
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }).then(() => true)
    }
    if (url.pathname === '/me/statistics') {
      requests.push(url.searchParams)
      const year = Number(url.searchParams.get('year'))
      const month = url.searchParams.has('month') ? Number(url.searchParams.get('month')) : null
      const prefix = `${year}-${String(month ?? 1).padStart(2, '0')}`
      const end = month === null
        ? `${year}-12-31`
        : new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
      return json(route, {
        library: {
          total_books: 4,
          status_counts: { want_to_read: 1, reading: 2, completed: 1, paused: 0, abandoned: 0 },
          completed_books: 2,
        },
        period: {
          year, month, start_date: `${prefix}-01`, end_date: end,
          reading_days: month === null ? 42 : 7,
          reading_minutes: month === null ? 300 : 42,
          goals: monthGoal === null ? [] : month === null
            ? [{ metric: 'reading_days', target: monthGoal * 2, current: 42, source: 'sum' }]
            : [{ metric: 'reading_days', target: monthGoal, current: 7, source: 'set' }],
        },
      }).then(() => true)
    }
    return false
  })

  await page.goto('/records')
  await expect(page.getByText('이 달에는 체크하거나 완독한 기록이 없습니다.')).toBeVisible()
  await page.getByRole('button', { name: '통계', exact: true }).click()
  await expect(page.getByText('7', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '현재 서재' })).toBeVisible()
  expect(requests.at(-1)?.has('month')).toBe(true)
  await expect(page.getByText('목표를 설정해보세요')).toHaveCount(3)

  await page.getByRole('button', { name: '읽은 날 목표 설정' }).click()
  await page.getByLabel(/읽은 날 목표\(일\)/).fill('12')
  await page.screenshot({ path: testInfo.outputPath('goal-editor-mobile.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await expect(page.getByText('7 / 12일')).toBeVisible()
  expect(goalWrites).toEqual([{ metric: 'reading_days', year: Number(requests.at(-1)?.get('year')), month: Number(requests.at(-1)?.get('month')), target: 12 }])

  await page.getByRole('button', { name: '연간', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('42', { exact: true })).toBeVisible()
  expect(requests.at(-1)?.has('month')).toBe(false)
  await expect(page.getByText('42 / 24일')).toBeVisible()
  await expect(page.getByText('월 목표 합계')).toBeVisible()
  await expect(page.getByRole('button', { name: '연간', exact: true })).toHaveAttribute('aria-pressed', 'true')

  await page.screenshot({ path: testInfo.outputPath('statistics-mobile.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.screenshot({ path: testInfo.outputPath('statistics-tablet.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: testInfo.outputPath('statistics-desktop.png'), fullPage: true })

  await page.getByRole('button', { name: '달력', exact: true }).click()
  await expect(page.getByText('이 달에는 체크하거나 완독한 기록이 없습니다.')).toBeVisible()
})

test('상세에서 비공개 노트를 쓰고 고친 뒤 기록의 노트 탭에서 날짜별로 본다', async ({ page }, testInfo) => {
  const notes: Record<string, unknown>[] = []
  const writes: string[] = []
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
  await signInWithMockSession(page)
  await mockBackend(page, async (route, url, method) => {
    const request = route.request()
    if (url.pathname === '/library/books') return json(route, [book]).then(() => true)
    if (url.pathname === '/library/books/user-book-1') return json(route, detail).then(() => true)
    if (url.pathname === '/library/books/user-book-1/notes') {
      if (method === 'POST') {
        writes.push(`POST ${request.postData()}`)
        const note = { id: `note-${notes.length + 1}`, user_book_id: book.id, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...request.postDataJSON() }
        notes.unshift(note)
        return json(route, note, 201).then(() => true)
      }
      return json(route, notes).then(() => true)
    }
    if (url.pathname.startsWith('/notes/') && method === 'PATCH') {
      writes.push(`PATCH ${request.postData()}`)
      Object.assign(notes[0], request.postDataJSON())
      return json(route, notes[0]).then(() => true)
    }
    if (url.pathname === '/notes') {
      return json(route, notes.map((note) => ({ ...note, title: book.title, authors: book.authors, thumbnail_url: book.thumbnail_url }))).then(() => true)
    }
    return false
  })

  await page.goto('/books/user-book-1')
  await expect(page.getByText('아직 남긴 노트가 없습니다.')).toBeVisible()
  await page.getByRole('button', { name: '노트 쓰기' }).click()
  await page.getByLabel('인상 깊은 문구').fill('  기억하고 싶은 문장  ')
  await page.getByLabel('페이지(선택)').fill('41')
  await page.screenshot({ path: testInfo.outputPath('note-editor-mobile.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: '노트 저장' }).click()
  await expect(page.getByText('노트를 저장했습니다.')).toBeVisible()
  await expect(page.getByText('기억하고 싶은 문장', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: /노트 수정$/ }).click()
  await page.getByLabel('생각').fill('다시 읽고 싶다')
  await page.getByLabel('페이지(선택)').fill('')
  await page.getByRole('button', { name: '노트 저장' }).click()
  await expect(page.getByText('노트를 수정했습니다.')).toBeVisible()
  expect(writes).toEqual([
    `POST ${JSON.stringify({ note_date: today, quote: '기억하고 싶은 문장', thought: null, page: 41 })}`,
    `PATCH ${JSON.stringify({ thought: '다시 읽고 싶다', page: null })}`,
  ])

  await page.getByRole('link', { name: '기록' }).click()
  await page.getByRole('button', { name: '노트', exact: true }).click()
  await expect(page.getByText('다시 읽고 싶다')).toBeVisible()
  await expect(page.getByRole('link', { name: /소년이 온다/ })).toBeVisible()
  for (const [name, width] of [['mobile', 390], ['tablet', 768], ['desktop', 1440]] as const) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`note-timeline-${name}.png`), fullPage: true })
  }
})
