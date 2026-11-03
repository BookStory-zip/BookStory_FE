// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { disableReminder, enableReminder, getReminderState, releaseReminder, syncReminder } from './push'

const { auth } = vi.hoisted(() => ({ auth: { getSession: vi.fn(), refreshSession: vi.fn() } }))
vi.mock('./supabase', () => ({ supabase: { auth } }))

const SERVER_KEY = 'BAECAw' // [4, 1, 2, 3]
const OLD_KEY = new Uint8Array([4, 5, 6, 7])
const OWNER_KEY = 'bookstory-reminder-owner'

type FakeSubscription = ReturnType<typeof fakeSubscription>
function fakeSubscription(endpoint: string, key: Uint8Array) {
  return {
    endpoint,
    options: { applicationServerKey: key.slice().buffer },
    toJSON: () => ({ endpoint, keys: { p256dh: `p256dh-${endpoint}`, auth: 'auth-secret' } }),
    unsubscribe: vi.fn(async () => {
      current = null
      return true
    }),
  }
}

let current: FakeSubscription | null
let userId: string
const pushManager = {
  getSubscription: vi.fn(async () => current),
  subscribe: vi.fn(async ({ applicationServerKey }: { applicationServerKey: Uint8Array }) => {
    current = fakeSubscription('https://fcm.googleapis.com/fcm/send/new', applicationServerKey)
    return current
  }),
}
const notification = { permission: 'granted', requestPermission: vi.fn(async () => notification.permission) }
const fetchMock = vi.fn<typeof fetch>()

function respond(routes: Record<string, () => Response>) {
  fetchMock.mockImplementation(async (input, init) => {
    const key = `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`
    return routes[key]?.() ?? new Response(null, { status: 204 })
  })
}
const calls = () =>
  fetchMock.mock.calls.map(([url, init]) => [init?.method ?? 'GET', new URL(String(url)).pathname, init?.body ?? null])

beforeEach(() => {
  current = null
  userId = 'user-a'
  notification.permission = 'granted'
  localStorage.clear()
  auth.getSession.mockImplementation(async () => ({ data: { session: { access_token: `token-${userId}`, user: { id: userId } } }, error: null }))
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: async () => ({ pushManager }), register: vi.fn(async () => ({})), ready: Promise.resolve({ pushManager }) },
  })
  vi.stubGlobal('PushManager', class {})
  vi.stubGlobal('Notification', notification)
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')
  respond({ 'GET /push/public-key': () => Response.json({ public_key: SERVER_KEY }) })
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  Reflect.deleteProperty(navigator, 'serviceWorker')
})

test('알림을 켜면 권한을 먼저 요청하고 서버 키로 구독해 이 계정으로 등록한다', async () => {
  await expect(enableReminder()).resolves.toBe('on')
  expect(notification.requestPermission.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0])
  expect(pushManager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: new Uint8Array([4, 1, 2, 3]) })
  expect(calls()).toEqual([
    ['GET', '/push/public-key', null],
    ['PUT', '/me/push-subscriptions', JSON.stringify(current?.toJSON())],
  ])
  expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({ Authorization: 'Bearer token-user-a' })
  await expect(getReminderState()).resolves.toBe('on')
  userId = 'user-b'
  await expect(getReminderState()).resolves.toBe('off')
})

test.each(['denied', 'default'] as const)('권한이 %s이면 구독하지 않는다', async (permission) => {
  notification.permission = permission
  await expect(enableReminder()).resolves.toBe(permission === 'denied' ? 'denied' : 'off')
  expect(fetchMock).not.toHaveBeenCalled()
  expect(pushManager.subscribe).not.toHaveBeenCalled()
})

test('발송 키가 없는 서버의 503은 구독 전에 그대로 알린다', async () => {
  respond({ 'GET /push/public-key': () => new Response(null, { status: 503 }) })
  await expect(enableReminder()).rejects.toMatchObject({ status: 503 })
  expect(pushManager.subscribe).not.toHaveBeenCalled()
  expect(localStorage.getItem(OWNER_KEY)).toBeNull()
})

