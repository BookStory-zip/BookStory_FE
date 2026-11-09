import { chromium, expect, test } from '@playwright/test'
import { cover, json, libraryAction, libraryControl, mockBackend, signInWithMockSession, noProgress } from './fixtures'

test('순서 편집: 키보드·탭 이동, 불러온 범위 유지, 새로고침 후 저장된 순서', async ({ page }) => {
  let books = Array.from({ length: 23 }, (_, i) => ({
    id: `personal-${i}`, book_id: `catalog-${i}`, isbn13: '9788936433598',
    title: `서재 책 ${i}`, authors: ['독서가'], thumbnail_url: cover('#48594b'),
    status: 'want_to_read', created_at: '2026-11-02T00:00:00Z', ...noProgress,
  }))
  const moves: unknown[] = []
  await mockBackend(page, async (route, url, method) => {
    if (url.pathname === '/library/books' && method === 'GET') {
      const offset = Number(url.searchParams.get('offset'))
      await json(route, books.slice(offset, offset + Number(url.searchParams.get('limit'))))
      return true
    }
    if (url.pathname.endsWith('/position') && method === 'PATCH') {
      const body = route.request().postDataJSON()
      moves.push(body)
      const id = url.pathname.split('/')[3]
      const moved = books.find((book) => book.id === id)!
      books = books.filter((book) => book.id !== id)
      const index = body.after_user_book_id === null ? 0 : books.findIndex((book) => book.id === body.after_user_book_id) + 1
      books.splice(index, 0, moved)
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
      return true
    }
    return false
  })
  await signInWithMockSession(page)
  await page.goto('/')
  await page.locator('ul.shelf > li').last().scrollIntoViewIfNeeded()
  await expect(page.getByRole('listitem')).toHaveCount(23)
  await (await libraryAction(page, '순서 편집')).click()
  const forward = page.getByRole('button', { name: '서재 책 1 이동 손잡이', exact: true })
  await forward.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('button', { name: '서재 책 1 이동 손잡이', exact: true })).toBeFocused()
  await expect(page.getByRole('listitem')).toHaveCount(23)
  await expect(page.getByRole('listitem').first()).toContainText('서재 책 1')
  expect(moves).toEqual([{ after_user_book_id: null }])
  await page.getByRole('button', { name: '서재 책 1 이동 손잡이', exact: true }).press('ArrowRight')
  await expect(page.getByRole('listitem').first()).toContainText('서재 책 0')
  expect(moves).toEqual([{ after_user_book_id: null }, { after_user_book_id: 'personal-0' }])
  await expect(page.getByRole('listitem')).toHaveCount(23)
  await expect(page.getByRole('button', { name: '더 보기' })).toHaveCount(0)
  await page.getByRole('button', { name: '편집 마치기' }).click()
  await expect(page.locator('.library-management summary')).toBeFocused()
  await page.reload()
  await expect(page.getByRole('listitem')).toHaveCount(20)
  await expect(page.getByRole('listitem').nth(1)).toContainText('서재 책 1')
  await expect(page.getByRole('link', { name: '서재 책 1 독서가 읽고 싶음', exact: true })).toHaveAttribute('href', '/books/personal-1')
})

