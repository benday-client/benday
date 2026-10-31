import { useEffect, useState } from 'react'

/**
 * Holds a value back until it has been stable for `delay` milliseconds, so a
 * query key never chases every keystroke.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(value)
    }, delay)
    return () => {
      window.clearTimeout(timer)
    }
  }, [value, delay])

  return debounced
}
