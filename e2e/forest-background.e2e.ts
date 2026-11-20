import { expect, test } from '@playwright/test'
import { json, mockBackend, signInWithMockSession } from './fixtures'

test('서재·책 찾기·계정 화면에서 같은 흐린 숲 배경을 유지한다', async ({ page }) => {
  await signInWithMockSession(page)
  await mockBackend(page, (route, url) => {
    if (url.pathname === '/library/books') return json(route, []).then(() => true)
    return false
  })
  for (const path of ['/', '/search', '/settings']) {
    await page.goto(path)
    await expect(page.locator('main.app')).toBeVisible()
    const forest = await page.locator('#root').evaluate(element => {
      const layer = getComputedStyle(element, '::before')
      return { display: layer.display, image: layer.backgroundImage, filter: layer.filter }
    })
    expect(forest.display).not.toBe('none')
    expect(forest.image).toContain('/library-forest.jpg')
    expect(forest.filter).toContain('blur(10px)')
    const veil = await page.locator('#root').evaluate(element => getComputedStyle(element, '::after').backgroundImage)
    expect(veil).toContain('gradient')
  }
})
