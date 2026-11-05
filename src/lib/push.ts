import { deletePushSubscription, getPushPublicKey, getReminderSettings, savePushSubscription, updateReminderSettings } from './api'
import type { PushSubscriptionBody } from './api'
import { SessionMissingError, withAccessToken } from './auth'
import { supabase } from './supabase'

const OWNER_KEY = 'bookstory-reminder-owner'
export type DeviceReminderState = 'unsupported' | 'denied' | 'permission' | 'on' | 'off'
export type ReminderState = { enabled: boolean; device: DeviceReminderState }

// 앱 복귀·권한 허용·설정 변경이 겹쳐도 기기 구독을 동시에 만들지 않는다.
let pending: Promise<unknown> = Promise.resolve()
let generation = 0
type RequestForUser = <T>(call: (token: string) => Promise<T>) => Promise<T>

function runSerial<T>(job: (request: RequestForUser, check: () => Promise<void>, userId: string) => Promise<T>, isActive = () => true, user = sessionUserId()) {
  const version = generation
  const identity = user.then((userId) => ({ userId, error: null }), (error: unknown) => ({ userId: null, error }))
  const result = pending.catch(() => undefined).then(async () => {
    const { userId, error } = await identity
    if (error) throw error
    if (!userId) throw new SessionMissingError()
    const check = async () => {
      if (!userId || version !== generation || !isActive() || (await sessionUserId()) !== userId) throw new SessionMissingError()
    }
    const request: RequestForUser = (call) => withAccessToken(async (token) => {
      await check()
      return call(token)
    })
    await check()
    return job(request, check, userId)
  })
  pending = result.catch(() => undefined)
  return result
}

export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

function readOwner() {
  try { return localStorage.getItem(OWNER_KEY) } catch { return null }
}

function writeOwner(userId: string | null) {
  try {
    if (userId) localStorage.setItem(OWNER_KEY, userId)
    else localStorage.removeItem(OWNER_KEY)
  } catch {
    // 저장하지 못하면 다음 시작 때 주인을 알 수 없는 구독으로 보고 해제한다.
  }
}

async function sessionUserId() {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session?.user.id ?? null
}

async function currentSubscription() {
  if (!isPushSupported()) return null
  const registration = await navigator.serviceWorker.getRegistration('/')
  return (await registration?.pushManager.getSubscription()) ?? null
}

function toBody(subscription: PushSubscription): PushSubscriptionBody {
  const { endpoint, keys } = subscription.toJSON()
  if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error('알림 구독 정보를 읽지 못했습니다.')
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }
}

function decodeKey(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
}

function sameKey(subscription: PushSubscription, key: Uint8Array) {
  const current = subscription.options.applicationServerKey
  // 키를 알려 주지 않는 브라우저에서는 매번 다시 구독하지 않는다.
  if (!current) return true
  const bytes = new Uint8Array(current)
  return bytes.length === key.length && bytes.every((byte, index) => byte === key[index])
}

async function subscribeWithServerKey(subscription: PushSubscription | null, request: RequestForUser, check: () => Promise<void>) {
  const key = decodeKey(await getPushPublicKey())
  await check()
  if (subscription && sameKey(subscription, key)) return subscription
  if (subscription) {
    await request((token) => deletePushSubscription(token, subscription.endpoint)).catch(() => undefined)
    await check()
    await subscription.unsubscribe()
  }
  await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  const registration = await navigator.serviceWorker.ready
  await check()
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
}

async function deviceState(userId: string | null): Promise<DeviceReminderState> {
  if (!isPushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  if (Notification.permission !== 'granted') return 'permission'
  return await currentSubscription() && readOwner() === userId ? 'on' : 'off'
}

export async function getReminderState(): Promise<ReminderState> {
  const userId = await sessionUserId()
  const enabled = await withAccessToken(getReminderSettings)
  const device = await deviceState(userId)
  if (!userId || (await sessionUserId()) !== userId) throw new SessionMissingError()
  return { enabled, device }
}

async function syncDevice(request: RequestForUser, check: () => Promise<void>, userId: string): Promise<ReminderState> {
  let subscription = await currentSubscription()
  await check()
  if (subscription && (readOwner() !== userId || Notification.permission !== 'granted')) {
    writeOwner(null)
    await subscription.unsubscribe()
    subscription = null
  }
  const enabled = await request(getReminderSettings)
  if (enabled && isPushSupported() && Notification.permission === 'granted') {
    const synced = await subscribeWithServerKey(subscription, request, check)
    try {
      // 키 조회·브라우저 구독을 기다리는 사이 다른 기기에서 껐을 수 있다.
      if (!await request(getReminderSettings)) {
        await synced.unsubscribe()
        writeOwner(null)
        return { enabled: false, device: await deviceState(userId) }
      }
      await request((token) => savePushSubscription(token, toBody(synced)))
      await check()
      writeOwner(userId)
    } catch (error) {
      await synced.unsubscribe().catch(() => undefined)
      throw error
    }
  }
  return { enabled, device: await deviceState(userId) }
}

export function setReminderEnabled(enabled: boolean, isActive = () => true): Promise<ReminderState> {
  return runSerial(async (request, check, userId) => {
    await request((token) => updateReminderSettings(token, enabled))
    return syncDevice(request, check, userId)
  }, isActive)
}

// 사용자 클릭의 첫 await 전에 권한을 요청해야 Safari가 요청을 막지 않는다.
export function enableReminder(isActive = () => true): Promise<ReminderState> {
  const version = generation
  const permission = isPushSupported() ? Notification.requestPermission() : Promise.resolve()
  const user = sessionUserId()
  // 권한 창을 닫지 않아도 다음 계정의 동기화·설정 변경은 진행할 수 있다.
  return Promise.all([permission, user]).then(([, userId]) => {
    if (version !== generation || !isActive()) throw new SessionMissingError()
    return runSerial(syncDevice, isActive, Promise.resolve(userId))
  })
}

// 로그아웃은 계정 설정을 바꾸지 않고 현재 기기만 해제한다.
export async function releaseReminder(): Promise<void> {
  generation += 1
  try {
    const subscription = await currentSubscription()
    writeOwner(null)
    if (!subscription) return
    const { data } = await supabase.auth.getSession()
    if (data.session) void deletePushSubscription(data.session.access_token, subscription.endpoint).catch(() => undefined)
    await subscription.unsubscribe()
  } catch {
    // 알림 정리 실패로 로그아웃을 막지 않는다.
  }
}

export async function syncReminder(isActive: () => boolean): Promise<void> {
  await runSerial(async (request, check, userId) => {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration('/')
      await registration?.update().catch(() => undefined)
      await check()
    }
    await syncDevice(request, check, userId)
  }, isActive)
}
