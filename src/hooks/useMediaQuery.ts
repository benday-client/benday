import { useCallback, useSyncExternalStore } from 'react'

function queryList(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia(query)
}

function subscribe(query: string, onChange: () => void): () => void {
  const list = queryList(query)
  if (list === null) return () => undefined

  list.addEventListener('change', onChange)
  return () => {
    list.removeEventListener('change', onChange)
  }
}

function getServerSnapshot(): boolean {
  return false
}

export function useMediaQuery(query: string): boolean {
  const subscribeToQuery = useCallback(
    (onChange: () => void) => subscribe(query, onChange),
    [query],
  )
  const getSnapshot = useCallback(() => queryList(query)?.matches ?? false, [query])

  return useSyncExternalStore(subscribeToQuery, getSnapshot, getServerSnapshot)
}