test('손잡이 드래그: 이동·동일 위치·Escape·영역 밖 취소와 터치', async ({ page, context }) => {
  let books = Array.from({ length: 3 }, (_, i) => ({
    id: `personal-${i}`, book_id: `catalog-${i}`, isbn13: '9788936433598',
    title: `드래그 책 ${i}`, authors: [], thumbnail_url: cover('#8d714e'),
    status: 'reading', created_at: '2026-11-02T00:00:00Z', ...noProgress,
  }))
  const anchors: (string | null)[] = []
  await mockBackend(page, async (route, url, method) => {
    if (url.pathname === '/library/books') {
      const offset = Number(url.searchParams.get('offset'))
      await json(route, books.slice(offset, offset + Number(url.searchParams.get('limit')))); return true
    }
    if (url.pathname.endsWith('/position') && method === 'PATCH') {
      const anchor = route.request().postDataJSON().after_user_book_id
      anchors.push(anchor)
      const id = url.pathname.split('/')[3]
      const moved = books.find((book) => book.id === id)!
      books = books.filter((book) => book.id !== id)
      books.splice(anchor === null ? 0 : books.findIndex((book) => book.id === anchor) + 1, 0, moved)
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
      return true
    }
    return false
  })
  await signInWithMockSession(page)
  await page.goto('/')
  await (await libraryAction(page, '순서 편집')).click()
  const handle = (i: number) => page.getByRole('button', { name: `드래그 책 ${i} 이동 손잡이` })
  const position = async (i: number) => {
    await handle(i).evaluate((element) => element.scrollIntoView({ block: 'center' }))
    const box = (await handle(i).boundingBox())!
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  let from = await position(1)
  let to = await position(0)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
  await expect(page.getByRole('listitem').first()).toContainText('드래그 책 1')
  await expect(handle(1)).toBeEnabled()
  await expect(page.locator('.order-menu')).toHaveCount(0)
  expect(anchors).toEqual([null])
  from = await position(1)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  to = await position(0)
  await page.mouse.move(to.x, to.y)
  // Safari처럼 손잡이에 포커스가 없어도 Escape로 취소된다.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(1, 1)
  await page.mouse.up()
  expect(anchors).toEqual([null])
  from = await position(0)
  to = await position(1)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 0 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...to, id: 0 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(page.getByRole('listitem').first()).toContainText('드래그 책 0')
  expect(anchors).toEqual([null, null])
  await expect(page.locator('.order-menu')).toHaveCount(0)
  await handle(0).tap()
  await expect(page.getByRole('button', { name: '드래그 책 0 앞으로' })).toBeDisabled()
  await page.getByRole('button', { name: '드래그 책 0 뒤로' }).click()
  await expect(page.getByRole('listitem').first()).toContainText('드래그 책 1')
  await expect(handle(0)).toBeFocused()
  expect(anchors).toEqual([null, null, 'personal-1'])
})

test('손잡이 드래그: 화면 가장자리에서 자동 스크롤해 보이지 않던 위치로 옮긴다', async ({ page }) => {
  let books = Array.from({ length: 20 }, (_, i) => ({
    id: `personal-${i}`, book_id: `catalog-${i}`, isbn13: '9788936433598',
    title: `스크롤 책 ${i}`, authors: [], thumbnail_url: cover('#48594b'),
    status: 'reading', created_at: '2026-11-02T00:00:00Z', ...noProgress,
  }))
  const anchors: (string | null)[] = []
  await mockBackend(page, async (route, url, method) => {
    if (url.pathname === '/library/books') {
      const offset = Number(url.searchParams.get('offset'))
      await json(route, books.slice(offset, offset + Number(url.searchParams.get('limit')))); return true
    }
    if (url.pathname.endsWith('/position') && method === 'PATCH') {
      const anchor = route.request().postDataJSON().after_user_book_id
      anchors.push(anchor)
      const id = url.pathname.split('/')[3]
      const moved = books.find((book) => book.id === id)!
      books = books.filter((book) => book.id !== id)
      books.splice(anchor === null ? 0 : books.findIndex((book) => book.id === anchor) + 1, 0, moved)
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
      return true
    }
    return false
  })
  await signInWithMockSession(page)
  await page.goto('/')
  await (await libraryAction(page, '순서 편집')).click()
  const stationary = page.getByRole('button', { name: '스크롤 책 7 이동 손잡이' })
  await stationary.evaluate((element) => element.scrollIntoView({ block: 'end' }))
  const stationaryBox = (await stationary.boundingBox())!
  const beforeScroll = await page.evaluate(() => scrollY)
  await page.mouse.move(stationaryBox.x + stationaryBox.width / 2, stationaryBox.y + stationaryBox.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(250)
  const heldScroll = await page.evaluate(() => scrollY)
  await page.mouse.up()
  expect(heldScroll).toBe(beforeScroll)
  expect(anchors).toHaveLength(0)
  await expect(page.locator('.order-menu')).toHaveCount(1)
  await page.keyboard.press('Escape')
  const last = page.getByRole('button', { name: '스크롤 책 19 이동 손잡이' })
  await last.scrollIntoViewIfNeeded()
  const first = page.getByRole('button', { name: '스크롤 책 0 이동 손잡이' })
  await expect(first).not.toBeInViewport()
  const from = (await last.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2, 5, { steps: 8 })
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  // 첫 카드 손잡이는 화면 아래 자동 스크롤 영역에 걸려 놓기 전에 목록이 움직이므로 카드 윗부분에 놓는다.
  // 맨 위에서는 위쪽 자동 스크롤이 움직이지 않는다.
  const to = (await page.getByRole('listitem').first().boundingBox())!
  await page.mouse.move(to.x + to.width / 2, to.y + 10, { steps: 4 })
  await page.mouse.up()
  await expect(page.getByRole('listitem').first()).toContainText('스크롤 책 19')
  expect(anchors).toEqual([null])
})

test('서재 검색·상태 필터: 서버 조건 조합, 자동 로딩, 해제 후 순서 편집 재활성화', async ({ page }, testInfo) => {
  const books = Array.from({ length: 30 }, (_, i) => ({
    id: `personal-${i}`, book_id: `catalog-${i}`, isbn13: '9788936433598',
    title: i % 2 ? `숲의 노래 ${i}` : `바다 이야기 ${i}`, authors: [i < 25 ? '한강' : '김작가'], thumbnail_url: cover('#48594b'),
    status: i % 3 ? 'reading' : 'completed', created_at: '2026-11-02T00:00:00Z', ...noProgress,
  }))
  const requests: string[] = []
  await mockBackend(page, async (route, url, method) => {
    if (url.pathname !== '/library/books' || method !== 'GET') return false
    const params = url.searchParams
    requests.push([...params].filter(([key]) => key !== 'limit').map(([key, value]) => `${key}=${value}`).join('&'))
    const q = params.get('q')?.toLowerCase()
    const matched = books.filter((book) =>
      (!q || (params.get('field') === 'author' ? book.authors.some((name) => name.toLowerCase().includes(q)) : book.title.toLowerCase().includes(q))) &&
      (!params.get('status') || book.status === params.get('status')))
    const offset = Number(params.get('offset'))
    await json(route, matched.slice(offset, offset + Number(params.get('limit'))))
    return true
  })
  await signInWithMockSession(page)
  await page.goto('/')
  await expect(page.getByRole('listitem')).toHaveCount(20)

  await (await libraryControl(page, '검색 기준')).selectOption('author')
  await (await libraryControl(page, '서재 검색어')).fill('한강')
  await (await libraryControl(page, '서재 검색어')).press('Enter')
  await expect(page.getByText('저자 ‘한강’ 검색 결과')).toBeVisible()
  await expect((await libraryAction(page, '순서 편집'))).toBeDisabled()
  await page.locator('ul.shelf > li').last().scrollIntoViewIfNeeded()
  await expect(page.getByRole('listitem')).toHaveCount(25)

  await (await libraryControl(page, '읽기 상태')).selectOption('completed')
  await expect(page.getByRole('listitem')).toHaveCount(9)
  await page.screenshot({ path: testInfo.outputPath('library-search-mobile.png'), fullPage: true })
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  await page.screenshot({ path: testInfo.outputPath('library-search-desktop.png') })

  await (await libraryControl(page, '서재 검색어')).fill('없는 책')
  await page.getByRole('button', { name: '검색', exact: true }).click()
  await expect(page.getByText('조건에 맞는 책이 없습니다.')).toBeVisible()

  await page.getByRole('button', { name: '검색 해제' }).click()
  await expect(page.getByRole('listitem')).toHaveCount(10)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.setViewportSize({ width: 390, height: 900 })
  await (await libraryControl(page, '읽기 상태')).selectOption('')
  await expect(page.getByRole('listitem')).toHaveCount(20)
  await expect((await libraryAction(page, '순서 편집'))).toBeEnabled()
  // 개발 모드 StrictMode는 첫 조회를 두 번 보내므로(앞 응답은 버림) 연속 중복만 합쳐 비교한다.
  expect(requests.filter((request, index) => request !== requests[index - 1])).toEqual([
    'offset=0',
    'offset=0&q=한강&field=author',
    'offset=20&q=한강&field=author',
    'offset=0&q=한강&field=author&status=completed',
    'offset=0&q=없는 책&field=author&status=completed',
    'offset=0&status=completed',
    'offset=0',
  ])
})

test('서브 책장: 만들기·서재에서 담기·빼기·필터·이름 변경·삭제 후 책 보존', async ({ page }, testInfo) => {
  const books = Array.from({ length: 3 }, (_, i) => ({
    id: `personal-${i}`, book_id: `catalog-${i}`, isbn13: '9788936433598', title: `책장 책 ${i}`, authors: ['독서가'],
    thumbnail_url: cover('#48594b'), status: 'reading', created_at: '2026-11-02T00:00:00Z', ...noProgress,
  }))
  let shelves: { id: string; name: string; position: number }[] = []
  const members = new Map<string, Set<string>>()
  const writes: string[] = []
  const shelfList = () => shelves.map((shelf) => ({ ...shelf, book_count: members.get(shelf.id)?.size ?? 0 }))
  await mockBackend(page, async (route, url, method) => {
    const request = route.request()
    const path = url.pathname
    if (method !== 'GET') writes.push(`${method} ${path} ${request.postData() ?? ''}`.trim())
    const noContent = () => route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }).then(() => true)
    if (path === '/shelves' && method === 'GET') return json(route, shelfList()).then(() => true)
    if (path === '/shelves' && method === 'POST') {
      const shelf = { id: `shelf-${shelves.length + 1}`, name: request.postDataJSON().name, position: shelves.length }
      shelves.push(shelf)
      return json(route, { ...shelf, book_count: 0 }, 201).then(() => true)
    }
    const shelfMatch = path.match(/^\/shelves\/([^/]+)(\/position|\/books\/([^/]+))?$/)
    if (shelfMatch) {
      const [, id, sub, bookId] = shelfMatch
      if (sub === '/position') {
        const moved = shelves.find((shelf) => shelf.id === id)!
        shelves = shelves.filter((shelf) => shelf.id !== id)
        const after = request.postDataJSON().after_shelf_id
        shelves.splice(after === null ? 0 : shelves.findIndex((shelf) => shelf.id === after) + 1, 0, moved)
        return noContent()
      }
      if (bookId) {
        const set = members.get(id) ?? new Set()
        if (method === 'PUT') set.add(bookId); else set.delete(bookId)
        members.set(id, set)
        return noContent()
      }
      if (method === 'PATCH') {
        const shelf = shelves.find((item) => item.id === id)!
        shelf.name = request.postDataJSON().name
        return json(route, { ...shelf, book_count: members.get(id)?.size ?? 0 }).then(() => true)
      }
      if (method === 'DELETE') {
        shelves = shelves.filter((shelf) => shelf.id !== id)
        members.delete(id)
        return noContent()
      }
    }
    if (path === '/library/books' && method === 'GET') {
      const shelfId = url.searchParams.get('shelf_id')
      if (shelfId && !shelves.some((shelf) => shelf.id === shelfId)) return json(route, { detail: 'Shelf not found' }, 404).then(() => true)
      return json(route, books.filter((book) => !shelfId || members.get(shelfId)?.has(book.id))).then(() => true)
    }
    const detailMatch = path.match(/^\/library\/books\/(personal-\d)$/)
    if (detailMatch && method === 'GET') {
      const book = books.find((item) => item.id === detailMatch[1])!
      return json(route, {
        ...book, publisher: null, published_date: null, description: null, source_url: 'https://example.test', started_at: null,
        last_read_at: null, last_read_date: null, past_log_range: null, completed_at: null, stopped_at: null, stop_reason: null, rating: null, memo: null,
        is_review_public: false, review_published_at: null, review_updated_at: null, has_completed: false, updated_at: '2026-11-02T00:00:00Z',
        allowed_statuses: ['want_to_read', 'reading', 'completed', 'paused', 'abandoned'],
        shelves: shelves.filter((shelf) => members.get(shelf.id)?.has(book.id)).map(({ id, name }) => ({ id, name })),
      }).then(() => true)
    }
    return false
  })
  await signInWithMockSession(page)
  await page.goto('/')
  await expect(page.getByRole('listitem')).toHaveCount(3)

  await (await libraryAction(page, '책장 관리')).click()
  for (const name of ['SF', '에세이']) {
    await page.getByLabel('새 책장 이름').fill(`  ${name} `)
    await page.getByRole('button', { name: '만들기' }).click()
    await expect(page.getByText(`‘${name}’ 책장을 만들었습니다.`)).toBeVisible()
  }
  await page.screenshot({ path: testInfo.outputPath('shelf-manager-mobile.png'), fullPage: true })

  await page.getByRole('button', { name: '책장 관리 닫기' }).click()
  await (await libraryAction(page, '책 선택')).click()
  await page.getByRole('checkbox', { name: '책장 책 1 선택' }).check()
  await page.getByLabel('담을 책장').selectOption({ label: 'SF' })
  await page.getByRole('button', { name: '책장에 담기' }).click()
  await expect(page.getByText('1권을 책장에 담았습니다.')).toBeVisible()
  await page.getByRole('checkbox', { name: '책장 책 1 선택' }).check()
  await page.getByLabel('담을 책장').selectOption({ label: '에세이' })
  await page.getByRole('button', { name: '책장에 담기' }).click()
  await expect(page.getByRole('checkbox', { name: '책장 책 1 선택' })).not.toBeChecked()
  await page.screenshot({ path: testInfo.outputPath('library-shelf-selection-mobile.png'), fullPage: true })
  await page.getByRole('button', { name: '선택 마치기' }).click()
  await expect(page.getByRole('heading', { name: '내 서재' })).toBeVisible()
  await (await libraryControl(page, '책장')).selectOption({ label: 'SF (1권)' })
  await expect(page.locator('ul.shelf > li')).toHaveCount(1)
  await expect((await libraryAction(page, '순서 편집'))).toBeDisabled()

  await (await libraryAction(page, '책 선택')).click()
  await page.getByRole('checkbox', { name: '책장 책 1 선택' }).check()
  await page.getByRole('button', { name: '책장에서 빼기' }).click()
  await expect(page.locator('ul.shelf > li')).toHaveCount(0)
  expect(members.get('shelf-2')?.has('personal-1')).toBe(true)
  await page.getByRole('button', { name: '선택 마치기' }).click()

  await (await libraryAction(page, '책장 관리')).click()
  await page.getByRole('button', { name: '에세이 이동 손잡이' }).click()
  await page.getByRole('button', { name: '에세이 앞으로' }).click()
  await expect(page.getByText('책장 순서를 바꿨습니다.')).toBeVisible()
  await page.getByRole('button', { name: 'SF 이름 바꾸기' }).click()
  await page.getByLabel('SF 새 이름').fill('sf')
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await expect(page.getByText('책장 이름을 바꿨습니다.')).toBeVisible()
  await page.getByRole('button', { name: 'sf 삭제' }).click()
  await page.getByRole('dialog', { name: /책장을 삭제할까요/ }).getByRole('button', { name: '책장 삭제' }).click()
  await expect(page.getByText('‘sf’ 책장을 삭제했습니다. 책은 서재에 그대로 있어요.')).toBeVisible()
  await page.getByRole('button', { name: '책장 관리 닫기' }).click()
  // 보고 있던 책장을 지우면 전체 서재로 돌아가고 책은 그대로다.
  await expect(page.locator('ul.shelf > li')).toHaveCount(3)
  await expect((await libraryAction(page, '순서 편집'))).toBeEnabled()
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  expect(writes).toEqual([
    'POST /shelves {"name":"SF"}',
    'POST /shelves {"name":"에세이"}',
    'PUT /shelves/shelf-1/books/personal-1',
    'PUT /shelves/shelf-2/books/personal-1',
    'DELETE /shelves/shelf-1/books/personal-1',
    'PATCH /shelves/shelf-2/position {"after_shelf_id":null}',
    'PATCH /shelves/shelf-1 {"name":"sf"}',
    'DELETE /shelves/shelf-1',
  ])
})