test('서버 등록에 실패하면 브라우저 구독을 남기지 않는다', async () => {
  respond({
    'GET /push/public-key': () => Response.json({ public_key: SERVER_KEY }),
    'PUT /me/push-subscriptions': () => Response.json({ code: 'validation_error' }, { status: 422 }),
  })
  await expect(enableReminder()).rejects.toMatchObject({ status: 422 })
  expect(current).toBeNull()
  expect(localStorage.getItem(OWNER_KEY)).toBeNull()
})

test('앱 시작 때 같은 계정·같은 키의 구독은 그대로 다시 등록한다', async () => {
  const existing = fakeSubscription('https://fcm.googleapis.com/fcm/send/old', new Uint8Array([4, 1, 2, 3]))
  current = existing
  localStorage.setItem(OWNER_KEY, 'user-a')
  await syncReminder(() => true)
  expect(pushManager.subscribe).not.toHaveBeenCalled()
  expect(calls().at(-1)).toEqual(['PUT', '/me/push-subscriptions', JSON.stringify(existing.toJSON())])
})

test('서버 발송 키가 바뀌었으면 다시 구독한 뒤 새 구독을 등록한다', async () => {
  const existing = fakeSubscription('https://fcm.googleapis.com/fcm/send/old', OLD_KEY)
  current = existing
  localStorage.setItem(OWNER_KEY, 'user-a')
  await syncReminder(() => true)
  expect(existing.unsubscribe).toHaveBeenCalled()
  expect(calls().map(([method, path]) => `${method} ${path}`)).toEqual(['GET /push/public-key', 'DELETE /me/push-subscriptions', 'PUT /me/push-subscriptions'])
  expect(calls()[1][2]).toBe(JSON.stringify({ endpoint: existing.endpoint }))
  expect(calls().at(-1)?.[2]).toContain('/fcm/send/new')
})

test.each([
  ['다른 계정이 켠 구독', 'user-b', 'granted'],
  ['주인을 알 수 없는 구독', null, 'granted'],
  ['권한이 회수된 구독', 'user-a', 'denied'],
])('앱 시작 때 %s은 이 계정으로 옮기지 않고 끊는다', async (_label, owner, permission) => {
  current = fakeSubscription('https://fcm.googleapis.com/fcm/send/old', new Uint8Array([4, 1, 2, 3]))
  if (owner) localStorage.setItem(OWNER_KEY, owner)
  notification.permission = permission
  await syncReminder(() => true)
  expect(current).toBeNull()
  expect(fetchMock).not.toHaveBeenCalled()
  expect(localStorage.getItem(OWNER_KEY)).toBeNull()
})

test('동기화 도중 화면이 계정을 떠나면 등록하지 않는다', async () => {
  current = fakeSubscription('https://fcm.googleapis.com/fcm/send/old', new Uint8Array([4, 1, 2, 3]))
  localStorage.setItem(OWNER_KEY, 'user-a')
  await syncReminder(() => false)
  expect(calls()).toEqual([['GET', '/push/public-key', null]])
})

test.each([
  ['로그아웃', releaseReminder],
  ['알림 끄기', disableReminder],
])('%s은 서버 해제가 실패해도 브라우저 구독을 끊는다', async (_label, release) => {
  const existing = fakeSubscription('https://fcm.googleapis.com/fcm/send/old', new Uint8Array([4, 1, 2, 3]))
  current = existing
  localStorage.setItem(OWNER_KEY, 'user-a')
  respond({ 'DELETE /me/push-subscriptions': () => new Response(null, { status: 503 }) })
  await expect(release()).resolves.toBeUndefined()
  expect(existing.unsubscribe).toHaveBeenCalled()
  expect(calls()).toEqual([['DELETE', '/me/push-subscriptions', JSON.stringify({ endpoint: existing.endpoint })]])
  expect(localStorage.getItem(OWNER_KEY)).toBeNull()
})

test('알림을 지원하지 않는 브라우저는 안내 상태가 되고 로그아웃 정리도 조용히 끝난다', async () => {
  Reflect.deleteProperty(navigator, 'serviceWorker')
  await expect(getReminderState()).resolves.toBe('unsupported')
  await expect(releaseReminder()).resolves.toBeUndefined()
  await expect(syncReminder(() => true)).resolves.toBeUndefined()
})
