import { expect, test } from '@playwright/test'
import { cover, json, mockBackend, signInWithMockSession } from './fixtures'

test('서재 정렬은 서버 순서·추가 로딩을 따르고 직접 정한 순서를 보존한다', async ({ page }, testInfo) => {
  const books = Array.from({ length: 25 }, (_, index) => ({
    id: `sort-${index}`, book_id: `catalog-${index}`, isbn13: '9788936433598', title: `정렬 책 ${index}`, authors: ['독서가'],
    thumbnail_url: cover('#48594b'), status: 'reading', created_at: '2026-11-05T00:00:00Z',
  }))
  const custom = [books[5], ...books.filter((book) => book.id !== 'sort-5')]
  const orders = { custom, created: [...books].reverse(), started: [...books.slice(10), ...books.slice(0, 10)] }
  const requests: { sort: string; offset: number }[] = []
  let writes = 0
  await signInWithMockSession(page)
  await mockBackend(page, async (route, url, method) => {
    if (url.pathname.endsWith('/position')) { writes += 1; return json(route, { detail: 'Unexpected move' }, 409).then(() => true) }
    if (url.pathname !== '/library/books' || method !== 'GET') return false
    const sort = (url.searchParams.get('sort') ?? 'custom') as keyof typeof orders
    const offset = Number(url.searchParams.get('offset'))
    requests.push({ sort, offset })
    return json(route, orders[sort].slice(offset, offset + Number(url.searchParams.get('limit')))).then(() => true)
  })
  await page.goto('/')
  const first = page.locator('ul.shelf > li').first()
  const sort = page.getByLabel('서재 정렬')
  await expect(first).toContainText('정렬 책 5')
  await sort.selectOption('created')
  await expect(first).toContainText('정렬 책 24')
  await expect(page.getByRole('button', { name: '순서 편집' })).toBeDisabled()
  await page.locator('ul.shelf > li').last().scrollIntoViewIfNeeded()
  await expect(page.locator('ul.shelf > li')).toHaveCount(25)
  expect(requests).toContainEqual({ sort: 'created', offset: 20 })
  await sort.selectOption('started')
  await expect(first).toContainText('정렬 책 10')
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => scrollTo(0, 0))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`library-sort-${width}.png`) })
  }
  await sort.selectOption('custom')
  await expect(first).toContainText('정렬 책 5')
  await expect(page.getByRole('button', { name: '순서 편집' })).toBeEnabled()
  expect(writes).toBe(0)
  expect(requests).toContainEqual({ sort: 'started', offset: 0 })
})

test('큰 화면은 스크롤 없이 다음 책으로 채우고 모든 책을 표시한 뒤 멈춘다', async ({ page }, testInfo) => {
  const books = Array.from({ length: 41 }, (_, index) => ({
    id: `personal-${index}`, book_id: `catalog-${index}`, isbn13: '9788936433598',
    title: index === 0 ? '숲의 책 (스페셜 에디션)' : `서재 책 ${index}`, authors: ['독서가'],
    thumbnail_url: cover('#48594b'), status: 'reading', created_at: '2026-11-05T00:00:00Z',
  }))
  const offsets: number[] = []
  await mockBackend(page, async (route, url) => {
    if (url.pathname !== '/library/books') return false
    const offset = Number(url.searchParams.get('offset'))
    offsets.push(offset)
    return json(route, books.slice(offset, offset + Number(url.searchParams.get('limit')))).then(() => true)
  })
  await signInWithMockSession(page)
  await page.setViewportSize({ width: 1440, height: 2400 })
  await page.goto('/')
  await expect(page.locator('ul.shelf > li')).toHaveCount(41)
  expect(await page.evaluate(() => scrollY)).toBe(0)
  expect([...new Set(offsets)]).toEqual([0, 20, 40])
  await expect(page.getByText('숲의 책', { exact: true })).toHaveAttribute('title', '숲의 책 (스페셜 에디션)')
  await expect(page.getByRole('button', { name: '더 보기' })).toHaveCount(0)
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => scrollTo(0, 0))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`library-${width}.png`) })
  }
})

test('ISBN 없는 첫 페이지와 마지막 페이지를 건너뛰어도 다음 조회와 누적 결과를 유지한다', async ({ page }) => {
  const pages: number[] = []
  await signInWithMockSession(page)
  await mockBackend(page, async (route, url) => {
    if (url.pathname !== '/books/search') return false
    const number = Number(url.searchParams.get('page'))
    pages.push(number)
    return json(route, {
      documents: [{ title: number === 2 ? '등록할 책' : '판매처 전용 상품', authors: [], publisher: '', thumbnail: null, isbn13: number === 2 ? '9788936433598' : null }],
      meta: { is_end: number === 3 },
    }).then(() => true)
  })
  await page.goto('/search')
  await page.getByRole('searchbox').fill('책')
  await page.getByRole('button', { name: '검색', exact: true }).click()
  await expect(page.getByText('담을 수 있는 책이 이 페이지에 없습니다. 더 보기를 눌러 주세요.')).toBeVisible()
  await page.getByRole('button', { name: '결과 더 보기' }).click()
  await expect(page.getByRole('link', { name: '등록할 책' })).toBeVisible()
  await page.getByRole('button', { name: '결과 더 보기' }).click()
  await expect(page.getByRole('button', { name: '결과 더 보기' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: '등록할 책' })).toBeVisible()
  await expect(page.getByText('판매처 전용 상품')).toHaveCount(0)
  expect(pages).toEqual([1, 2, 3])
})
