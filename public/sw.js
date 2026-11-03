// 독서 알림 전용 서비스 워커. 푸시 수신과 알림 클릭만 처리하고 요청을 가로채거나 캐시하지 않는다.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let date = ''
  try {
    const data = event.data?.json()
    if (typeof data?.date === 'string') date = data.date
  } catch {
    // 내용을 읽지 못해도 알림은 보여 준다. 브라우저는 표시하지 않은 푸시를 허용하지 않는다.
  }
  event.waitUntil(
    self.registration.showNotification('BookStory', {
      body: '오늘 아직 체크하지 않은 책이 있어요.',
      icon: '/favicon.svg',
      // 같은 날 알림은 하나로 묶는다.
      tag: `reading-reminder-${date}`,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of windows) {
        try {
          await client.focus()
          await client.navigate('/records')
          return
        } catch {
          // 이동할 수 없는 창이면 새 창을 연다.
        }
      }
      await self.clients.openWindow('/records')
    })(),
  )
})
