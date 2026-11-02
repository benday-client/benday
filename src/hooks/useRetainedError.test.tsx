import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useRetainedError } from './useRetainedError'

const FAILURE = new Error('appview unavailable')

interface Harness {
  requestKey: string
  hasData: boolean
  error: Error | null
  isFetching: boolean
}

function renderRetained(initial: Harness) {
  return renderHook(
    ({ requestKey, hasData, error, isFetching }: Harness) =>
      useRetainedError(requestKey, hasData, error, isFetching),
    { initialProps: initial },
  )
}

describe('useRetainedError', () => {
  it('keeps the shown failure while its own retry runs and ignores a repeat press', () => {
    const { result, rerender } = renderRetained({
      requestKey: 'profile:alice',
      hasData: false,
      error: FAILURE,
      isFetching: false,
    })
    expect(result.current.error).toBe(FAILURE)

    const run = vi.fn()
    result.current.retry(run)
    expect(run).toHaveBeenCalledTimes(1)
    // tanstack reports the running fetch with no error while nothing is cached
    rerender({ requestKey: 'profile:alice', hasData: false, error: null, isFetching: true })
    expect(result.current.error).toBe(FAILURE)
    expect(result.current.retrying).toBe(true)

    // a second press during that fetch has nothing to add
    result.current.retry(run)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('drops the capture when the request identity changes', () => {
    const { result, rerender } = renderRetained({
      requestKey: 'profile:alice',
      hasData: false,
      error: FAILURE,
      isFetching: false,
    })
    result.current.retry(() => undefined)
    rerender({ requestKey: 'profile:alice', hasData: false, error: null, isFetching: true })
    expect(result.current.error).toBe(FAILURE)

    rerender({ requestKey: 'profile:bob', hasData: false, error: null, isFetching: true })
    expect(result.current.error).toBeNull()
  })

  it('drops the capture once data arrives', () => {
    const { result, rerender } = renderRetained({
      requestKey: 'thread:one',
      hasData: false,
      error: FAILURE,
      isFetching: false,
    })
    result.current.retry(() => undefined)
    rerender({ requestKey: 'thread:one', hasData: false, error: null, isFetching: true })
    expect(result.current.error).toBe(FAILURE)

    rerender({ requestKey: 'thread:one', hasData: true, error: null, isFetching: false })
    expect(result.current.error).toBeNull()
  })

  it('never captures a failure that already has rows on screen', () => {
    const { result, rerender } = renderRetained({
      requestKey: 'feed:cats',
      hasData: true,
      error: FAILURE,
      isFetching: false,
    })

    result.current.retry(() => undefined)
    rerender({ requestKey: 'feed:cats', hasData: true, error: null, isFetching: true })

    // cached rows keep the deck, so no capture is needed to hold a notice
    expect(result.current.error).toBeNull()
  })
})
