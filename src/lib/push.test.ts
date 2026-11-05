// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { enableReminder, getReminderState, releaseReminder, setReminderEnabled, syncReminder } from './push'

const { auth } = vi.hoisted(() => ({ auth: { getSession: vi.fn(), refreshSession: vi.fn() } }))
vi.mock('./supabase', () => ({ supabase: { auth } }))

const SERVER_KEY = 'BAECAw' // [4, 1, 2, 3]
const OLD_KEY = new Uint8Array([4, 5, 6, 7])
const OWNER_KEY = 'bookstory-reminder-owner'

type FakeSubscription = ReturnType<typeof fakeSubscription>
function fakeSubscription(endpoint: string, key: Uint8Array) {
  return {
    endpoint,
    options: { applicationServerKey: key.slice().buffer as ArrayBuffer | null },
    toJSON: () => ({ endpoint, keys: { p256dh: `p256dh-${endpoint}`, auth: 'auth-secret' } }),
    unsubscribe: vi.fn(async () => {
      current = null
      return true
    }),
  }
}

let current: FakeSubscription | null
let userId: string
let enabled: boolean
const pushManager = {
  getSubscription: vi.fn(async () => current),
  subscribe: vi.fn(async ({ applicationServerKey }: { applicationServerKey: Uint8Array }) => {
    current = fakeSubscription('https://fcm.googleapis.com/fcm/send/new', applicationServerKey)
    return current
  }),
}
const notification = { permission: 'granted', requestPermission: vi.fn(async () => notification.permission) }
const updateWorker = vi.fn(async () => undefined)
const fetchMock = vi.fn<typeof fetch>()

function respond(routes: Record<string, () => Response | Promise<Response>>) {
  fetchMock.mockImplementation(async (input, init) => {
    const key = `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`
    if (routes[key]) return routes[key]()
    if (key === 'GET /me/reminder-settings') return Response.json({ enabled })
    if (key === 'PUT /me/reminder-settings') enabled = JSON.parse(String(init?.body)).enabled
    return new Response(null, { status: 204 })
  })
}
const calls = () =>
  fetchMock.mock.calls.map(([url, init]) => [init?.method ?? 'GET', new URL(String(url)).pathname, init?.body ?? null])

beforeEach(() => {
  current = null
  userId = 'user-a'
  enabled = true
  notification.permission = 'granted'
  localStorage.clear()
  auth.getSession.mockImplementation(async () => ({ data: { session: { access_token: `token-${userId}`, user: { id: userId } } }, error: null }))
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: async () => ({ pushManager, update: updateWorker }), register: vi.fn(async () => ({})), ready: Promise.resolve({ pushManager }) },
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
  await expect(enableReminder()).resolves.toEqual({ enabled: true, device: 'on' })
  expect(notification.requestPermission.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0])
  expect(pushManager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: new Uint8Array([4, 1, 2, 3]) })
  expect(calls()).toContainEqual(['PUT', '/me/push-subscriptions', JSON.stringify(current?.toJSON())])
  expect(fetchMock.mock.calls.find(([url]) => String(url).endsWith('/me/push-subscriptions'))?.[1]?.headers).toMatchObject({ Authorization: 'Bearer token-user-a' })
  await expect(getReminderState()).resolves.toEqual({ enabled: true, device: 'on' })
  userId = 'user-b'
  await expect(getReminderState()).resolves.toEqual({ enabled: true, device: 'off' })
})

test.each(['denied', 'default'] as const)('권한이 %s이면 구독하지 않는다', async (permission) => {
  notification.permission = permission
  await expect(enableReminder()).resolves.toEqual({ enabled: true, device: permission === 'denied' ? 'denied' : 'permission' })
  expect(calls().every(([method]) => method === 'GET')).toBe(true)
  expect(pushManager.subscribe).not.toHaveBeenCalled()
})

test('발송 키가 없는 서버의 503은 구독 전에 그대로 알린다', async () => {
  respond({ 'GET /push/public-key': () => new Response(null, { status: 503 }) })
  await expect(enableReminder()).rejects.toMatchObject({ status: 503 })
  expect(pushManager.subscribe).not.toHaveBeenCalled()
  expect(localStorage.getItem(OWNER_KEY)).toBeNull()
})

test('켜는 도중 다른 계정으로 바뀌면 새 계정에 등록하지 않고 구독을 끊는다', async () => {
  pushManager.subscribe.mockImplementationOnce(async ({ applicationServerKey }) => {
    userId = 'user-b'
    current = fakeSubscription('https://fcm.googleapis.com/fcm/send/new', applicationServerKey)
    return current
  })
  await expect(enableReminder()).rejects.toThrow('로그인이 필요합니다.')
  expect(calls().some(([method]) => method === 'PUT')).toBe(false)
  expect(current).toBeNull()
  expect(localStorage.getItem(OWNER_KEY)).toBeNull()
})

