import { useEffect, useState } from "react"

const SCHEDULE_LISTENER_PAUSE_DELAY_MS = 60_000

export function useScheduleListenerActive() {
  const [isActive, setIsActive] = useState(true)

  useEffect(() => {
    if (typeof document === "undefined") return

    let pauseTimer: ReturnType<typeof setTimeout> | undefined

    const clearPauseTimer = () => {
      if (!pauseTimer) return
      clearTimeout(pauseTimer)
      pauseTimer = undefined
    }

    const syncVisibility = () => {
      clearPauseTimer()
      if (document.visibilityState === "hidden") {
        pauseTimer = setTimeout(() => setIsActive(false), SCHEDULE_LISTENER_PAUSE_DELAY_MS)
        return
      }
      setIsActive(true)
    }

    syncVisibility()
    document.addEventListener("visibilitychange", syncVisibility)

    return () => {
      clearPauseTimer()
      document.removeEventListener("visibilitychange", syncVisibility)
    }
  }, [])

  return isActive
}
