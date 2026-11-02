import { expect, test } from '@playwright/test'
import { cover, json, mockBackend, signInWithMockSession } from './fixtures'

test('순서 편집: 키보드·탭 이동, 불러온 범위 유지, 새로고침 후 저장된 순서', async ({ page }) => {
  let books = Array.from({ length: 23 }, (_, i) => ({
    id: `personal-${i}`, book_id: `catalog-${i}`, isbn13: '9788936433598',
    title: `서재 책 ${i}`, authors: ['독서가'], thumbnail_url: cover('#48594b'),
    status: 'want_to_read', created_at: '2026-11-02T00:00:00Z',
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
  await page.getByRole('button', { name: '더 보기' }).click()
  await expect(page.getByRole('listitem')).toHaveCount(23)
  await page.getByRole('button', { name: '순서 편집' }).click()
  const forward = page.getByRole('button', { name: '서재 책 1 앞으로', exact: true })
  await forward.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: '서재 책 1 이동 손잡이', exact: true })).toBeFocused()
  await expect(page.getByRole('listitem')).toHaveCount(23)
  await expect(page.getByRole('listitem').first()).toContainText('서재 책 1')
  expect(moves).toEqual([{ after_user_book_id: null }])
  await page.getByRole('button', { name: '서재 책 1 뒤로', exact: true }).tap()
  await expect(page.getByRole('listitem').first()).toContainText('서재 책 0')
  expect(moves).toEqual([{ after_user_book_id: null }, { after_user_book_id: 'personal-0' }])
  await expect(page.getByRole('listitem')).toHaveCount(23)
  await expect(page.getByRole('button', { name: '더 보기' })).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('listitem')).toHaveCount(20)
  await expect(page.getByRole('listitem').nth(1)).toContainText('서재 책 1')
  await expect(page.getByRole('link', { name: '서재 책 1 독서가 읽고 싶음', exact: true })).toHaveAttribute('href', '/books/personal-1')
})

test('손잡이 드래그: 이동·동일 위치·Escape·영역 밖 취소와 터치', async ({ page, context }) => {
  let books = Array.from({ length: 3 }, (_, i) => ({
    id: `personal-${i}`, book_id: `catalog-${i}`, isbn13: '9788936433598',
    title: `드래그 책 ${i}`, authors: [], thumbnail_url: cover('#8d714e'),
    status: 'reading', created_at: '2026-11-02T00:00:00Z',
  }))
  const anchors: (string | null)[] = []
  await mockBackend(page, async (route, url, method) => {
    if (url.pathname === '/library/books') { await json(route, books); return true }
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
  await page.getByRole('button', { name: '순서 편집' }).click()
  const handle = (i: number) => page.getByRole('button', { name: `드래그 책 ${i} 이동 손잡이` })
  const position = async (i: number) => {
    await handle(i).scrollIntoViewIfNeeded()
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
})

test('손잡이 드래그: 화면 가장자리에서 자동 스크롤해 보이지 않던 위치로 옮긴다', async ({ page }) => {
  let books = Array.from({ length: 20 }, (_, i) => ({
    id: `personal-${i}`, book_id: `catalog-${i}`, isbn13: '9788936433598',
    title: `스크롤 책 ${i}`, authors: [], thumbnail_url: cover('#48594b'),
    status: 'reading', created_at: '2026-11-02T00:00:00Z',
  }))
  const anchors: (string | null)[] = []
  await mockBackend(page, async (route, url, method) => {
    if (url.pathname === '/library/books') { await json(route, books); return true }
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
  await page.getByRole('button', { name: '순서 편집' }).click()
  const last = page.getByRole('button', { name: '스크롤 책 19 이동 손잡이' })
  await last.scrollIntoViewIfNeeded()
  const first = page.getByRole('button', { name: '스크롤 책 0 이동 손잡이' })
  await expect(first).not.toBeInViewport()
  const from = (await last.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2, 5, { steps: 8 })
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  const to = (await first.boundingBox())!
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 4 })
  await page.mouse.up()
  await expect(page.getByRole('listitem').first()).toContainText('스크롤 책 19')
  expect(anchors).toEqual([null])
})