test('구독 키를 알려 주지 않는 브라우저는 앱 시작 때마다 다시 구독하지 않는다', async () => {
  const existing = fakeSubscription('https://web.push.apple.com/old', new Uint8Array([4, 1, 2, 3]))
  existing.options.applicationServerKey = null
  current = existing
  localStorage.setItem(OWNER_KEY, 'user-a')
  await syncReminder(() => true)
  expect(existing.unsubscribe).not.toHaveBeenCalled()
  expect(pushManager.subscribe).not.toHaveBeenCalled()
  expect(calls()).toContainEqual(['PUT', '/me/push-subscriptions', JSON.stringify(existing.toJSON())])
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
  expect(calls()).toContainEqual(['DELETE', '/me/push-subscriptions', JSON.stringify({ endpoint: existing.endpoint })])
  expect(calls().at(-1)?.[2]).toContain('/fcm/send/new')
})

test.each([
  ['다른 계정이 켠 구독', 'user-b', 'granted'],
  ['주인을 알 수 없는 구독', null, 'granted'],
  ['권한이 회수된 구독', 'user-a', 'denied'],
])('계정 설정이 꺼져 있을 때 %s은 이 계정으로 옮기지 않고 끊는다', async (_label, owner, permission) => {
  enabled = false
  current = fakeSubscription('https://fcm.googleapis.com/fcm/send/old', new Uint8Array([4, 1, 2, 3]))
  if (owner) localStorage.setItem(OWNER_KEY, owner)
  notification.permission = permission
  await syncReminder(() => true)
  expect(current).toBeNull()
  expect(calls().some(([method]) => method === 'PUT')).toBe(false)
  expect(localStorage.getItem(OWNER_KEY)).toBeNull()
})

test('동기화 도중 화면이 계정을 떠나면 등록하지 않는다', async () => {
  current = fakeSubscription('https://fcm.googleapis.com/fcm/send/old', new Uint8Array([4, 1, 2, 3]))
  localStorage.setItem(OWNER_KEY, 'user-a')
  await expect(syncReminder(() => false)).rejects.toThrow('로그인이 필요합니다.')
  expect(fetchMock).not.toHaveBeenCalled()
})

test('로그아웃은 서버 해제가 실패해도 브라우저 구독을 끊고 계정 설정은 유지한다', async () => {
  const existing = fakeSubscription('https://fcm.googleapis.com/fcm/send/old', new Uint8Array([4, 1, 2, 3]))
  current = existing
  localStorage.setItem(OWNER_KEY, 'user-a')
  respond({ 'DELETE /me/push-subscriptions': () => new Response(null, { status: 503 }) })
  await expect(releaseReminder()).resolves.toBeUndefined()
  expect(existing.unsubscribe).toHaveBeenCalled()
  expect(calls()).toEqual([['DELETE', '/me/push-subscriptions', JSON.stringify({ endpoint: existing.endpoint })]])
  expect(localStorage.getItem(OWNER_KEY)).toBeNull()
  expect(enabled).toBe(true)
})

test('알림을 지원하지 않는 브라우저는 안내 상태가 되고 로그아웃 정리도 조용히 끝난다', async () => {
  Reflect.deleteProperty(navigator, 'serviceWorker')
  await expect(getReminderState()).resolves.toEqual({ enabled: true, device: 'unsupported' })
  await expect(releaseReminder()).resolves.toBeUndefined()
  await expect(syncReminder(() => true)).resolves.toBeUndefined()
})

test('계정 설정이 꺼졌으면 권한과 기존 구독이 있어도 재등록하지 않는다', async () => {
  enabled = false
  current = fakeSubscription('https://fcm.googleapis.com/old', new Uint8Array([4, 1, 2, 3]))
  localStorage.setItem(OWNER_KEY, 'user-a')
  await syncReminder(() => true)
  expect(calls().some(([method]) => method === 'PUT')).toBe(false)
  expect(pushManager.subscribe).not.toHaveBeenCalled()
  expect(updateWorker).toHaveBeenCalledTimes(1)
})

test('계정이 켜져 있고 권한이 있으면 구독이 없는 기기도 자동 등록한다', async () => {
  await syncReminder(() => true)
  expect(pushManager.subscribe).toHaveBeenCalledTimes(1)
  expect(notification.requestPermission).not.toHaveBeenCalled()
  expect(localStorage.getItem(OWNER_KEY)).toBe('user-a')
})

