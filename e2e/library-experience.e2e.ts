import { expect, test } from '@playwright/test'
import { cover, json, libraryAction, libraryControl, mockBackend, signInWithMockSession, noProgress } from './fixtures'

test('대상 책장의 100권 뒤 멤버도 체크하며 새로 선택한 책만 담는다', async ({ page }) => {
  const books = Array.from({ length: 103 }, (_, i) => ({ id: `member-${i}`, book_id: `catalog-${i}`, isbn13: '9788936433598',
    title: `멤버 책 ${i}`, authors: [], thumbnail_url: cover('#48594b'), status: 'reading', created_at: '2026-11-05T00:00:00Z', ...noProgress }))
  const members = books.slice(2).map((book) => book.id)
  // 화면에 보이는 책이 멤버 조회 두 번째 페이지에 있도록 책장 순서를 따로 둔다.
  members[100] = books[0].id
  const membershipOffsets: number[] = []
  const writes: string[] = []
  await mockBackend(page, async (route, url, method) => {
    if (url.pathname === '/shelves' && method === 'GET') {
      return json(route, [{ id: 'target', name: '대상 책장', position: 0, book_count: members.length },
        { id: 'other', name: '다른 책장', position: 1, book_count: 0 }]).then(() => true)
    }
    if (url.pathname === '/library/books' && method === 'GET') {
      const offset = Number(url.searchParams.get('offset')), limit = Number(url.searchParams.get('limit'))
      const inShelf = url.searchParams.get('shelf_id') === 'target'
      if (inShelf) membershipOffsets.push(offset)
      const list = inShelf ? members.map((id) => books.find((book) => book.id === id)!) : url.searchParams.get('shelf_id') === 'other' ? [] : books
      return json(route, list.slice(offset, offset + limit)).then(() => true)
    }
    if (url.pathname.startsWith('/shelves/target/books/') && method === 'PUT') {
      const id = url.pathname.split('/').at(-1)!
      writes.push(id)
      members.push(id)
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
      return true
    }
    return false
  })
  await signInWithMockSession(page)
  await page.goto('/')
  await (await libraryAction(page, '책 선택')).click()
  await page.getByLabel('담을 책장').selectOption('target')
  const existing = page.getByRole('checkbox', { name: '멤버 책 0 선택', exact: true })
  await expect(existing).toBeChecked()
  await expect(existing).toBeDisabled()
  expect(membershipOffsets).toEqual([0, 100])
  await expect(page.getByRole('button', { name: '책장에 담기' })).toBeDisabled()
  await page.getByRole('checkbox', { name: '멤버 책 1 선택', exact: true }).check()
  await page.getByLabel('담을 책장').selectOption('other')
  await expect(page.getByRole('checkbox', { name: '멤버 책 1 선택', exact: true })).toBeEnabled()
  await expect(page.getByRole('checkbox', { name: '멤버 책 1 선택', exact: true })).toBeChecked()
  await page.getByLabel('담을 책장').selectOption('target')
  await expect(existing).toBeChecked()
  await expect(page.getByRole('checkbox', { name: '멤버 책 1 선택', exact: true })).toBeEnabled()
  await expect(page.getByRole('checkbox', { name: '멤버 책 1 선택', exact: true })).toBeChecked()
  await page.getByRole('button', { name: '책장에 담기' }).click()
  await expect(page.getByText('1권을 책장에 담았습니다.')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: '멤버 책 1 선택', exact: true })).toBeChecked()
  expect(writes).toEqual(['member-1'])
})

