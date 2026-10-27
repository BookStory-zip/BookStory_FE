import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

function App() {
  const [message, setMessage] = useState('로그인 상태를 확인하고 있습니다.')

  useEffect(() => {
    let ignore = false

    async function checkSession() {
      try {
        const { data, error } = await supabase.auth.getSession()

        if (error) throw error

        if (!ignore) {
          setMessage(
            data.session
              ? '저장된 로그인 정보가 있습니다.'
              : '로그인이 필요합니다.',
          )
        }
      } catch {
        if (!ignore) {
          setMessage('로그인 상태를 확인하지 못했습니다.')
        }
      }
    }

    void checkSession()

    return () => {
      ignore = true
    }
  }, [])

   return (
    <main>
      <h1>BookStory</h1>
      <p>{message}</p>

      <form aria-label="로그인">
        <div>
          <label htmlFor="email">이메일</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
          />
        </div>

        <div>
          <label htmlFor="password">비밀번호</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>

        <button type="submit" disabled>
          로그인
        </button>
      </form>
    </main>
  )
}

export default App
