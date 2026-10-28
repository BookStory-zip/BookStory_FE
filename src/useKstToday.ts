import { useEffect, useState } from 'react'
import { addDays } from './lib/dates'
import { kstToday } from './lib/record'

export function msUntilNextKstDay(now = new Date()): number {
  const next = new Date(`${addDays(kstToday(now), 1)}T00:00:00+09:00`)
  return next.getTime() - now.getTime()
}

// 한국 날짜 '오늘'. 폴링 없이 다음 자정에 한 번 깨고, 창으로 돌아오면 다시 계산한다.
export function useKstToday(): string {
  const [today, setToday] = useState(() => kstToday())

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(sync, msUntilNextKstDay() + 1000)
    }
    function sync() {
      setToday(kstToday())
      schedule()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') sync()
    }
    schedule()
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return today
}
