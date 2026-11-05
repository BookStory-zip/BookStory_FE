import type { Page, Route } from '@playwright/test'

export const API = 'https://api.e2e.test'
const SUPABASE = 'https://e2etestproject000000.supabase.co'
const STORAGE_KEY = 'sb-e2etestproject000000-auth-token'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE',
  'content-type': 'application/json',
}

export const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, headers: cors, body: JSON.stringify(body) })

export const cover = (color: string) =>
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="174"><rect width="120" height="174" fill="${color}"/></svg>`,
  )

// 응답을 보냈으면 true. false면 404로 돌려 처리하지 않은 요청이 실제 서버에 닿지 않게 한다.
type Handler = (route: Route, url: URL, method: string) => Promise<boolean> | boolean

// 모든 외부 요청(BE API·Supabase)을 가로채 가짜 응답을 준다.
export async function mockBackend(page: Page, handle: Handler) {
  await page.route(`${SUPABASE}/**`, (route) => route.fulfill({ status: 204, headers: cors }))
  await page.route(`${API}/**`, async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const url = new URL(request.url())
    if (await handle(route, url, request.method())) return
    if (url.pathname === '/me') return json(route, { user_id: '11111111-1111-4111-8111-111111111111' })
    if (url.pathname === '/me/reminder-settings' && request.method() === 'GET') return json(route, { enabled: false })
    // 따로 다루지 않는 테스트에서는 완독 기록이 없는 것으로 본다.
    if (url.pathname === '/reading-completions') return json(route, [])
    if (url.pathname.endsWith('/reading-sessions')) return json(route, [])
    if (url.pathname.endsWith('/notes') && request.method() === 'GET') return json(route, [])
    if (url.pathname === '/shelves' && request.method() === 'GET') return json(route, [])
    return json(route, { detail: 'not mocked' }, 404)
  })
}

// 로그인된 세션을 브라우저 저장소에 넣는다. SDK는 만료 전 세션을 네트워크 없이 복원한다.
export async function signInWithMockSession(page: Page) {
  await page.addInitScript(
    ([key, expiresAt]) => {
      window.localStorage.setItem(
        key as string,
        JSON.stringify({
          access_token: 'e2e-access-token',
          refresh_token: 'e2e-refresh-token',
          token_type: 'bearer',
          expires_in: 86400,
          expires_at: expiresAt,
          user: {
            id: '11111111-1111-4111-8111-111111111111',
            aud: 'authenticated',
            email: 'reader@example.test',
            app_metadata: {},
            user_metadata: {},
            created_at: '2026-10-27T00:00:00Z',
          },
        }),
      )
    },
    [STORAGE_KEY, Math.floor(Date.now() / 1000) + 86400] as const,
  )
}