test('보이는 마지막 행을 채우고 검색 접기와 창 확대 후에도 스크롤 없이 보충한다', async ({ page }, testInfo) => {
  const books = Array.from({ length: 141 }, (_, i) => ({ id: `fill-${i}`, book_id: `catalog-${i}`, isbn13: '9788936433598',
    title: `화면 채우기 ${i}`, authors: ['독서가'], thumbnail_url: cover('#48594b'), status: 'reading', created_at: '2026-11-05T00:00:00Z', ...noProgress }))
  const requests: { offset: number; limit: number }[] = []
  await mockBackend(page, async (route, url) => {
    if (url.pathname !== '/library/books') return false
    const offset = Number(url.searchParams.get('offset')), limit = Number(url.searchParams.get('limit'))
    requests.push({ offset, limit })
    return json(route, books.slice(offset, offset + limit)).then(() => true)
  })
  await signInWithMockSession(page)
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/')
  await page.locator('ul.shelf > li').first().waitFor()
  const visibleRowsFilled = () => page.evaluate(() => {
    const shelf = document.querySelector('ul.shelf')!
    const columns = getComputedStyle(shelf).gridTemplateColumns.split(' ').length
    const items = [...shelf.children]
    if (!items.length) return false
    const last = items.at(-1)!.getBoundingClientRect()
    return last.top >= innerHeight || items.length % columns === 0
  })
  await expect.poll(visibleRowsFilled).toBe(true)
  expect(requests[0].limit).not.toBe(20)
  await page.getByRole('button', { name: '서재 검색', exact: true }).click()
  await page.getByRole('button', { name: '서재 검색', exact: true }).click()
  await expect.poll(visibleRowsFilled).toBe(true)
  await page.setViewportSize({ width: 1440, height: 2400 })
  await expect.poll(visibleRowsFilled).toBe(true)
  expect(requests.every(({ limit }) => limit > 0 && limit <= 100)).toBe(true)
  expect(await page.evaluate(() => scrollY)).toBe(0)
  await page.screenshot({ path: testInfo.outputPath('library-filled.png') })
  await page.setViewportSize({ width: 1440, height: 10000 })
  await expect(page.locator('ul.shelf > li')).toHaveCount(141)
  expect(requests.every(({ limit }) => limit > 0 && limit <= 100)).toBe(true)
  const endRequests = requests.length
  await page.setViewportSize({ width: 1440, height: 11000 })
  await expect(page.locator('ul.shelf > li')).toHaveCount(141)
  expect(requests).toHaveLength(endRequests)
})

test('서재 정렬은 서버 순서·추가 로딩을 따르고 직접 정한 순서를 보존한다', async ({ page }, testInfo) => {
  const books = Array.from({ length: 25 }, (_, index) => ({
    id: `sort-${index}`, book_id: `catalog-${index}`, isbn13: '9788936433598', title: `정렬 책 ${index}`, authors: ['독서가'],
    thumbnail_url: cover('#48594b'), status: 'reading', created_at: '2026-11-05T00:00:00Z', ...noProgress,
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
  const sort = (await libraryControl(page, '서재 정렬'))
  await expect(first).toContainText('정렬 책 5')
  await sort.selectOption('created')
  await expect(first).toContainText('정렬 책 24')
  await expect((await libraryAction(page, '순서 편집'))).toBeDisabled()
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
  await expect((await libraryAction(page, '순서 편집'))).toBeEnabled()
  expect(writes).toBe(0)
  expect(requests).toContainEqual({ sort: 'started', offset: 0 })
})

test('큰 화면은 스크롤 없이 다음 책으로 채우고 모든 책을 표시한 뒤 멈춘다', async ({ page }, testInfo) => {
  const books = Array.from({ length: 41 }, (_, index) => ({
    id: `personal-${index}`, book_id: `catalog-${index}`, isbn13: '9788936433598',
    title: index === 0 ? '숲의 책 (스페셜 에디션)' : `서재 책 ${index}`, authors: ['독서가'],
    thumbnail_url: cover('#48594b'), status: 'reading', created_at: '2026-11-05T00:00:00Z', ...noProgress,
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
  expect([...new Set(offsets)]).toEqual([0])
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
  await expect(page.getByText('이 페이지에는 표시할 책이 없어요. 더 보기를 눌러 주세요.')).toBeVisible()
  await page.getByRole('button', { name: '결과 더 보기' }).click()
  await expect(page.getByRole('link', { name: '등록할 책' })).toBeVisible()
  await page.getByRole('button', { name: '결과 더 보기' }).click()
  await expect(page.getByRole('button', { name: '결과 더 보기' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: '등록할 책' })).toBeVisible()
  await expect(page.getByText('판매처 전용 상품')).toHaveCount(0)
  expect(pages).toEqual([1, 2, 3])
})
