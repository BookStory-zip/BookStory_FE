import { expect, test } from '@playwright/test'
import { cover, json, mockBackend, signInWithMockSession } from './fixtures'

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
  completed_at: null,
  stopped_at: null,
  stop_reason: null,
  rating: null,
  memo: null,
  has_completed: false,
  updated_at: '2026-10-01T00:00:00Z',
  allowed_statuses: ['want_to_read', 'reading', 'completed', 'paused', 'abandoned'],
}

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
  await signInWithMockSession(page)
  await mockBackend(page, async (route, url) => {
    if (url.pathname === '/reading-logs') return json(route, []).then(() => true)
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

  await page.getByRole('button', { name: '연간', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('42', { exact: true })).toBeVisible()
  expect(requests.at(-1)?.has('month')).toBe(false)
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
