import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { json, mockBackend, signInWithMockSession } from './fixtures'

async function mockPush(page: Page, permission: 'default' | 'granted' | 'unsupported') {
  await page.addInitScript((initial) => {
    if (initial === 'unsupported') {
      Reflect.deleteProperty(window, 'PushManager')
      return
    }
    let permission = initial
    let current: unknown = null
    const pushManager = {
      getSubscription: async () => current,
      subscribe: async (options: unknown) => {
        const endpoint = 'https://fcm.googleapis.com/fcm/send/e2e'
        current = { endpoint, options, toJSON: () => ({ endpoint, keys: { p256dh: 'key', auth: 'auth' } }), unsubscribe: async () => { current = null; return true } }
        return current
      },
    }
    const registration = { pushManager, update: async () => undefined }
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
      getRegistration: async () => registration,
      register: async () => registration,
      ready: Promise.resolve(registration),
    } })
    Object.defineProperty(window, 'Notification', { configurable: true, value: {
      get permission() { return permission },
      requestPermission: async () => {
        localStorage.setItem('permission-requested', 'yes')
        permission = 'granted'
        return permission
      },
    } })
  }, permission)
}

test('계정 설정·기기 권한을 나누고 끄기·복귀·로그아웃 계약을 지킨다', async ({ page }, testInfo) => {
  await signInWithMockSession(page)
  await mockPush(page, 'default')
  let enabled = false
  const writes: string[] = []
  await mockBackend(page, async (route, url, method) => {
    if (url.pathname === '/me/profile') return json(route, { nickname: '책 읽는 밤' }).then(() => true)
    if (url.pathname === '/library/books') return json(route, []).then(() => true)
    if (url.pathname === '/push/public-key') return json(route, { public_key: 'BAECAw' }).then(() => true)
    if (url.pathname === '/me/reminder-settings') {
      if (method === 'PUT') {
        enabled = route.request().postDataJSON().enabled
        writes.push(`setting:${enabled}`)
      }
      return json(route, method === 'GET' ? { enabled } : null, method === 'GET' ? 200 : 204).then(() => true)
    }
    if (url.pathname === '/me/push-subscriptions') {
      writes.push(`subscription:${method}`)
      return json(route, null, 204).then(() => true)
    }
    return false
  })
  await page.goto('/settings')
  const settings = page.getByRole('region', { name: '독서 알림', exact: true })
  await expect(settings.getByRole('button', { name: '알림 켜기' })).toBeEnabled()
  expect(writes).toEqual([])
  await settings.getByRole('button', { name: '알림 켜기' }).click()
  await expect(settings.getByRole('button', { name: '이 기기 알림 허용' })).toBeEnabled()
  expect(await page.evaluate(() => localStorage.getItem('permission-requested'))).toBeNull()
  expect(writes).toEqual(['setting:true'])
  await settings.getByRole('button', { name: '이 기기 알림 허용' }).click()
  await expect(settings.getByText('이 기기에서 알림을 받을 수 있어요.')).toBeVisible()
  expect(writes).toEqual(['setting:true', 'subscription:PUT'])
  await settings.getByRole('button', { name: '알림 끄기' }).click()
  await expect(settings.getByText(/계정 알림 꺼짐/)).toBeVisible()
  const written = writes.length
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(settings).toHaveAttribute('aria-busy', 'false')
  expect(writes.length).toBe(written)

  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`reminders-${width}.png`), fullPage: true })
  }
  await settings.getByRole('button', { name: '알림 켜기' }).click()
  await expect(settings.getByRole('button', { name: '알림 끄기' })).toBeEnabled()
  await page.getByRole('button', { name: '로그아웃', exact: true }).click()
  await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeVisible()
  expect(writes.at(-1)).toBe('subscription:DELETE')
  expect(enabled).toBe(true)
})

test('허용된 기기는 로그인 때 자동 구독하고 다른 기기에서 껐으면 복귀 시 재등록하지 않는다', async ({ page }) => {
  await signInWithMockSession(page)
  await mockPush(page, 'granted')
  let enabled = true
  let registrations = 0
  let settingReads = 0
  await mockBackend(page, async (route, url, method) => {
    if (url.pathname === '/me/profile') return json(route, { nickname: null }).then(() => true)
    if (url.pathname === '/me/reminder-settings') { settingReads++; return json(route, { enabled }).then(() => true) }
    if (url.pathname === '/push/public-key') return json(route, { public_key: 'BAECAw' }).then(() => true)
    if (url.pathname === '/me/push-subscriptions' && method === 'PUT') { registrations++; return json(route, null, 204).then(() => true) }
    return false
  })
  await page.goto('/settings')
  await expect(page.getByText('이 기기에서 알림을 받을 수 있어요.')).toBeVisible()
  expect(registrations).toBe(1)
  expect(await page.evaluate(() => localStorage.getItem('permission-requested'))).toBeNull()
  enabled = false
  const previousReads = settingReads
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByText(/계정 알림 꺼짐/)).toBeVisible()
  await expect.poll(() => settingReads).toBeGreaterThan(previousReads + 1)
  expect(registrations).toBe(1)
})

test('푸시 미지원 기기에서도 계정 전체 설정을 저장한다', async ({ page }) => {
  await signInWithMockSession(page)
  await mockPush(page, 'unsupported')
  let enabled = false
  await mockBackend(page, async (route, url, method) => {
    if (url.pathname === '/me/profile') return json(route, { nickname: null }).then(() => true)
    if (url.pathname === '/me/reminder-settings') {
      if (method === 'PUT') enabled = route.request().postDataJSON().enabled
      return json(route, method === 'GET' ? { enabled } : null, method === 'GET' ? 200 : 204).then(() => true)
    }
    return false
  })
  await page.goto('/settings')
  await expect(page.getByText(/iOS 16.4 이상/)).toBeVisible()
  await page.getByRole('button', { name: '알림 켜기' }).click()
  await expect(page.getByText('계정 알림 켜짐')).toBeVisible()
  expect(enabled).toBe(true)
})
