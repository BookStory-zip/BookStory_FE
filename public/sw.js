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
      data: { date },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  // 알림 날짜의 체크 편집기를 연다. 자정이 지나 눌러도 그날을 체크할 수 있다.
  const date = event.notification.data?.date
  const url = /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? `/records?check=${date}` : '/records'
  // 열린 창을 이동시키면 작성 중인 메모·날짜가 사라질 수 있어 항상 새 창으로 연다.
  event.waitUntil(self.clients.openWindow(url))
})
