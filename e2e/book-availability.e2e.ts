import { expect, test } from '@playwright/test'
import { json, mockBackend, signInWithMockSession } from './fixtures'

test('구매·대출 탭은 공개 링크와 명시적 지역 조회·장애·지역 폐지를 처리한다', async ({ page }, testInfo) => {
  const isbn = '9788936434120'
  const online = [
    { store: 'yes24', name: 'YES24', url: `https://www.yes24.com/Product/Search?query=${isbn}` },
    { store: 'kyobo', name: '교보문고', url: `https://search.kyobobook.co.kr/search?keyword=${isbn}` },
    { store: 'aladin', name: '알라딘', url: `https://www.aladin.co.kr/search/wsearchresult.aspx?SearchWord=${isbn}` },
  ]
  const district = { code: '11190', name: '서울특별시 영등포구' }
  const library = { lib_code: '1', name: '가온도서관', address: '서울특별시 영등포구 도서관로', tel: '02-123-4567', homepage: 'http://library.example.test', operating_time: '평일 09:00–22:00', closed: '매주 월요일', loan_available: true }
  let lookups = 0
  let onlineLookups = 0
  let regionLookups = 0
  let mode: 'success' | 'failure' | 'empty' | 'removed' = 'success'
  await signInWithMockSession(page)
  await mockBackend(page, async (route, url) => {
    if (url.pathname === '/regions') {
      regionLookups++
      expect(route.request().headers().authorization).toBeUndefined()
      return json(route, [{ code: '11', name: '서울특별시', districts: [{ code: '11190', name: '영등포구' }] }]).then(() => true)
    }
    if (url.pathname === `/books/${isbn}/where`) {
      expect(route.request().headers().authorization).toBeUndefined()
      if (!url.searchParams.has('district')) { onlineLookups++; return json(route, { online, district: null, libraries: [] }).then(() => true) }
      lookups++
      if (mode === 'removed') return json(route, { code: 'region_not_found', detail: 'Region not found' }, 422).then(() => true)
      return json(route, { online, district, libraries: mode === 'failure' ? null : mode === 'empty' ? [] : [library, { ...library, lib_code: '2', name: '나무도서관', loan_available: false }, { ...library, lib_code: '3', name: '다온도서관', address: null, loan_available: null }] }).then(() => true)
    }
    if (url.pathname === `/books/${isbn}`) return json(route, { isbn13: isbn, title: '소년이 온다', authors: ['한강'], publisher: '창비', published_date: null, thumbnail_url: null, description: '책 소개 예시', source_url: 'https://example.test/book', page_count: 216, reviews: { total_reviews: 0, rating_count: 0, average_rating: null } }).then(() => true)
    if (url.pathname.endsWith('/reviews')) return json(route, []).then(() => true)
    if (url.pathname.startsWith('/library/books/by-isbn/')) return json(route, { detail: 'not found' }, 404).then(() => true)
    return false
  })
  await page.goto(`/catalog/${isbn}`)
  const section = page.getByRole('region', { name: '구매·대출', exact: true })
  await expect(section.getByRole('link', { name: 'YES24에서 검색' })).toBeVisible()
  expect(lookups).toBe(0); expect(regionLookups).toBe(0)
  await expect(section.locator('summary')).toHaveCount(0)
  await section.getByRole('tab', { name: '온라인' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(section.getByRole('tab', { name: '도서관' })).toBeFocused()
  await section.getByRole('combobox', { name: '시·도', exact: true }).selectOption('11')
  await section.getByRole('combobox', { name: '시·군·구', exact: true }).selectOption('11190')
  expect(lookups).toBe(0)
  await section.getByRole('button', { name: '도서관 찾기' }).click()
  await expect(section.getByText('대출 불가', { exact: true })).toBeVisible()
  await expect(section.getByText('대출 여부 미확인')).toBeVisible()
  await expect(section.locator('.availability-libraries > li').filter({ hasText: '다온도서관' }).locator('p')).toHaveCount(0)
  await expect(section.getByRole('link', { name: /홈페이지.*가온도서관/ })).toHaveAttribute('href', 'http://library.example.test')
  const initialOnlineLookups = onlineLookups
  await page.getByRole('button', { name: '다시 불러오기', exact: true }).click()
  await expect(section.getByText('가온도서관', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '서재에 담기', exact: true })).toBeVisible()
  expect(onlineLookups).toBe(initialOnlineLookups)
  expect(lookups).toBe(1)
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await section.scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`availability-${width}.png`) })
  }
  await section.getByRole('tab', { name: '온라인' }).click()
  await expect(section.getByRole('link', { name: '알라딘에서 검색' })).toBeVisible()
  await section.getByRole('tab', { name: '도서관' }).click()
  expect(lookups).toBe(1)
  mode = 'failure'
  await section.getByRole('button', { name: '도서관 찾기' }).click()
  await expect(section.getByText(/도서관 정보를 불러오지 못/)).toBeVisible()
  mode = 'empty'
  await section.getByRole('button', { name: '도서관 찾기' }).click()
  await expect(section.getByText(/소장한 도서관이 없습니다/)).toBeVisible()
  mode = 'removed'
  await section.getByRole('button', { name: '도서관 찾기' }).click()
  await expect(section.getByText(/지역을 다시 선택/)).toBeVisible()
  await expect(section.getByRole('combobox', { name: '시·도', exact: true })).toHaveValue('')
})
