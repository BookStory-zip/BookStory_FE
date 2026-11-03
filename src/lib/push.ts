import { deletePushSubscription, getPushPublicKey, savePushSubscription } from './api'
import type { PushSubscriptionBody } from './api'
import { withAccessToken } from './auth'
import { supabase } from './supabase'

// 알림을 켠 계정. 같은 브라우저의 다른 계정이 이 구독을 이어받지 않게 한다.
const OWNER_KEY = 'bookstory-reminder-owner'

export type ReminderState = 'unsupported' | 'denied' | 'on' | 'off'

export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

function readOwner() {
  try {
    return localStorage.getItem(OWNER_KEY)
  } catch {
    return null
  }
}

function writeOwner(userId: string | null) {
  try {
    if (userId) localStorage.setItem(OWNER_KEY, userId)
    else localStorage.removeItem(OWNER_KEY)
  } catch {
    // 저장하지 못하면 다음 앱 시작 때 주인을 알 수 없는 구독으로 보고 해제한다.
  }
}

async function sessionUserId() {
  const { data } = await supabase.auth.getSession()
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

// 서버 발송 키가 바뀌면 이전 키로 만든 구독은 403으로 실패하므로 다시 구독한다.
function sameKey(subscription: PushSubscription, key: Uint8Array) {
  const current = subscription.options.applicationServerKey
  if (!current) return false
  const bytes = new Uint8Array(current)
  return bytes.length === key.length && bytes.every((byte, index) => byte === key[index])
}

async function subscribeWithServerKey(subscription: PushSubscription | null) {
  const key = decodeKey(await getPushPublicKey())
  if (subscription && sameKey(subscription, key)) return subscription
  await subscription?.unsubscribe()
  await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
}

export async function getReminderState(): Promise<ReminderState> {
  if (!isPushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const subscription = await currentSubscription()
  return subscription && readOwner() === (await sessionUserId()) ? 'on' : 'off'
}

// 버튼 클릭에서 다른 await보다 먼저 권한을 요청해야 Safari가 요청을 막지 않는다.
export async function enableReminder(): Promise<ReminderState> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off'

  const userId = await sessionUserId()
  const subscription = await subscribeWithServerKey(await currentSubscription())
  try {
    await withAccessToken((token) => savePushSubscription(token, toBody(subscription)))
  } catch (error) {
    // 등록을 확인하지 못한 구독은 남기지 않는다. 서버에 저장됐더라도 푸시 서비스의 410으로 정리된다.
    await subscription.unsubscribe().catch(() => undefined)
    throw error
  }
  writeOwner(userId)
  return 'on'
}

export async function disableReminder(): Promise<void> {
  const subscription = await currentSubscription()
  writeOwner(null)
  if (!subscription) return
  // 서버 해제에 실패해도 브라우저 구독을 끊으면 다음 발송 때 410으로 BE가 지운다.
  await withAccessToken((token) => deletePushSubscription(token, subscription.endpoint)).catch(() => undefined)
  await subscription.unsubscribe()
}

// 로그아웃 직전에 부른다. 서버 응답을 기다리지 않아 로그아웃이 늦어지지 않는다.
export async function releaseReminder(): Promise<void> {
  try {
    const subscription = await currentSubscription()
    writeOwner(null)
    if (!subscription) return
    const { data } = await supabase.auth.getSession()
    if (data.session) {
      void deletePushSubscription(data.session.access_token, subscription.endpoint).catch(() => undefined)
    }
    await subscription.unsubscribe()
  } catch {
    // 알림 정리 실패로 로그아웃을 막지 않는다.
  }
}

// 확인된 계정으로 앱을 열 때 구독을 서버에 다시 맞춘다. 만료 구독 삭제·키 교체를 복구한다.
export async function syncReminder(isActive: () => boolean): Promise<void> {
  const subscription = await currentSubscription()
  if (!subscription) return
  const userId = await sessionUserId()
  if (readOwner() !== userId || Notification.permission !== 'granted') {
    // 다른 계정이 켠 구독이거나 권한이 회수됐으면 이 계정으로 옮기지 않고 끊는다.
    writeOwner(null)
    await subscription.unsubscribe()
    return
  }
  const synced = await subscribeWithServerKey(subscription)
  if (!isActive() || (await sessionUserId()) !== userId) return
  await withAccessToken((token) => savePushSubscription(token, toBody(synced)))
}
