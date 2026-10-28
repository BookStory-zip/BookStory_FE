import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'

const root = createRoot(document.getElementById('root')!)

// 공개 설정이 빠지면 Supabase 클라이언트 생성에서 흰 화면이 되므로, 앱을 불러오기 전에 이름만 안내한다.
const missing = [
  ['VITE_API_BASE_URL', import.meta.env.VITE_API_BASE_URL],
  ['VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL],
  ['VITE_SUPABASE_PUBLISHABLE_KEY', import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY],
]
  .filter(([, value]) => !value)
  .map(([name]) => name)

if (missing.length > 0) {
  root.render(
    <main>
      <h1 translate="no">BookStory</h1>
      <p role="alert">
        앱 설정이 완료되지 않았습니다. 관리자에게 다음 공개 설정을 확인해 달라고 알려주세요:{' '}
        {missing.join(', ')}
      </p>
    </main>,
  )
} else {
  void import('./App.tsx').then(({ default: App }) => {
    root.render(
      <StrictMode>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </StrictMode>,
    )
  })
}