test('지원하지 않는 기기에서도 계정 설정을 바꾸며 권한을 묻지 않는다', async () => {
  Reflect.deleteProperty(navigator, 'serviceWorker')
  enabled = false
  await expect(setReminderEnabled(true)).resolves.toEqual({ enabled: true, device: 'unsupported' })
  await expect(setReminderEnabled(false)).resolves.toEqual({ enabled: false, device: 'unsupported' })
  expect(notification.requestPermission).not.toHaveBeenCalled()
})

test('계정 끄기는 설정만 바꾸며 현재 기기와 다른 기기의 구독을 삭제하지 않는다', async () => {
  current = fakeSubscription('https://fcm.googleapis.com/old', new Uint8Array([4, 1, 2, 3]))
  localStorage.setItem(OWNER_KEY, 'user-a')
  await setReminderEnabled(false)
  expect(calls()).toContainEqual(['PUT', '/me/reminder-settings', '{"enabled":false}'])
  expect(calls().some(([method]) => method === 'DELETE')).toBe(false)
  expect(current).not.toBeNull()
})

test('느린 자동 구독 PUT 뒤에 계정 끄기가 적용되어 다시 켜지지 않는다', async () => {
  let finish!: () => void
  const started = new Promise<void>((resolve) => {
    respond({
      'GET /push/public-key': () => Response.json({ public_key: SERVER_KEY }),
      'PUT /me/push-subscriptions': async () => {
        resolve()
        await new Promise<void>((done) => { finish = done })
        return new Response(null, { status: 204 })
      },
    })
  })
  const syncing = syncReminder(() => true)
  await started
  const disabling = setReminderEnabled(false)
  finish()
  await Promise.all([syncing, disabling])
  expect(enabled).toBe(false)
  expect(calls().filter(([method]) => method === 'PUT').at(-1)).toEqual(['PUT', '/me/reminder-settings', '{"enabled":false}'])
})

test('구독 생성 중 다른 기기에서 설정이 꺼지면 등록하지 않는다', async () => {
  pushManager.subscribe.mockImplementationOnce(async ({ applicationServerKey }) => {
    enabled = false
    current = fakeSubscription('https://fcm.googleapis.com/new', applicationServerKey)
    return current
  })
  await syncReminder(() => true)
  expect(calls().some(([, path]) => path === '/me/push-subscriptions')).toBe(false)
  expect(current).toBeNull()
})

test('권한 요청만으로 꺼진 계정 설정을 켜거나 구독하지 않는다', async () => {
  enabled = false
  await expect(enableReminder()).resolves.toEqual({ enabled: false, device: 'off' })
  expect(calls().some(([method]) => method === 'PUT')).toBe(false)
})

test('권한 창을 기다리는 중 로그아웃하면 구독을 생성하지 않는다', async () => {
  let finish!: (permission: string) => void
  notification.requestPermission.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const enabling = enableReminder()
  await releaseReminder()
  finish('granted')
  await expect(enabling).rejects.toThrow('로그인이 필요합니다.')
  expect(pushManager.subscribe).not.toHaveBeenCalled()
  expect(calls().some(([method]) => method === 'PUT')).toBe(false)
})

test('설정 조회가 실패해도 이전 계정의 기기 구독부터 끊는다', async () => {
  const existing = fakeSubscription('https://fcm.googleapis.com/old', new Uint8Array([4, 1, 2, 3]))
  current = existing
  localStorage.setItem(OWNER_KEY, 'user-b')
  respond({ 'GET /me/reminder-settings': () => new Response(null, { status: 503 }) })
  await expect(syncReminder(() => true)).rejects.toMatchObject({ status: 503 })
  expect(existing.unsubscribe).toHaveBeenCalledTimes(1)
  expect(localStorage.getItem(OWNER_KEY)).toBeNull()
})

test('이전 계정의 권한 창을 닫지 않아도 다음 계정의 설정 변경은 끝난다', async () => {
  let finish!: (permission: string) => void
  notification.requestPermission.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const prompting = enableReminder()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await releaseReminder()
  userId = 'user-b'
  try {
    await Promise.race([
      setReminderEnabled(false),
      new Promise((_, reject) => setTimeout(() => reject(new Error('이전 권한 창이 작업을 막음')), 200)),
    ])
  } finally {
    finish('granted')
    await expect(prompting).rejects.toThrow('로그인이 필요합니다.')
  }
  expect(calls().some(([, path]) => path === '/me/push-subscriptions')).toBe(false)
})