test('책장 손잡이는 키보드·이동 메뉴·터치 드래그와 모달 내부 자동 스크롤을 제공한다', async ({ page, context }, testInfo) => {
  let shelves = Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, name: `책장 ${i}`, book_count: 0, position: i }))
  const moves: { id: string; after: string | null }[] = []
  let failNext = false
  await mockBackend(page, async (route, url, method) => {
    if (url.pathname === '/shelves') return json(route, shelves).then(() => true)
    if (url.pathname === '/library/books') return json(route, []).then(() => true)
    if (url.pathname.endsWith('/position') && method === 'PATCH') {
      const id = url.pathname.split('/')[2]
      const after = route.request().postDataJSON().after_shelf_id
      moves.push({ id, after })
      if (failNext) { failNext = false; return json(route, { code: 'invalid_position', detail: 'invalid' }, 422).then(() => true) }
      const moved = shelves.find((item) => item.id === id)!
      shelves = shelves.filter((item) => item.id !== id)
      shelves.splice(after === null ? 0 : shelves.findIndex((item) => item.id === after) + 1, 0, moved)
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }).then(() => true)
    }
    return false
  })
  await signInWithMockSession(page)
  await page.setViewportSize({ width: 390, height: 650 })
  await page.goto('/')
  await (await libraryAction(page, '책장 관리')).click()
  const modal = page.getByRole('dialog', { name: '책장 관리', exact: true })
  const items = modal.locator('.shelf-list > li')
  const handle = (i: number) => page.getByRole('button', { name: `책장 ${i} 이동 손잡이`, exact: true })
  const pane = modal.locator('.shelf-manager')
  const cdp = await context.newCDPSession(page)
  await expect(page.getByRole('button', { name: '앞', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '뒤', exact: true })).toHaveCount(0)
  await handle(12).evaluate((element) => element.scrollIntoView({ block: 'end' }))
  const stationary = (await handle(12).boundingBox())!
  const beforeScroll = await pane.evaluate((el) => el.scrollTop)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: stationary.x + stationary.width / 2, y: stationary.y + stationary.height / 2, id: 0 }] })
  await page.waitForTimeout(250)
  const heldScroll = await pane.evaluate((el) => el.scrollTop)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  expect(heldScroll).toBe(beforeScroll)
  expect(moves).toHaveLength(0)
  await expect(page.locator('.order-menu')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await handle(1).press('ArrowUp')
  await expect(items.first()).toContainText('책장 1')
  await expect(handle(1)).toBeFocused()
  await handle(1).tap()
  await expect(page.getByRole('button', { name: '책장 1 앞으로' })).toBeDisabled()
  await page.getByRole('button', { name: '책장 1 뒤로' }).click()
  await expect(items.first()).toContainText('책장 0')
  await expect(handle(1)).toBeFocused()
  await handle(24).scrollIntoViewIfNeeded()
  const from = (await handle(24).boundingBox())!
  const area = (await pane.boundingBox())!
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x + from.width / 2, y: from.y + from.height / 2, id: 0 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + from.width / 2, y: area.y + 4, id: 0 }] })
  await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBe(0)
  const target = (await items.first().boundingBox())!
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: target.x + target.width / 2, y: target.y + target.height / 2, id: 0 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(items.first()).toContainText('책장 24')
  await expect(handle(24)).toBeFocused()
  await expect(page.locator('.order-menu')).toHaveCount(0)
  expect(moves).toEqual([{ id: 's1', after: null }, { id: 's1', after: 's0' }, { id: 's24', after: null }])
  const point = (await handle(24).boundingBox())!
  const next = (await items.nth(1).boundingBox())!
  await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2)
  await page.mouse.down()
  await page.mouse.move(next.x + next.width / 2, next.y + next.height / 2, { steps: 4 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(modal).toBeVisible()
  expect(moves).toHaveLength(3)
  failNext = true
  await handle(24).press('ArrowDown')
  await expect(page.getByRole('alert')).toContainText('자기 자신 뒤로')
  await expect(handle(24)).toBeEnabled()
  await expect(handle(24)).toBeFocused()
  await expect(items.first()).toContainText('책장 24')
  expect(moves).toHaveLength(4)
  await handle(24).tap()
  await page.screenshot({ path: testInfo.outputPath('shelf-order-menu-mobile.png') })
})

