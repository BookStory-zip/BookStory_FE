import { defineConfig, devices } from '@playwright/test'

const PORT = 4174

// 핵심 흐름을 실제 브라우저로 검사한다. API·Supabase는 테스트에서 모두 가짜 응답으로 가로채므로
// 운영 API·DB·비밀값을 쓰지 않는다. 아래 공개 설정도 테스트 전용 가짜 값이다.
export default defineConfig({
  testDir: './e2e',
  testMatch: '*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'mobile-chromium', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_API_BASE_URL: 'https://api.e2e.test',
      VITE_SUPABASE_URL: 'https://e2etestproject000000.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e_test_only',
    },
  },
})
