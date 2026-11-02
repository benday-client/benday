import { useCallback, useEffect, useRef, useState } from 'react'

/** How long a settled deck swap keeps its entering animation running. */
const DEAL_FLASH_MS = 900

/**
 * The deal flash a deck swap shows for a beat. A new deal restarts the timer
 * instead of stacking a second one, and an unmount clears the pending reset so
 * it can never set state on a dead view.
 */
export function useDealFlash<T extends string>(): readonly [T | null, (next: T) => void] {
  const [mode, setMode] = useState<T | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [])

  const flash = useCallback((next: T) => {
    setMode(next)
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      setMode(null)
    }, DEAL_FLASH_MS)
  }, [])

  return [mode, flash] as const
}
