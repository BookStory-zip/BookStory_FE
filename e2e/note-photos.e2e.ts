import { expect, test } from '@playwright/test'
import { json, mockBackend, noProgress, signInWithMockSession } from './fixtures'

test('편집 도구로 자르기·회전·펜·형광펜을 적용한 JPEG만 업로드한다', async ({ page, context }, testInfo) => {
  test.setTimeout(60_000)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
  const book = { id: 'edit-book', book_id: 'b', isbn13: '9788936433598', title: '문구를 남기는 책', authors: ['작가'], thumbnail_url: null, status: 'reading', created_at: `${today}T00:00:00Z`, ...noProgress,
    publisher: null, published_date: null, description: null, source_url: 'https://example.test', started_at: null, last_read_at: null, last_read_date: null, completed_at: null, stopped_at: null, stop_reason: null, rating: null, memo: null, is_review_public: false, review_published_at: null, review_updated_at: null, has_completed: false, updated_at: `${today}T00:00:00Z`, allowed_statuses: ['reading', 'completed', 'want_to_read', 'paused', 'abandoned'], shelves: [], past_log_range: null }
  let sent: { base64: string; type: string; name: string } | null = null
  await signInWithMockSession(page)
  await mockBackend(page, async (route, url, method) => {
    if (url.pathname === '/library/books/edit-book') return json(route, book).then(() => true)
    if (url.pathname === '/reading-logs') return json(route, []).then(() => true)
    if (url.pathname === '/library/books/edit-book/notes/photo' && method === 'POST') {
      const headers = route.request().headers()
      const data = await new Response(new Uint8Array(route.request().postDataBuffer()!), { headers: { 'content-type': headers['content-type'] } }).formData()
      const photo = data.get('photo') as File
      sent = { base64: Buffer.from(await photo.arrayBuffer()).toString('base64'), type: photo.type, name: photo.name }
      return json(route, { id: 'edited-note', user_book_id: book.id, note_date: today, quote: null, thought: null, page: null, has_photo: true, photo_url: null, created_at: book.created_at, updated_at: book.updated_at }, 201).then(() => true)
    }
    return false
  })
  await page.goto('/books/edit-book')
  await page.locator('summary').filter({ hasText: /^나의 독서 노트$/ }).click()
  await page.getByRole('button', { name: '노트 쓰기' }).click()
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 800; canvas.height = 400
    const context = canvas.getContext('2d')!
    context.fillStyle = 'white'; context.fillRect(0, 0, 800, 400)
    context.fillStyle = '#222'; context.font = '24px serif'; context.fillText('A sentence worth keeping', 200, 135)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  const input = page.getByLabel('사진 선택', { exact: true })
  const file = { name: 'sentence.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') }
  await input.setInputFiles(file)
  let editor = page.getByRole('dialog', { name: '사진 편집' })
  await expect(editor.getByRole('button', { name: '이 사진 사용' })).toBeEnabled()
  await editor.getByRole('button', { name: '취소', exact: true }).click()
  expect(sent).toBeNull()
  await expect(page.getByAltText('저장할 사진 미리보기')).toHaveCount(0)
  await input.setInputFiles(file)
  editor = page.getByRole('dialog', { name: '사진 편집' })
  await expect(editor.getByRole('button', { name: '이 사진 사용' })).toBeEnabled()
  const stage = editor.locator('.photo-editor-stage')
  await editor.getByRole('button', { name: '자를 영역' }).focus()
  await page.keyboard.press('Shift+ArrowLeft')
  await expect(editor.getByRole('button', { name: '자를 영역' })).toHaveAttribute('style', /width:\s*99%/)
  await editor.getByRole('button', { name: '되돌리기' }).click()
  const stroke = async (x1: number, y1: number, x2: number, y2: number) => {
    const box = (await stage.boundingBox())!
    await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * x2, box.y + box.height * y2, { steps: 8 })
    await page.mouse.up()
  }
  await editor.getByRole('button', { name: '형광펜', exact: true }).click()
  const touchBox = (await stage.boundingBox())!
  const cdp = await context.newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchBox.x + touchBox.width * .3, y: touchBox.y + touchBox.height * .5, id: 0 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchBox.x + touchBox.width * .7, y: touchBox.y + touchBox.height * .5, id: 0 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
  const inkAlpha = () => editor.locator('.photo-editor-ink').evaluate((canvas: HTMLCanvasElement) => canvas.getContext('2d')!.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data[3])
  expect(await inkAlpha()).toBeGreaterThan(0)
  await editor.getByRole('button', { name: '되돌리기' }).click()
  expect(await inkAlpha()).toBe(0)
  await stroke(.3, .5, .7, .5)
  await editor.getByRole('button', { name: '펜', exact: true }).click()
  await stroke(.4, .4, .6, .4)
  await editor.getByRole('button', { name: '자르기', exact: true }).click()
  await stroke(.25, .25, .75, .75)
  await editor.getByRole('button', { name: '90도 회전' }).click()
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(editor.getByRole('button', { name: '이 사진 사용' })).toBeInViewport()
    expect(await editor.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`editor-${width}.png`) })
    await editor.getByRole('button', { name: '형광펜', exact: true }).click()
    await expect(editor.getByLabel('선 굵기')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`editor-brush-${width}.png`) })
    await editor.getByRole('button', { name: '자르기', exact: true }).click()
  }
  await editor.getByRole('button', { name: '이 사진 사용' }).click()
  expect(sent).toBeNull()
  await page.getByRole('button', { name: '노트 저장', exact: true }).click()
  await expect(page.getByText('노트를 저장했습니다.')).toBeVisible()
  expect(sent).toMatchObject({ type: 'image/jpeg', name: 'sentence.jpg' })
  const output = await page.evaluate(async (value: string) => {
    const image = new Image()
    image.src = `data:image/jpeg;base64,${value}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width; canvas.height = image.height
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    return { width: image.width, height: image.height, pixel: [...context.getImageData(image.width / 2, image.height / 2, 1, 1).data] }
  }, sent!.base64)
  expect(output.width).toBeGreaterThanOrEqual(198)
  expect(output.width).toBeLessThanOrEqual(202)
  expect(output.height).toBeGreaterThanOrEqual(398)
  expect(output.height).toBeLessThanOrEqual(402)
  expect(output.pixel[0]).toBeGreaterThan(240)
  expect(output.pixel[2]).toBeLessThan(220)
})

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
  await page.getByRole('button', { name: '이 사진 사용' }).click()
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
  await page.getByRole('button', { name: '이 사진 사용' }).click()
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
