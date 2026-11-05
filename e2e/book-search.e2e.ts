import { expect, test } from '@playwright/test'
import { json, mockBackend, signInWithMockSession } from './fixtures'

test('검색 기준·정렬·빈 페이지 더 보기와 조건 초기화가 이어진다', async ({ page }, testInfo) => {
  const requests: { query: string | null; page: string | null; target: string | null; sort: string | null }[] = []
  await signInWithMockSession(page)
  await mockBackend(page, async (route, url) => {
    if (url.pathname !== '/books/search') return false
    const params = url.searchParams
    const target = params.get('target')
    const sort = params.get('sort')
    const number = Number(params.get('page'))
    requests.push({ query: params.get('query'), page: params.get('page'), target, sort })
    const hidden = target === 'person' && number === 1
    const title = target === 'person' ? '저자 최신 결과' : target === 'publisher'
      ? sort === 'latest' ? '출판사 최신 결과' : '출판사 정확도 결과' : '전체 정확도 결과'
    return json(route, {
      documents: [{ title: hidden ? '전용 상품' : title, authors: ['한강'], publisher: '창비', thumbnail: null, isbn13: hidden ? null : '9788936433598' }],
      meta: { is_end: target !== 'person' },
    }).then(() => true)
  })
  await page.goto('/search')
  await page.getByLabel('검색 기준').selectOption('person')
  await page.getByLabel('검색 결과 정렬').selectOption('latest')
  expect(requests).toHaveLength(0)
  await page.getByRole('searchbox').fill('한강')
  await page.getByRole('button', { name: '검색', exact: true }).click()
  await expect(page.getByText('담을 수 있는 책이 이 페이지에 없습니다. 더 보기를 눌러 주세요.')).toBeVisible()
  await page.getByRole('button', { name: '결과 더 보기' }).click()
  await expect(page.getByRole('link', { name: '저자 최신 결과' })).toBeVisible()
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`book-search-${width}.png`), fullPage: true })
  }
  await page.getByLabel('검색 기준').selectOption('publisher')
  await expect(page.getByRole('link', { name: '출판사 최신 결과' })).toBeVisible()
  await expect(page.getByRole('link', { name: '저자 최신 결과' })).toHaveCount(0)
  await expect(page.getByText(/표시하지 않았어요/)).toHaveCount(0)
  await page.getByLabel('검색 결과 정렬').selectOption('accuracy')
  await expect(page.getByRole('link', { name: '출판사 정확도 결과' })).toBeVisible()
  await page.getByLabel('검색 기준').selectOption('')
  await expect(page.getByRole('link', { name: '전체 정확도 결과' })).toBeVisible()
  await expect(page.getByText('‘한강’ · 전체 · 정확도순')).toBeVisible()
  expect(requests).toEqual([
    { query: '한강', page: '1', target: 'person', sort: 'latest' },
    { query: '한강', page: '2', target: 'person', sort: 'latest' },
    { query: '한강', page: '1', target: 'publisher', sort: 'latest' },
    { query: '한강', page: '1', target: 'publisher', sort: null },
    { query: '한강', page: '1', target: null, sort: null },
  ])
})
