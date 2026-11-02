import { useCallback, useEffect, useState } from 'react'

interface CapturedFailure {
  requestKey: string
  error: Error
}

/**
 * Keeps the failure a reader is looking at while its own retry runs. TanStack
 * clears `error` as soon as a fetch starts when nothing is cached, so a mounted
 * ErrorNotice would otherwise unmount and drop focus. Failures with cached rows
 * stay in query state and need no capture.
 *
 * The capture lives in state, so render only reads it; a different request key
 * or a successful load clears it, and a retry while a fetch is in flight is
 * ignored so the focused recovery control keeps its single press.
 */
export function useRetainedError(
  requestKey: string,
  hasData: boolean,
  error: Error | null,
  isFetching: boolean,
): { error: Error | null; retrying: boolean; retry: (run: () => void) => void } {
  const [captured, setCaptured] = useState<CapturedFailure | null>(null)

  useEffect(() => {
    if (captured === null) return
    // the remembered failure is stale once the request identity changes or a
    // load succeeds; a repeated failure refreshes it on the next retry press
    if (captured.requestKey !== requestKey || (hasData && error === null)) {
      setCaptured(null)
    }
  }, [captured, requestKey, hasData, error])

  const retained =
    error ??
    (!hasData && isFetching && captured !== null && captured.requestKey === requestKey
      ? captured.error
      : null)

  const retry = useCallback(
    (run: () => void) => {
      if (isFetching) return
      setCaptured(!hasData && error !== null ? { requestKey, error } : null)
      run()
    },
    [error, hasData, isFetching, requestKey],
  )

  return { error: retained, retrying: isFetching, retry }
}