test('책장 모달은 목록을 밀지 않고 모바일 내부 스크롤·저장 잠금·삭제 취소·초점 복귀를 지킨다', async ({ page }, testInfo) => {
  let shelves = Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, name: `책장 ${i}`, book_count: 0, position: i }))
  let started = false
  let finish!: () => void
  const pending = new Promise<void>((resolve) => { finish = resolve })
  await mockBackend(page, async (route, url, method) => {
    if (url.pathname === '/shelves' && method === 'GET') return json(route, shelves).then(() => true)
    if (url.pathname === '/shelves' && method === 'POST') {
      started = true
      await pending
      const item = { id: 'new', name: route.request().postDataJSON().name, book_count: 0, position: 25 }
      shelves = [...shelves, item]
      return json(route, item, 201).then(() => true)
    }
    if (url.pathname === '/library/books') return json(route, [{ id: 'b1', book_id: 'c1', isbn13: '9788936433598', title: '보존할 책', authors: [], thumbnail_url: null, status: 'reading', created_at: '2026-11-02T00:00:00Z', ...noProgress }]).then(() => true)
    return false
  })
  await signInWithMockSession(page)
  await page.setViewportSize({ width: 390, height: 650 })
  await page.goto('/')
  await page.locator('ul.shelf > li').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.locator('ul.shelf').evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)))
  const top = await page.locator('ul.shelf').evaluate((el) => el.getBoundingClientRect().top)
  await (await libraryAction(page, '책장 관리')).click()
  const modal = page.getByRole('dialog', { name: '책장 관리', exact: true })
  await expect(modal).toBeVisible()
  expect(await modal.evaluate((el) => el.matches(':modal'))).toBe(true)
  expect(await page.locator('ul.shelf').evaluate((el) => el.getBoundingClientRect().top)).toBe(top)
  expect(await modal.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.width <= innerWidth })).toBe(true)
  expect(await modal.locator('.shelf-manager').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  await page.getByLabel('새 책장 이름').fill('새 책장')
  await page.getByRole('button', { name: '만들기' }).click()
  await expect.poll(() => started).toBe(true)
  await expect(page.getByRole('button', { name: '책장 관리 닫기' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(modal).toBeVisible()
  finish()
  await expect(page.getByText('‘새 책장’ 책장을 만들었습니다.')).toBeVisible()
  await page.getByRole('button', { name: '책장 0 삭제', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: '‘책장 0’ 책장을 삭제할까요?' })
  await expect(confirm).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(confirm).not.toBeVisible()
  await expect(modal).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('shelf-modal-mobile.png') })
  await page.keyboard.press('Escape')
  await expect(modal).toHaveCount(0)
  await expect(page.locator('.library-management summary')).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('')
})

