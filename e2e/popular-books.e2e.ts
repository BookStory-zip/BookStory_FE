import { expect, test } from '@playwright/test'
import { cover, json, mockBackend, signInWithMockSession } from './fixtures'

const items = (count: number, prefix = '인기 도서') => Array.from({ length: count }, (_, index) => ({
  rank: index + 1, daily_rank: index % 2 ? null : index + 2, monthly_rank: index + 1,
  isbn13: `978893643${String(index).padStart(4, '0')}`, title: `${prefix} ${index + 1}`, author: '작가 저/번역가 역', publisher: '출판사',
  thumbnail_url: null as string | null, source_url: `https://www.yes24.com/product/goods/${index + 1}`,
}))

test('인기 도서 10권·출처·기준일·새 수집본 전체 보기와 상세 실패 대체 링크', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  await signInWithMockSession(page)
  const requests: number[] = []
  let catalogRequests = 0
  await mockBackend(page, async (route, url) => {
    if (url.pathname === '/discovery/popular') {
      expect(route.request().headers().authorization).toBeUndefined()
      const limit = Number(url.searchParams.get('limit')); requests.push(limit)
      const books = items(limit === 30 ? 17 : 10, limit === 30 ? '새 인기 도서' : '인기 도서')
      books[0].thumbnail_url = cover('#e7d6ad').replace('data:image/svg+xml,', 'https://covers.e2e.test/')
      return json(route, { source: 'yes24', collected_at: new Date().toISOString(), basis_date: '2026-11-12', monthly_basis: '2026-10', items: books }).then(() => true)
    }
    if (url.pathname.endsWith('/reviews')) return json(route, []).then(() => true)
    if (url.pathname.startsWith('/books/')) { catalogRequests++; return json(route, { detail: 'Book not found' }, 404).then(() => true) }
    if (url.pathname.startsWith('/library/books/by-isbn/')) return json(route, { detail: 'not found' }, 404).then(() => true)
    return false
  })
  await page.route('https://covers.e2e.test/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="174"><rect width="120" height="174" fill="#e7d6ad"/></svg>' }))
  await page.goto('/search')
  const popular = page.getByRole('region', { name: '요즘 인기 있는 책' })
  await expect(popular.getByRole('listitem')).toHaveCount(10)
  await expect(popular.getByText('YES24 일간·월간 베스트셀러 종합')).toBeVisible()
  await expect(popular.getByText(/월간 2026년 10월 기준/)).toBeVisible()
  await expect(popular.getByRole('link', { name: /YES24에서 보기/ })).toHaveCount(10)
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`popular-${width}.png`), fullPage: true })
  }
  await popular.getByRole('button', { name: '전체 보기' }).click()
  await expect(popular.getByRole('listitem')).toHaveCount(17)
  await expect(popular.getByRole('link', { name: '새 인기 도서 17', exact: true })).toBeVisible()
  expect(requests[0]).toBe(10)
  expect(requests.filter((limit) => limit === 30)).toHaveLength(1)
  await page.setViewportSize({ width: 390, height: 900 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('popular-expanded-390.png'), fullPage: true })
  await popular.getByRole('button', { name: '접기' }).click()
  await expect(popular.getByRole('listitem')).toHaveCount(10)
  await popular.getByRole('link', { name: '새 인기 도서 1', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('link', { name: 'YES24에서 보기 ↗', exact: true })).toHaveAttribute('href', 'https://www.yes24.com/product/goods/1')
  expect(new URL(page.url()).pathname).toBe('/catalog/9788936430000')
  expect(catalogRequests).toBeGreaterThanOrEqual(1)
  await page.reload()
  await expect(page.getByRole('link', { name: 'YES24에서 보기 ↗', exact: true })).toBeVisible()
  const beforeRetry = catalogRequests
  await page.getByRole('button', { name: '다시 불러오기' }).click()
  await expect.poll(() => catalogRequests).toBe(beforeRetry + 1)
})

test('빈·오래된 목록은 숨기고 인기 도서 429가 일반 검색을 막지 않는다', async ({ page }) => {
  await signInWithMockSession(page)
  let mode: 'empty' | 'stale' | 'limited' = 'empty'
  await mockBackend(page, async (route, url) => {
    if (url.pathname === '/discovery/popular') {
      if (mode === 'limited') {
        await route.fulfill({ status: 429, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Retry-After', 'Retry-After': '5' }, body: JSON.stringify({ code: 'rate_limited', detail: 'rate limited' }) })
        return true
      }
      return json(route, { source: 'yes24', collected_at: mode === 'empty' ? null : '2026-01-01T00:00:00Z', basis_date: mode === 'empty' ? null : '2025-12-31', monthly_basis: mode === 'empty' ? null : '2025-12', items: mode === 'empty' ? [] : items(1) }).then(() => true)
    }
    if (url.pathname === '/books/search') return json(route, { documents: [{ title: '직접 검색한 책', authors: ['작가'], publisher: '', thumbnail: '', isbn13: '9788936433598' }], meta: { is_end: true } }).then(() => true)
    return false
  })
  await page.goto('/search')
  await expect(page.getByRole('region', { name: '요즘 인기 있는 책' })).toHaveCount(0)
  mode = 'stale'
  await page.reload()
  await expect(page.getByRole('region', { name: '요즘 인기 있는 책' })).toHaveCount(0)
  mode = 'limited'
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('5초 후')
  await expect(page.getByRole('button', { name: '다시 시도' })).toBeDisabled()
  await page.getByRole('searchbox').fill('책')
  await page.getByRole('button', { name: '검색', exact: true }).click()
  await expect(page.getByRole('link', { name: '직접 검색한 책', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '요즘 인기 있는 책' })).toHaveCount(0)
})
