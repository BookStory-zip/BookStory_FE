import { expect, test } from '@playwright/test'
import { json, mockBackend, noProgress, signInWithMockSession } from './fixtures'

test('사진 노트 응답 유실 재확인·URL 갱신·교체 실패 보존·삭제와 타임라인', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
  const book = { id: 'ub', book_id: 'b', isbn13: '9788936433598', title: '소년이 온다', authors: ['한강'], thumbnail_url: null, status: 'reading', created_at: `${today}T00:00:00Z`, ...noProgress }
  const detail = { ...book, publisher: null, published_date: null, description: null, source_url: 'https://example.test', started_at: null, last_read_at: null, last_read_date: null, completed_at: null, stopped_at: null, stop_reason: null, rating: null, memo: null, is_review_public: false, review_published_at: null, review_updated_at: null, has_completed: false, updated_at: book.created_at, allowed_statuses: ['reading', 'completed', 'want_to_read', 'paused', 'abandoned'], shelves: [], past_log_range: null }
  const note = { id: 'n', user_book_id: 'ub', note_date: today, quote: null as string | null, thought: null, page: null, has_photo: true, photo_url: 'https://photos.e2e.test/expired' as string | null, created_at: book.created_at, updated_at: book.created_at }
  const submittedIds: string[] = []
  let exists = false
  let expired = true
  let failReplacement = true
  let creates = 0
  let photoDeletes = 0
  await signInWithMockSession(page)
  await page.route('https://photos.e2e.test/**', async (route) => {
    if (route.request().url().endsWith('/expired')) { expired = false; return route.fulfill({ status: 403 }) }
    return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#ede3ca"/><text x="40" y="100" font-size="28">Reading note</text></svg>' })
  })
  await mockBackend(page, async (route, url, method) => {
    if (url.pathname === '/library/books/ub') return json(route, detail).then(() => true)
    if (url.pathname === '/reading-logs') return json(route, []).then(() => true)
    if (url.pathname === '/library/books/ub/notes/photo') {
      const request = route.request()
      expect(request.headers()['content-type']).toContain('multipart/form-data; boundary=')
      const data = await new Response(new Uint8Array(request.postDataBuffer()!), { headers: { 'content-type': request.headers()['content-type'] } }).formData()
      submittedIds.push(String(data.get('client_note_id')))
      expect(data.get('photo')).toBeTruthy()
      expect(data.get('note_date')).toBe(today)
      if (!exists) { exists = true; creates++; await route.abort('failed'); return true }
      return json(route, note).then(() => true)
    }
    if (url.pathname === '/library/books/ub/notes') return json(route, exists ? [{ ...note, photo_url: note.has_photo ? (expired ? note.photo_url : 'https://photos.e2e.test/fresh') : null }] : []).then(() => true)
    if (url.pathname === '/notes/n/photo' && method === 'PUT') {
      if (failReplacement) return json(route, { code: 'photo_storage_unavailable', detail: 'unavailable' }, 503).then(() => true)
      return json(route, { ...note, photo_url: 'https://photos.e2e.test/replaced' }).then(() => true)
    }
    if (url.pathname === '/notes/n/photo' && method === 'DELETE') { note.has_photo = false; note.photo_url = null; photoDeletes++; return route.fulfill({ status: 204 }).then(() => true) }
    if (url.pathname === '/notes/n' && method === 'PATCH') { Object.assign(note, route.request().postDataJSON()); return json(route, note).then(() => true) }
    if (url.pathname === '/notes') return json(route, exists ? [{ ...note, photo_url: note.has_photo ? 'https://photos.e2e.test/fresh' : null, title: book.title, authors: book.authors, thumbnail_url: null }] : []).then(() => true)
    return false
  })
  await page.goto('/books/ub')
  await page.locator('summary').filter({ hasText: /^나의 독서 노트$/ }).click()
  await page.getByRole('button', { name: '노트 쓰기' }).click()
  const file = { name: 'note.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') }
  await page.getByLabel('사진 선택', { exact: true }).setInputFiles(file)
  await expect(page.getByAltText('저장할 사진 미리보기')).toBeVisible()
  await page.getByRole('button', { name: '노트 저장', exact: true }).click()
  await page.getByRole('button', { name: '같은 내용으로 다시 확인' }).click()
  await expect(page.getByText('노트를 저장했습니다.')).toBeVisible()
  expect(creates).toBe(1)
  expect(submittedIds).toHaveLength(2)
  expect(submittedIds[0]).toMatch(/^[\da-f-]{36}$/)
  expect(submittedIds[1]).toBe(submittedIds[0])
  const image = page.getByAltText('독서 노트 첨부 사진')
  await expect(image).toHaveAttribute('src', 'https://photos.e2e.test/fresh')
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  await expect(page.getByRole('button', { name: '사진 삭제', exact: true })).toHaveCount(0)
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`note-photo-${width}.png`), fullPage: true })
  }
  await page.getByLabel(/사진 바꾸기$/).setInputFiles(file)
  await expect(page.getByRole('button', { name: '선택한 사진 다시 저장' })).toBeVisible()
  await expect(image).toHaveAttribute('src', 'https://photos.e2e.test/fresh')
  failReplacement = false
  await page.getByRole('button', { name: '선택한 사진 다시 저장' }).click()
  await expect(page.getByText('사진을 저장했습니다.')).toBeVisible()
  await page.getByRole('button', { name: /노트 수정$/ }).click()
  await page.getByLabel('인상 깊은 문구').fill('사진에 남긴 문장')
  await page.getByRole('button', { name: '노트 저장', exact: true }).click()
  await expect(page.getByText('노트를 수정했습니다.')).toBeVisible()
  await page.getByRole('link', { name: '기록', exact: true }).click()
  await page.getByRole('button', { name: '노트', exact: true }).click()
  await expect(page.getByText('사진에 남긴 문장')).toBeVisible()
  await expect(page.getByAltText('독서 노트 첨부 사진')).toBeVisible()
  await page.getByRole('link', { name: '소년이 온다 한강' }).click()
  await page.locator('summary').filter({ hasText: /^나의 독서 노트$/ }).click()
  await page.getByRole('button', { name: '사진 삭제', exact: true }).click()
  await expect(page.getByText('사진을 삭제했습니다.')).toBeVisible()
  expect(photoDeletes).toBe(1)
  await expect(page.getByText('사진에 남긴 문장')).toBeVisible()
  await expect(page.getByAltText('독서 노트 첨부 사진')).toHaveCount(0)
})