test('데스크톱 스크롤바를 잠가도 책 목록의 가로 위치와 폭을 유지한다', async () => {
  const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--disable-features=OverlayScrollbar'] })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1, reducedMotion: 'reduce' })
    const books = Array.from({ length: 25 }, (_, i) => ({ id: `book-${i}`, book_id: `catalog-${i}`, isbn13: '9788936433598',
      title: `스크롤바 확인 ${i}`, authors: [], thumbnail_url: null, status: 'reading', created_at: '2026-11-02T00:00:00Z', ...noProgress }))
    await mockBackend(page, async (route, url) => {
      if (url.pathname !== '/library/books') return false
      const offset = Number(url.searchParams.get('offset'))
      return json(route, books.slice(offset, offset + Number(url.searchParams.get('limit')))).then(() => true)
    })
    await signInWithMockSession(page)
    await page.goto('http://localhost:4174/')
    await page.locator('ul.shelf > li').first().waitFor()
    await page.evaluate(() => document.fonts.ready)
    const geometry = () => page.locator('ul.shelf').evaluate((el) => {
      const rect = el.getBoundingClientRect()
      return { left: rect.left, width: rect.width }
    })
    await expect.poll(() => page.evaluate(() => document.documentElement.clientWidth < innerWidth)).toBe(true)
    const before = await geometry()
    await (await libraryAction(page, '책장 관리')).click()
    await expect(page.getByRole('dialog', { name: '책장 관리', exact: true })).toBeVisible()
    expect(await geometry()).toEqual(before)
    await page.getByRole('button', { name: '책장 관리 닫기' }).click()
    expect(await geometry()).toEqual(before)
    expect(await page.evaluate(() => document.documentElement.style.scrollbarGutter)).toBe('')
  } finally { await browser.close() }
})
